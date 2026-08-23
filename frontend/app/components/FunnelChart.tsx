"use client";
import { Funnel } from "@/lib/api";

/* Where journeys break.
   One continuous descending rule instead of six coloured bars: the plateaus
   are the customers still with you, and every warm vertical segment is the
   moment you lost some. The eye finds the longest red drop unprompted, which
   is the only thing this view is for. Drawn by hand in SVG — a charting
   library's defaults are exactly the look we're trying to leave behind. */

const LEFT = 18;
const RIGHT = 1182;
const TOP = 44;
const BASE = 252;
const AXIS = 300;
const VB_H = 330;

export function FunnelChart({ funnel }: { funnel: Funnel }) {
  const steps = funnel.steps ?? [];

  if (steps.length < 2) {
    return (
      <section>
        <Header hours={funnel.window_hours} />
        <div className="panel">
          <p className="t-body text-soft py-10">
            Not enough journey activity in this window to draw a funnel. Widen the window, or run the
            hero scenario to generate a journey.
          </p>
        </div>
      </section>
    );
  }

  const max = Math.max(...steps.map((s) => s.count), 1);
  const w = (RIGHT - LEFT) / steps.length;
  const y = (n: number) => BASE - (n / max) * (BASE - TOP);

  const nodes = steps.map((s, i) => ({
    ...s,
    label: s.step.replace(/_/g, " "),
    x0: LEFT + i * w,
    x1: LEFT + (i + 1) * w,
    y: y(s.count),
  }));

  // Plateaus and drops as one path, so it reads as a single rule.
  const line = nodes
    .map((n, i) => `${i === 0 ? `M ${n.x0} ${n.y}` : `L ${n.x0} ${n.y}`} L ${n.x1} ${n.y}`)
    .join(" ");
  const area = `${line} L ${nodes[nodes.length - 1].x1} ${BASE} L ${LEFT} ${BASE} Z`;

  const drops = nodes.slice(0, -1).map((n, i) => ({
    x: n.x1,
    yFrom: n.y,
    yTo: nodes[i + 1].y,
    lost: n.count - nodes[i + 1].count,
    pct: nodes[i + 1].drop_off_pct,
  }));

  const worst = [...drops].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0))[0];

  return (
    <section>
      <Header hours={funnel.window_hours} />

      <div className="panel">
        <svg
          viewBox={`0 0 1200 ${VB_H}`}
          className="w-full h-auto"
          role="img"
          aria-label={steps.map((s) => `${s.step.replace(/_/g, " ")}: ${s.count}`).join("; ")}
        >
          <path d={area} fill="var(--blue)" fillOpacity={0.07} />

          {/* Drops first, so the retained rule sits on top of them */}
          {drops.map((d, i) => {
            const isWorst = worst && d.x === worst.x && (d.pct ?? 0) > 0;
            const mid = (d.yFrom + d.yTo) / 2;
            return (
              <g key={i}>
                <line
                  x1={d.x}
                  y1={d.yFrom}
                  x2={d.x}
                  y2={d.yTo}
                  stroke="var(--flag)"
                  strokeWidth={isWorst ? 3.5 : 2}
                  strokeOpacity={isWorst ? 1 : 0.55}
                />
                {d.lost > 0 && (
                  <text
                    x={d.x + 9}
                    y={mid + 4}
                    fontSize={13}
                    fontWeight={isWorst ? 700 : 500}
                    fill="var(--flag)"
                    className="figure"
                  >
                    −{d.lost.toLocaleString()}
                    {d.pct != null ? ` (${d.pct}%)` : ""}
                  </text>
                )}
              </g>
            );
          })}

          <path d={line} fill="none" stroke="var(--blue)" strokeWidth={2.75} strokeLinejoin="round" />

          {nodes.map((n) => (
            <g key={n.step}>
              <text
                x={(n.x0 + n.x1) / 2}
                y={n.y - 13}
                textAnchor="middle"
                fontSize={16}
                fontWeight={600}
                fill="var(--ink)"
                className="figure"
              >
                {n.count.toLocaleString()}
              </text>
              <line
                x1={n.x0}
                y1={BASE}
                x2={n.x0}
                y2={BASE + 5}
                stroke="var(--rule-strong)"
                strokeWidth={1}
              />
              <text
                x={(n.x0 + n.x1) / 2}
                y={AXIS - 22}
                textAnchor="middle"
                fontSize={13}
                fontWeight={600}
                letterSpacing="0.06em"
                fill="var(--ink-2)"
                style={{ textTransform: "uppercase" }}
              >
                {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
              </text>
            </g>
          ))}

          <line x1={LEFT} y1={BASE} x2={RIGHT} y2={BASE} stroke="var(--rule-strong)" strokeWidth={1} />
          <text x={LEFT} y={AXIS + 4} fontSize={13} fill="var(--ink-3)">
            distinct resolved members · last {funnel.window_hours}h
          </text>
        </svg>
      </div>

      {worst && (worst.pct ?? 0) > 0 && (
        <p className="t-body text-soft mt-3 max-w-4xl">
          The deepest drop loses{" "}
          <span className="figure font-semibold" style={{ color: "var(--flag)" }}>
            {worst.lost.toLocaleString()} members ({worst.pct}%)
          </span>{" "}
          at one step. Because JourneySync resolves the same person across channels, a journey that
          continues by phone still counts here — so this drop is real abandonment, not a tracking gap.
        </p>
      )}
    </section>
  );
}

function Header({ hours }: { hours: number }) {
  return (
    <div className="flex items-end justify-between gap-6 flex-wrap mb-3">
      <div>
        <div className="eyebrow">Distinct members, not clicks</div>
        <h2 className="t-h2 mt-1.5">Where journeys break</h2>
      </div>
      <div className="flex items-center gap-4 t-label text-muted">
        <span className="flex items-center gap-1.5">
          <i className="inline-block w-4 h-[2px]" style={{ background: "var(--blue)" }} />
          still with you
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block w-[2px] h-4" style={{ background: "var(--flag)" }} />
          lost at this step
        </span>
      </div>
    </div>
  );
}
