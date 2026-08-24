
"use client";
import { IdentityGraph, IdentityGraphConflict } from "@/lib/api";
import Link from "next/link";

/* How this person was assembled.
   The spine answers "when, and across what". This answers "on what evidence" —
   and it grades that evidence visually: a solid mark is a deterministic
   identifier, a ring is probabilistic, a grey ring is weak, and a warm numbered
   badge is a link the resolver refused to make. Evidence strength is the only
   thing encoded here, so there is no second colour scale to learn.

   Refusals then get a ledger of their own. A refused link is the one thing in
   this product that must never be silently dropped, so the arc draws the first
   few marks and the ledger lists every single one, sharing the same numbers —
   and says so on screen when there are more refusals than marks. */

const EVIDENCE = {
  identifier: { fill: "var(--blue)", stroke: "var(--blue)", label: "identifier · deterministic" },
  device: { fill: "var(--graph-node-fill)", stroke: "var(--blue)", label: "device · probabilistic" },
  network: { fill: "var(--graph-node-fill)", stroke: "var(--ink-3)", label: "network · weak" },
  refused: { fill: "var(--graph-node-fill)", stroke: "var(--flag)", label: "refused" },
};

/* Marks drawn on the refusal arc. Chosen so the badges cannot collide with each
   other or with the identifier labels below-left of the hub; the ledger is
   uncapped, so a member with more refusals than this loses the mark, never the
   record. */
const DRAWN_CONFLICTS = 6;
/* api/customers.py returns a member's 20 most recent conflicts. If we are
   holding exactly that many, say so rather than implying it is the whole set. */
const CONFLICT_API_LIMIT = 20;

