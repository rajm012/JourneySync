"use client";

import { useEffect, useMemo, useState } from "react";
import { IdentityGraphConflict, TimelineEvent } from "@/lib/api";
import { CHANNEL_ORDER, channel, eventLabel } from "@/lib/channels";
import { ChannelIcon } from "./ChannelIcon";

/* ==========================================================================
   The Journey Spine
   --------------------------------------------------------------------------
   The whole product in one picture: four channel lanes on one shared clock,
   and the resolver's links drawn as stitches between them. Four silos, one
   person. A refused link stays visibly refused in the one warm colour the
   system allows, which is the "we never silently merge" claim made visually
   rather than asserted in a caption.
   ========================================================================== */

const VB_W = 1200;
const GUTTER = 108; // lane label column
const PAD_R = 26;
const LANE_TOP = 42;
const LANE_GAP = 62;
const REFUSED_Y = LANE_TOP + LANE_GAP * 3 + 70;
const AXIS_Y = REFUSED_Y + 40;
const VB_H = AXIS_Y + 14;

const X0 = GUTTER + 10;
const X1 = VB_W - PAD_R;

const MARK_STEP = 26; // ms between mark landings
const MARK_BASE = 340; // ms before the first mark lands
const MAX_ARCS = 48;

type Mark = {
  key: string;
  x: number;
  y: number;
  lane: number;
  order: number;
  event: TimelineEvent;
};

function laneIndexOf(ch: string) {
  const i = (CHANNEL_ORDER as readonly string[]).indexOf(ch);
  return i === -1 ? CHANNEL_ORDER.length - 1 : i;
}

function laneY(i: number) {
  return LANE_TOP + i * LANE_GAP;
}

/** Control-polygon length — always ≥ the curve's own length, which is all the
 *  draw-on animation needs to hide the path at rest. */
function polyLen(x1: number, y1: number, x2: number, y2: number, dx: number) {
  return Math.abs(dx) + Math.hypot(x2 - dx - (x1 + dx), y2 - y1) + Math.abs(dx);
}

function stitchPath(x1: number, y1: number, x2: number, y2: number) {
  const dx = Math.max(26, (x2 - x1) * 0.45);
  return {
    d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
    len: polyLen(x1, y1, x2, y2, dx),
  };
}

