"use client";
import { IdentityGraph } from "@/lib/api";

/* How this person was assembled.
   The spine answers "when, and across what". This answers "on what evidence" —
   and it grades that evidence visually: a solid mark is a deterministic
   identifier, a ring is probabilistic, a grey ring is weak, and the one warm
   mark is a link the resolver refused to make. Evidence strength is the only
   thing encoded here, so there is no second colour scale to learn.
*/

const EVIDENCE = {
  identifier: { fill: "var(--blue)", stroke: "var(--blue)", label: "identifier · deterministic" },
  device: { fill: "var(--graph-node-fill)", stroke: "var(--blue)", label: "device · probabilistic" },
  network: { fill: "var(--graph-node-fill)", stroke: "var(--ink-3)", label: "network · weak" },
  refused: { fill: "var(--graph-node-fill)", stroke: "var(--flag)", label: "refused" },
};

const VB_W = 1000;
const HUB_W = 232;
const HUB_H = 70;
const HUB_CX = VB_W / 2;
const COL_L = 286; // left column node x
const COL_R = VB_W - COL_L; // mirrored, so the figure is symmetric
const ROW = 48; // fixed row pitch — the thing that guarantees no overlap
const TOP = 34;
const MAX_SIGNALS = 10;
const MAX_CONFLICTS = 4;

const LABEL_W = COL_L - 15 - 8; // 263px of clear space beside either column
const MONO_CH = 7.5; // 12.5px IBM Plex Mono
const VALUE_MAX = Math.floor(LABEL_W / MONO_CH) - 3;

function signalKind(type: string): "device" | "network" {
  return type === "ip_subnet" ? "network" : "device";
}

function truncate(v: string, n: number) {
  return v.length > n ? `${v.slice(0, n - 1)}…` : v;
}

/** Centre `count` rows of pitch ROW on `mid`. */
function column(count: number, mid: number): number[] {
  return Array.from({ length: count }, (_, i) => mid - ((count - 1) * ROW) / 2 + i * ROW);
}

