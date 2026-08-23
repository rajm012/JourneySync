"use client";
import { Metrics } from "@/lib/api";

/* The statement summary line. Figures in tabular mono so the columns align,
   separated by hairlines rather than sitting in four identical boxes. */

export function MetricsStrip({ metrics, compact = false }: { metrics: Metrics; compact?: boolean }) {
  const { totals, latency, accuracy } = metrics;
  const pct = (v?: number) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

  const cells = [
    {
      label: "In the identity graph",
      value: totals.customers.toLocaleString(),
      note: `${totals.resolutions.toLocaleString()} links made`,
    },
    {
      label: "Precision",
      value: pct(accuracy?.precision),
      note: accuracy?.source === "eval_harness" ? "eval harness" : "live audit · 24h",
    },
    {
      label: "Recall",
      value: pct(accuracy?.recall),
      note:
        accuracy?.customers_touched != null && accuracy?.catalog_size != null
          ? `${accuracy.customers_touched.toLocaleString()} of ${accuracy.catalog_size.toLocaleString()} in catalog`
          : "catalog coverage",
    },
    {
      label: "Held for review",
      value: totals.uncertain.toLocaleString(),
      note: totals.uncertain > 0 ? "awaiting an analyst" : "queue is clear",
      flagged: totals.uncertain > 0,
    },
    ...(compact
      ? []
      : [
          {
            label: "Time to link",
            value: latency.samples ? `${latency.p95.toFixed(0)} ms` : "—",
            note: latency.samples
              ? `p50 ${latency.p50.toFixed(0)} · p99 ${latency.p99.toFixed(0)} · ${latency.samples.toLocaleString()} samples`
              : "waiting for resolved events",
          },
          {
            label: "Risk signals open",
            value: totals.open_alerts.toLocaleString(),
            note: `${totals.alerts.toLocaleString()} raised in total`,
            flagged: totals.open_alerts > 0,
          },
        ]),
  ];

  return (
    <dl
      className="grid grid-cols-2 sm:grid-cols-4 gap-y-5 border-t"
      style={{
        borderColor: "var(--rule-strong)",
        gridTemplateColumns: compact ? undefined : "repeat(auto-fit, minmax(9.5rem, 1fr))",
      }}
    >
      {cells.map((c, i) => (
        <div
          key={c.label}
          className="pt-3.5 pr-5"
          style={{ borderLeft: i === 0 ? undefined : "1px solid var(--rule)", paddingLeft: i === 0 ? 0 : "1.25rem" }}
        >
          <dt className="eyebrow">{c.label}</dt>
          <dd
            className="figure mt-1.5"
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              lineHeight: 1.1,
              letterSpacing: "-0.03em",
              color: c.flagged ? "var(--flag)" : "var(--ink)",
            }}
          >
            {c.value}
          </dd>
          <dd className="t-label text-muted mt-0.5">{c.note}</dd>
        </div>
      ))}
    </dl>
  );
}