export function JourneySpine({
  events,
  conflicts = [],
  title = "The journey, stitched",
  caption,
}: {
  events: TimelineEvent[];
  conflicts?: IdentityGraphConflict[];
  title?: string;
  caption?: string;
}) {
  const [hover, setHover] = useState<Mark | null>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const model = useMemo(() => {
    const ordered = [...(events ?? [])]
      .filter((e) => e?.occurred_at)
      .sort((a, b) => +new Date(a.occurred_at) - +new Date(b.occurred_at));

    if (!ordered.length) return null;

    const t0 = +new Date(ordered[0].occurred_at);
    const t1 = +new Date(ordered[ordered.length - 1].occurred_at);
    const span = Math.max(1, t1 - t0);
    const width = X1 - X0;

    const marks: Mark[] = ordered.map((e, i) => {
      const lane = laneIndexOf(e.channel);
      const frac = ordered.length === 1 ? 0.5 : (+new Date(e.occurred_at) - t0) / span;
      return {
        key: e.event_id || `${e.channel}-${e.occurred_at}-${i}`,
        x: X0 + frac * width,
        y: laneY(lane),
        lane,
        order: i,
        event: e,
      };
    });

    // A stitch is a hand-off: two consecutive events on different channels that
    // the resolver attributed to the same person.
    const stitches: { key: string; d: string; len: number; order: number }[] = [];
    for (let i = 1; i < marks.length && stitches.length < MAX_ARCS; i++) {
      const a = marks[i - 1];
      const b = marks[i];
      if (a.lane === b.lane) continue;
      const p = stitchPath(a.x, a.y, b.x, b.y);
      stitches.push({ key: `${a.key}->${b.key}`, ...p, order: b.order });
    }
    const crossings = marks.reduce((n, m, i) => (i && marks[i - 1].lane !== m.lane ? n + 1 : n), 0);

    // Refused links get their own strip so the eye can find them.
    const refused = conflicts.slice(0, 4).map((c, i) => {
      const at = c.decided_at ? +new Date(c.decided_at) : t1;
      const frac = Math.min(1, Math.max(0, (at - t0) / span));
      const x = X0 + frac * width;
      const from = marks.find((m) => m.event.event_id === c.event_id) ?? marks[marks.length - 1];
      const p = stitchPath(from.x, from.y, x, REFUSED_Y);
      return { key: c.event_id || `refused-${i}`, x, method: c.method, from, ...p };
    });

    const channelsUsed = new Set(marks.map((m) => m.lane));
    const assisted = marks.filter((m) => channel(m.event.channel).assisted).length;

    return {
      marks,
      stitches,
      refused,
      crossings,
      channelsUsed,
      assisted,
      t0: ordered[0].occurred_at,
      tMid: ordered[Math.floor((ordered.length - 1) / 2)].occurred_at,
      t1: ordered[ordered.length - 1].occurred_at,
      spanHours: span / 3_600_000,
      total: ordered.length,
      hiddenArcs: Math.max(0, crossings - stitches.length),
    };
  }, [events, conflicts]);

  const settleMs = model ? MARK_BASE + model.total * MARK_STEP : 0;

  if (!model) {
    return (
      <section>
        <SpineHeader title={title} />
        <div className="panel">
          <p className="t-body text-soft py-10 text-center">
            No journey yet. Run the hero scenario to stream Asha&apos;s four-channel journey and watch
            the lanes stitch together in real time.
          </p>
        </div>
      </section>
    );
  }

  const shown = hover?.event;

  return (
    <section>
      <SpineHeader
        title={title}
        right={
          <div className="flex items-center gap-4">
            {CHANNEL_ORDER.map((c) => {
              const def = channel(c);
              const used = model.channelsUsed.has(laneIndexOf(c));
              return (
                <span
                  key={c}
                  className="flex items-center gap-1.5 t-label"
                  style={{ color: used ? "var(--ink-2)" : "var(--ink-3)", opacity: used ? 1 : 0.55 }}
                >
                  <i
                    className="inline-block w-2.5 h-2.5 rounded-full"
                    style={{ background: used ? def.color : "var(--ch-none)" }}
                  />
                  {def.label}
                </span>
              );
            })}
            {model.refused.length > 0 && (
              <span className="flex items-center gap-1.5 t-label" style={{ color: "var(--flag)" }}>
                <i className="inline-block w-2.5 h-2.5" style={{ background: "var(--flag)" }} />
                refused
              </span>
            )}
          </div>
        }
      />

      <div className="panel">
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          className="w-full h-auto select-none"
          role="img"
          aria-label={`${model.total} events across ${model.channelsUsed.size} channels over ${model.spanHours.toFixed(1)} hours, with ${model.crossings} cross-channel hand-offs and ${model.refused.length} refused links.`}
        >
          {/* Lanes — always all four, so the frame itself says "four channels" */}
          {CHANNEL_ORDER.map((c, i) => {
            const def = channel(c);
            const used = model.channelsUsed.has(i);
            const y = laneY(i);
            return (
              <g key={c}>
                <text
                  x={GUTTER - 14}
                  y={y + 4}
                  textAnchor="end"
                  className="font-sans"
                  fontSize={13}
                  fontWeight={600}
                  letterSpacing="0.11em"
                  fill={used ? "var(--ink-2)" : "var(--ink-3)"}
                  opacity={used ? 1 : 0.6}
                >
                  {def.short}
                </text>
                <line
                  className="spine-lane"
                  x1={X0 - 8}
                  y1={y}
                  x2={X1}
                  y2={y}
                  stroke={used ? "var(--rule-strong)" : "var(--rule)"}
                  strokeWidth={used ? 1.25 : 1}
                  strokeDasharray={used ? undefined : "3 5"}
                  style={
                    {
                      "--len": X1 - X0 + 8,
                      animationDelay: `${i * 70}ms`,
                    } as React.CSSProperties
                  }
                />
                {!used && (
                  <text
                    x={X0 + 4}
                    y={y - 9}
                    fontSize={12.5}
                    fill="var(--ink-3)"
                    className="spine-note"
                    style={{ animationDelay: `${settleMs}ms` }}
                  >
                    no activity in this window
                  </text>
                )}
              </g>
            );
          })}

          {/* Stitches — the resolver's work, drawn as hand-offs between lanes */}
          {model.stitches.map((s) => (
            <path
              key={s.key}
              className="spine-arc"
              d={s.d}
              fill="none"
              stroke="var(--blue)"
              strokeWidth={1.6}
              strokeOpacity={0.62}
              style={
                {
                  "--len": s.len,
                  animationDelay: `${MARK_BASE + s.order * MARK_STEP + 30}ms`,
                } as React.CSSProperties
              }
            />
          ))}

          {/* Refused strip */}
          {model.refused.length > 0 && (
            <>
              <line
                x1={X0 - 8}
                y1={REFUSED_Y}
                x2={X1}
                y2={REFUSED_Y}
                stroke="var(--flag)"
                strokeOpacity={0.3}
                strokeWidth={1}
                strokeDasharray="4 5"
              />
              <text
                x={GUTTER - 14}
                y={REFUSED_Y + 4}
                textAnchor="end"
                fontSize={13}
                fontWeight={600}
                letterSpacing="0.11em"
                fill="var(--flag)"
              >
                REFUSED
              </text>
              {model.refused.map((r, i) => (
                <g key={r.key}>
                  <path
                    className="spine-arc"
                    d={r.d}
                    fill="none"
                    stroke="var(--flag)"
                    strokeWidth={1.6}
                    strokeDasharray="5 4"
                    style={
                      {
                        "--len": r.len,
                        animationDelay: `${settleMs + 120 + i * 140}ms`,
                      } as React.CSSProperties
                    }
                  />
                  <g
                    className="spine-mark"
                    style={{ animationDelay: `${settleMs + 400 + i * 140}ms` }}
                  >
                    <path
                      d={`M ${r.x - 5} ${REFUSED_Y - 5} L ${r.x + 5} ${REFUSED_Y + 5} M ${r.x + 5} ${REFUSED_Y - 5} L ${r.x - 5} ${REFUSED_Y + 5}`}
                      stroke="var(--flag)"
                      strokeWidth={2.1}
                      strokeLinecap="round"
                    />
                    <title>{`Link refused — ${r.method}`}</title>
                  </g>
                </g>
              ))}
              <text
                x={X0 + 4}
                y={REFUSED_Y + 26}
                fontSize={12.5}
                fill="var(--ink-3)"
                className="spine-note"
                style={{ animationDelay: `${settleMs + 620}ms` }}
              >
                strong identifier and strong behaviour disagreed — held for a human, never merged
              </text>
            </>
          )}

          {/* Marks */}
          {model.marks.map((m) => {
            const def = channel(m.event.channel);
            const active = hover?.key === m.key;
            return (
              <g
                key={m.key}
                className="spine-mark"
                style={{ animationDelay: `${MARK_BASE + m.order * MARK_STEP}ms` }}
                onMouseEnter={() => setHover(m)}
                onMouseLeave={() => setHover((h) => (h?.key === m.key ? null : h))}
              >
                {active && (
                  <circle cx={m.x} cy={m.y} r={11} fill={def.color} fillOpacity={0.18} />
                )}
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={active ? 7 : 5.4}
                  fill={def.color}
                  stroke="var(--paper)"
                  strokeWidth={1.5}
                />
                {/* Generous invisible hit area — 5px targets are unhittable live */}
                <circle cx={m.x} cy={m.y} r={13} fill="transparent" style={{ cursor: "pointer" }} />
                <title>{`${eventLabel(m.event.event_type)} · ${def.label}`}</title>
              </g>
            );
          })}

          {/* Clock */}
          <line x1={X0 - 8} y1={AXIS_Y - 16} x2={X1} y2={AXIS_Y - 16} stroke="var(--rule)" strokeWidth={1} />
          <AxisTick x={X0 - 8} anchor="start" iso={model.t0} mounted={mounted} withDate={model.spanHours > 24} />
          <AxisTick x={(X0 + X1) / 2} anchor="middle" iso={model.tMid} mounted={mounted} withDate={model.spanHours > 24} />
          <AxisTick x={X1} anchor="end" iso={model.t1} mounted={mounted} withDate={model.spanHours > 24} />
        </svg>

        {/* Readout. A hover detail belongs here at full size, not in a 10px
            tooltip nobody in the third row can read. */}
        <div className="mt-3 flex items-baseline gap-3 min-h-[1.75rem] t-body">
          {shown ? (
            <>
              <span
                className="flex items-center gap-2 shrink-0"
                style={{ color: channel(shown.channel).color }}
              >
                <ChannelIcon channel={shown.channel} />
              </span>
              <span className="font-semibold">{eventLabel(shown.event_type)}</span>
              <span className="text-soft">{channel(shown.channel).label}</span>
              <span className="figure text-soft">
                {Math.round((shown.confidence ?? 0) * 100)}% match
              </span>
              <span className="text-muted t-label">
                {shown.match_method?.replace(/_/g, " ")}
              </span>
            </>
          ) : (
            <span className="text-muted">
              Point at any mark to see how that event was matched.
            </span>
          )}
        </div>
      </div>

      <p className="t-body text-soft mt-3 max-w-4xl">
        {caption ?? (
          <>
            <span className="figure font-semibold" style={{ color: "var(--ink)" }}>
              {model.crossings}
            </span>{" "}
            cross-channel hand-offs in{" "}
            <span className="figure font-semibold" style={{ color: "var(--ink)" }}>
              {model.spanHours < 1
                ? `${Math.round(model.spanHours * 60)} minutes`
                : `${model.spanHours.toFixed(1)} hours`}
            </span>
            . Without this, each blue stitch is a customer starting their story over.
            {model.hiddenArcs > 0 && (
              <span className="text-muted"> {model.hiddenArcs} further hand-offs not drawn.</span>
            )}
          </>
        )}
      </p>
    </section>
  );
}

function SpineHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-6 flex-wrap mb-3">
      <div>
        <div className="eyebrow">One customer · four channels · one clock</div>
        <h2 className="t-h2 mt-1.5">{title}</h2>
      </div>
      {right}
    </div>
  );
}

/** Server renders the stable UTC slice, the browser upgrades to local time
 *  after mount — same trick the timeline uses to dodge hydration mismatch. */
function AxisTick({
  x,
  anchor,
  iso,
  mounted,
  withDate,
}: {
  x: number;
  anchor: "start" | "middle" | "end";
  iso: string;
  mounted: boolean;
  withDate: boolean;
}) {
  const [text, setText] = useState(iso.slice(11, 16));
  useEffect(() => {
    if (!mounted) return;
    const d = new Date(iso);
    setText(
      withDate
        ? d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
        : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    );
  }, [iso, mounted, withDate]);
  return (
    <text x={x} y={AXIS_Y} textAnchor={anchor} fontSize={13} fill="var(--ink-3)" className="figure">
      {text}
    </text>
  );
}