export function IdentityGraphView({ data }: { data: IdentityGraph }) {
  const identifiers = data.identifiers;
  const signals = data.signals.slice(0, MAX_SIGNALS);
  const conflicts = data.conflicts.slice(0, MAX_CONFLICTS);
  const signalOverflow = data.signals.length - signals.length;
  const conflictOverflow = data.conflicts.length - conflicts.length;

  const hasAny = identifiers.length + signals.length + conflicts.length > 0;
  const name = data.customer.name || data.customer.customer_id;

  // The hub has to fit even when one column is empty, hence the floor.
  const rows = Math.max(identifiers.length, signals.length);
  const contentH = Math.max(HUB_H + 28, rows * ROW);
  const hubCy = TOP + contentH / 2;

  const idY = column(identifiers.length, hubCy);
  const sigY = column(signals.length, hubCy);

  const refusedBlock = conflicts.length > 0;
  const refRuleY = TOP + contentH + 40;
  const VB_H = TOP + contentH + (refusedBlock ? 104 : 26);

  // Edges leave the hub's edge, not its centre, so they never sit under the
  // customer id.
  const hubL = HUB_CX - HUB_W / 2;
  const hubR = HUB_CX + HUB_W / 2;

  const legend: { key: string; fill: string; stroke: string; label: string }[] = [
    { key: "identifier", ...EVIDENCE.identifier },
    { key: "device", ...EVIDENCE.device },
    { key: "network", ...EVIDENCE.network },
  ];
  if (conflicts.length) legend.push({ key: "refused", ...EVIDENCE.refused });

  const refSlot = conflicts.length ? VB_W / conflicts.length : VB_W;
  const refMax = Math.floor((refSlot - 24) / MONO_CH);

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
            viewBox={`0 0 ${VB_W} ${VB_H}`}
            className="w-full h-auto"
            role="img"
            aria-label={`${data.customer.customer_id}: ${identifiers.length} proven identifiers, ${data.signals.length} behavioural signals and ${data.conflicts.length} refused links.`}
          >
            {/* Edges first, so every mark and every glyph sits above them */}
            {idY.map((y, i) => (
              <path
                key={`el-${i}`}
                d={edge(hubL, hubCy, COL_L + 10, y, -1)}
                fill="none"
                stroke="var(--blue)"
                strokeOpacity={0.5}
                strokeWidth={1.5}
              />
            ))}
            {sigY.map((y, i) => (
              <path
                key={`sl-${i}`}
                d={edge(hubR, hubCy, COL_R - 10, y, 1)}
                fill="none"
                stroke={signalKind(signals[i].type) === "network" ? "var(--ink-3)" : "var(--blue)"}
                strokeOpacity={0.34}
                strokeWidth={1.25}
              />
            ))}

            {/* Column headers, each above its own first row so the label sits
                next to what it names even when the columns differ in height */}
            {identifiers.length > 0 && (
              <text
                x={COL_L + 10}
                y={idY[0] - 30}
                textAnchor="end"
                fontSize={12.5}
                fontWeight={700}
                letterSpacing="0.11em"
                fill="var(--ink-3)"
              >
                PROVEN IDENTIFIERS
              </text>
            )}
            {signals.length > 0 && (
              <text
                x={COL_R - 10}
                y={sigY[0] - 30}
                fontSize={12.5}
                fontWeight={700}
                letterSpacing="0.11em"
                fill="var(--ink-3)"
              >
                BEHAVIOURAL SIGNALS
              </text>
            )}

            {/* The member. The account number is the headline — it is the one
                string an analyst will read back over the phone. */}
            <rect
              x={hubL}
              y={hubCy - HUB_H / 2}
              width={HUB_W}
              height={HUB_H}
              rx={4}
              fill="var(--graph-node-fill)"
              stroke="var(--blue)"
              strokeWidth={2.5}
            />
            <text
              x={HUB_CX}
              y={hubCy - 4}
              textAnchor="middle"
              fontSize={19}
              fontWeight={700}
              letterSpacing="0.01em"
              fill="var(--ink)"
              className="figure"
            >
              {truncate(data.customer.customer_id, 18)}
            </text>
            <text
              x={HUB_CX}
              y={hubCy + 19}
              textAnchor="middle"
              fontSize={13}
              fill="var(--ink-2)"
            >
              {truncate(name, 26)}
            </text>

            {/* Identifiers — solid marks, labels running left, away from the hub */}
            {identifiers.map((n, i) => (
              <g key={`e-${n.type}-${n.value}`}>
                <circle cx={COL_L} cy={idY[i]} r={7.5} fill={EVIDENCE.identifier.fill}>
                  <title>{`${n.type}: ${n.value}`}</title>
                </circle>
                <text
                  x={COL_L - 15}
                  y={idY[i] - 4}
                  textAnchor="end"
                  fontSize={13}
                  fontWeight={600}
                  fill="var(--ink)"
                >
                  {n.type.replace(/_/g, " ")}
                </text>
                <text
                  x={COL_L - 15}
                  y={idY[i] + 14}
                  textAnchor="end"
                  fontSize={12.5}
                  fill="var(--ink-3)"
                  className="figure"
                >
                  {truncate(n.value, VALUE_MAX)}
                </text>
              </g>
            ))}

            {/* Signals — ringed marks, labels running right */}
            {signals.map((n, i) => {
              const e = EVIDENCE[signalKind(n.type)];
              return (
                <g key={`s-${n.type}-${n.value}`}>
                  <circle
                    cx={COL_R}
                    cy={sigY[i]}
                    r={6.5}
                    fill={e.fill}
                    stroke={e.stroke}
                    strokeWidth={2}
                  >
                    <title>{`${n.type}: ${n.value}\nlast seen ${n.last_seen ?? "unknown"}`}</title>
                  </circle>
                  <text
                    x={COL_R + 15}
                    y={sigY[i] - 4}
                    fontSize={13}
                    fontWeight={600}
                    fill="var(--ink)"
                  >
                    {n.type.replace(/_/g, " ")}
                  </text>
                  <text
                    x={COL_R + 15}
                    y={sigY[i] + 14}
                    fontSize={12.5}
                    fill="var(--ink-3)"
                    className="figure"
                  >
                    {truncate(n.value, VALUE_MAX)}
                  </text>
                </g>
              );
            })}

            {/* Refused links get their own band, below the rule, so nothing the
                resolver declined can be mistaken for evidence it accepted. The
                stub drops down the centre gutter — the one vertical corridor
                both columns leave empty — rather than fanning out across the
                lower identifier labels. */}
            {refusedBlock && (
              <>
                <line
                  x1={HUB_CX}
                  y1={hubCy + HUB_H / 2}
                  x2={HUB_CX}
                  y2={refRuleY}
                  stroke="var(--flag)"
                  strokeOpacity={0.75}
                  strokeWidth={1.6}
                  strokeDasharray="5 4"
                />
                <line
                  x1={20}
                  y1={refRuleY}
                  x2={VB_W - 20}
                  y2={refRuleY}
                  stroke="var(--flag)"
                  strokeOpacity={0.3}
                  strokeWidth={1}
                  strokeDasharray="4 5"
                />
                {conflicts.map((c, i) => {
                  const x = refSlot * (i + 0.5);
                  return (
                    <g key={`c-${c.event_id}`}>
                      <path
                        d={`M ${x - 6} ${refRuleY - 6} L ${x + 6} ${refRuleY + 6} M ${x + 6} ${refRuleY - 6} L ${x - 6} ${refRuleY + 6}`}
                        stroke="var(--flag)"
                        strokeWidth={2.4}
                        strokeLinecap="round"
                      >
                        <title>{`Refused (${c.method})\nevent ${c.event_id}\n${c.decided_at ?? ""}`}</title>
                      </path>
                      <text
                        x={x}
                        y={refRuleY + 28}
                        textAnchor="middle"
                        fontSize={13}
                        fontWeight={700}
                        fill="var(--flag)"
                      >
                        refused link
                      </text>
                      <text
                        x={x}
                        y={refRuleY + 46}
                        textAnchor="middle"
                        fontSize={12.5}
                        fill="var(--ink-3)"
                      >
                        {truncate(c.method.replace(/_/g, " "), refMax)}
                      </text>
                    </g>
                  );
                })}
              </>
            )}
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
        {(signalOverflow > 0 || conflictOverflow > 0) && (
          <span className="text-muted">
            {" "}
            {[
              signalOverflow > 0 ? `${signalOverflow} further signals` : null,
              conflictOverflow > 0 ? `${conflictOverflow} further refusals` : null,
            ]
              .filter(Boolean)
              .join(" and ")}{" "}
            not drawn.
          </span>
        )}
      </p>
    </section>
  );
}

/** Hub-edge to column node. `dir` is -1 leftward, +1 rightward. */
function edge(x1: number, y1: number, x2: number, y2: number, dir: number) {
  const dx = Math.abs(x1 - x2) * 0.5 * dir;
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