function signalKind(type: string): "device" | "network" {
  return type === "ip_subnet" ? "network" : "device";
}
function polar(cx: number, cy: number, r: number, angleDeg: number) {
  const a = (angleDeg - 90) * (Math.PI / 180);
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/** Evenly space `count` nodes across [from, to] degrees; a lone node centres. */
function spread(from: number, to: number, count: number): number[] {
  if (count <= 0) return [];
  if (count === 1) return [(from + to) / 2];
  const step = (to - from) / (count - 1);
  return Array.from({ length: count }, (_, i) => from + step * i);
}

/** Labels always point away from the hub, so they never cross a link line. */
function labelPlacement(x: number, y: number, cx: number, cy: number) {
  const anchor: "start" | "middle" | "end" = x > cx + 15 ? "start" : x < cx - 15 ? "end" : "middle";
  const dx = anchor === "start" ? 11 : anchor === "end" ? -11 : 0;
  const above = y < cy - 15;
  return { anchor, dx, dy1: above ? -20 : 18, dy2: above ? -5 : 34 };
}

function truncate(v: string, n = 22) {
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}

/** Hydration-safe: format the ISO string, never construct a Date. */
function stamp(iso: string | null) {
  return iso ? iso.slice(0, 16).replace("T", " ") : "—";
}

/**
 * The other member(s) a refusal held this one apart from. resolution.py records
 * whichever shape fits the rung that refused: an identifier-vs-identifier
 * conflict writes a map of id_type → customer_id, a behavioural one writes the
 * two sides separately.
 */
function heldApartFrom(detail: Record<string, any> | null, self: string): string[] {
  const out = new Set<string>();
  const conflicting = detail?.conflicting_identifiers;
  if (conflicting && typeof conflicting === "object") {
    for (const v of Object.values(conflicting)) if (typeof v === "string") out.add(v);
  }
  for (const k of ["identifier_customer", "behavioral_customer"]) {
    const v = detail?.[k];
    if (typeof v === "string") out.add(v);
  }
  out.delete(self);
  return [...out];
}

/** The evidence that caused the refusal, most informative first. */
function refusalEvidence(detail: Record<string, any> | null): string {
  const parts: string[] = [];
  const conflicting = detail?.conflicting_identifiers;
  if (conflicting && typeof conflicting === "object") {
    parts.push(`disagreeing ids: ${Object.keys(conflicting).map((k) => k.replace(/_/g, " ")).join(", ")}`);
  }
  const matchedOn = detail?.identifier_signals?.matched_on;
  if (typeof matchedOn === "string") parts.push(`proven on ${matchedOn.replace(/_/g, " ")}`);
  if (typeof detail?.behavioral_confidence === "number") {
    parts.push(`rival behaviour ${detail.behavioral_confidence.toFixed(2)}`);
  }
  const device = detail?.device_fp;
  if (device) parts.push(`device ${truncate(String(device), 14)}`);
  const subnet = detail?.ip_subnet;
  if (subnet) parts.push(`subnet ${String(subnet)}`);
  const reason = detail?.reason;
  if (!parts.length && typeof reason === "string") parts.push(reason.replace(/_/g, " "));
  return parts.slice(0, 3).join(" · ");
}

type NumberedConflict = IdentityGraphConflict & { n: number };

export function IdentityGraphView({ data }: { data: IdentityGraph }) {
  const cx = 460;
  const cy = 250;
  const identifiers = data.identifiers;
  const signals = data.signals.slice(0, 10);

  // Never sliced. Every refusal on record reaches the ledger below.
  const conflicts: NumberedConflict[] = data.conflicts.map((c, i) => ({ ...c, n: i + 1 }));
  const undrawn = Math.max(0, conflicts.length - DRAWN_CONFLICTS);
  const saturated = conflicts.length >= CONFLICT_API_LIMIT;

  const idNodes = identifiers.map((idf, i) => ({
    ...idf,
    ...polar(cx, cy, 175, spread(-155, -25, identifiers.length)[i]),
  }));
  const sigNodes = signals.map((s, i) => ({
    ...s,
    ...polar(cx, cy, 250, spread(20, 130, signals.length)[i]),
  }));
  const drawn = conflicts.slice(0, DRAWN_CONFLICTS);
  const conflictNodes = drawn.map((c, i) => ({
    ...c,
    ...polar(cx, cy, 320, spread(165, 225, drawn.length)[i]),
  }));

  const hasAny = idNodes.length + sigNodes.length + conflicts.length > 0;
  const name = data.customer.name || data.customer.customer_id;
  // The topmost signal sits close to y=0 and labels itself *above* the node, so
  // the viewBox starts above the origin — otherwise that one label is clipped
  // off the top edge for any member with two or more behavioural signals.
  const VB_TOP = -26;
  const vbBottom = conflictNodes.length ? 600 : 470;

  const legend: { key: string; fill: string; stroke: string; label: string }[] = [
    { key: "identifier", ...EVIDENCE.identifier },
    { key: "device", ...EVIDENCE.device },
    { key: "network", ...EVIDENCE.network },
  ];
  if (conflictNodes.length) legend.push({ key: "refused", ...EVIDENCE.refused });

  return (
    <section>
      <div className="flex items-end justify-between gap-6 flex-wrap mb-3">
        <div>
          <div className="eyebrow">Auditable by construction</div>
          <h2 className="t-h2 mt-1.5">Why we believe this is one person</h2>
        </div>
        <div className="flex items-center gap-4 t-label text-muted flex-wrap justify-end">
          {legend.map((e) => (
            <span key={e.key} className="flex items-center gap-1.5">
              <i
                className="inline-block w-2.5 h-2.5 rounded-full"
                style={{ background: e.fill, boxShadow: `inset 0 0 0 1.5px ${e.stroke}` }}
              />
              {e.label}
            </span>
          ))}
        </div>
      </div>

      <div className="panel">
        {!hasAny ? (
          <p className="t-body text-soft py-10">
            No identifiers or behavioural signals recorded for this member yet.
          </p>
        ) : (
          <svg
            viewBox={`0 ${VB_TOP} 920 ${vbBottom - VB_TOP}`}
            className="w-full h-auto"
            role="img"
            aria-label={`${identifiers.length} identifiers, ${signals.length} behavioural signals and ${conflicts.length} refused links for ${name}. Every refused link is listed in the table below the graph.`}
          >
            {idNodes.map((n) => (
              <line
                key={`el-${n.type}-${n.value}`}
                x1={cx}
                y1={cy}
                x2={n.x}
                y2={n.y}
                stroke="var(--blue)"
                strokeOpacity={0.5}
                strokeWidth={1.5}
              />
            ))}
            {sigNodes.map((n) => (
              <line
                key={`sl-${n.type}-${n.value}`}
                x1={cx}
                y1={cy}
                x2={n.x}
                y2={n.y}
                stroke={signalKind(n.type) === "network" ? "var(--ink-3)" : "var(--blue)"}
                strokeOpacity={0.32}
                strokeWidth={1.25}
              />
            ))}
            {conflictNodes.map((n) => (
              <line
                key={`cl-${n.event_id}`}
                x1={cx}
                y1={cy}
                x2={n.x}
                y2={n.y}
                stroke="var(--flag)"
                strokeOpacity={0.75}
                strokeWidth={1.6}
                strokeDasharray="5 4"
              />
            ))}

            {/* The member */}
            <circle
              cx={cx}
              cy={cy}
              r={31}
              fill="var(--graph-node-fill)"
              stroke="var(--blue)"
              strokeWidth={2.5}
            />
            <text
              x={cx}
              y={cy + 5}
              textAnchor="middle"
              fontSize={14}
              fontWeight={700}
              fill="var(--ink)"
            >
              {name
                .split(" ")
                .map((p) => p[0])
                .slice(0, 2)
                .join("")}
            </text>
            <text x={cx} y={cy + 52} textAnchor="middle" fontSize={14} fontWeight={600} fill="var(--ink)">
              {name}
            </text>
            <text x={cx} y={cy + 70} textAnchor="middle" fontSize={12.5} fill="var(--ink-3)">
              {data.customer.customer_id}
            </text>

            {idNodes.map((n) => {
              const p = labelPlacement(n.x, n.y, cx, cy);
              return (
                <g key={`e-${n.type}-${n.value}`}>
                  <circle cx={n.x} cy={n.y} r={7.5} fill={EVIDENCE.identifier.fill}>
                    <title>{`${n.type}: ${n.value}`}</title>
                  </circle>
                  <text
                    x={n.x + p.dx}
                    y={n.y + p.dy1}
                    textAnchor={p.anchor}
                    fontSize={13}
                    fontWeight={600}
                    fill="var(--ink)"
                  >
                    {n.type.replace(/_/g, " ")}
                  </text>
                  <text
                    x={n.x + p.dx}
                    y={n.y + p.dy2}
                    textAnchor={p.anchor}
                    fontSize={12.5}
                    fill="var(--ink-3)"
                  >
                    {truncate(n.value)}
                  </text>
                </g>
              );
            })}

            {sigNodes.map((n) => {
              const p = labelPlacement(n.x, n.y, cx, cy);
              const e = EVIDENCE[signalKind(n.type)];
              return (
                <g key={`s-${n.type}-${n.value}`}>
                  <circle cx={n.x} cy={n.y} r={6.5} fill={e.fill} stroke={e.stroke} strokeWidth={2}>
                    <title>{`${n.type}: ${n.value}\nlast seen ${n.last_seen ?? "unknown"}`}</title>
                  </circle>
                  <text
                    x={n.x + p.dx}
                    y={n.y + p.dy1}
                    textAnchor={p.anchor}
                    fontSize={13}
                    fontWeight={600}
                    fill="var(--ink)"
                  >
                    {n.type.replace(/_/g, " ")}
                  </text>
                  <text
                    x={n.x + p.dx}
                    y={n.y + p.dy2}
                    textAnchor={p.anchor}
                    fontSize={12.5}
                    fill="var(--ink-3)"
                  >
                    {truncate(n.value)}
                  </text>
                </g>
              );
            })}

            {/* Refusals: a numbered badge, keyed to the ledger below. No text on
                the arc, so adding refusals can never crowd another label. */}
            {conflictNodes.map((n) => (
              <g key={`c-${n.event_id}`}>
                <title>{`Refused link ${n.n} · ${n.method.replace(/_/g, " ")}\nevent ${n.event_id}\n${stamp(n.decided_at)}`}</title>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={9.5}
                  fill="var(--graph-node-fill)"
                  stroke="var(--flag)"
                  strokeWidth={1.8}
                />
                <text
                  x={n.x}
                  y={n.y + 4}
                  textAnchor="middle"
                  fontSize={11}
                  fontWeight={700}
                  fill="var(--flag)"
                >
                  {n.n}
                </text>
              </g>
            ))}
          </svg>
        )}
      </div>

      <p className="t-body text-soft mt-3 max-w-4xl">
        Solid marks are identifiers we can prove. Rings are behaviour we can only infer, and they
        never carry a link on their own.
        {conflicts.length > 0 && (
          <>
            {" "}
            The{" "}
            <span style={{ color: "var(--flag)", fontWeight: 600 }}>
              {conflicts.length} refused link{conflicts.length === 1 ? "" : "s"}
            </span>{" "}
            went to a human instead of into this graph.
          </>
        )}
      </p>

      {conflicts.length > 0 && (
        <div className="mt-7">
          <div className="flex items-end justify-between gap-6 flex-wrap">
            <div>
              <div className="eyebrow" style={{ color: "var(--flag)" }}>
                Held apart, not merged
              </div>
              <h3 className="t-h2 mt-1.5" style={{ fontSize: "1.125rem" }}>
                Every refused link for this member
              </h3>
            </div>
            <p className="t-label text-muted max-w-md text-right">
              {undrawn > 0
                ? `Marks 1–${DRAWN_CONFLICTS} are drawn on the graph. All ${conflicts.length} are listed here — ${undrawn} of them carry no mark.`
                : `All ${conflicts.length} are drawn on the graph and listed here.`}
              {saturated && " The API returns a member's 20 most recent; the review queue holds the rest."}
            </p>
          </div>

          <div className="mt-3 overflow-x-auto scroll-quiet">
            <table className="ledger">
              <caption className="sr-only">
                Links the resolver refused to make for {name}
              </caption>
              <thead>
                <tr>
                  <th>Mark</th>
                  <th>Decided</th>
                  <th>Which guard refused</th>
                  <th>Held apart from</th>
                  <th>Evidence</th>
                  <th>Event</th>
                </tr>
              </thead>
              <tbody>
                {conflicts.map((c) => {
                  const others = heldApartFrom(c.detail, data.customer.customer_id);
                  const evidence = refusalEvidence(c.detail);
                  return (
                    <tr key={`cr-${c.event_id}`}>
                      <td
                        className="figure t-label"
                        style={{
                          color: c.n <= DRAWN_CONFLICTS ? "var(--flag)" : "var(--ink-3)",
                          fontWeight: 600,
                        }}
                        title={c.n <= DRAWN_CONFLICTS ? "Drawn on the graph" : "Listed only — no mark on the graph"}
                      >
                        {c.n}
                      </td>
                      <td className="figure t-label text-muted whitespace-nowrap">
                        {stamp(c.decided_at)}
                      </td>
                      <td className="font-medium whitespace-nowrap">{c.method.replace(/_/g, " ")}</td>
                      <td className="whitespace-nowrap">
                        {others.length ? (
                          others.map((o) => (
                            <Link
                              key={o}
                              href={`/dashboard/customers/${o}`}
                              className="text-link figure t-label block"
                            >
                              {o} →
                            </Link>
                          ))
                        ) : (
                          <span className="t-label text-muted">No other member named</span>
                        )}
                      </td>
                      <td className="t-label text-soft max-w-[20rem]">{evidence || "—"}</td>
                      <td className="figure t-label text-muted">{c.event_id}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
