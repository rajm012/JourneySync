import { Metrics } from "@/lib/api";
import {
  ASSUMPTION_NOTES,
  churnSaveValue,
  repeatContactValue,
  usd,
} from "@/lib/economics";

/* ==========================================================================
   The verdict band
   --------------------------------------------------------------------------
   What a director sees before scrolling and before any chart: the answer, in
   one sentence, with its consequence in money and minutes. The arithmetic is
   open — the inputs are one click away, so the numbers can be argued with
   instead of taken on faith.
   ========================================================================== */

export function VerdictBand({
  metrics,
  repeatCustomers,
  repeatWindowDays = 30,
  live,
}: {
  metrics: Metrics;
  repeatCustomers: number;
  repeatWindowDays?: number;
  /** false when the API didn't answer — never dress a dead backend as zeroes */
  live: boolean;
}) {
  const { totals, latency } = metrics;
  const servicing = repeatContactValue(repeatCustomers);
  const churn = churnSaveValue(totals.open_alerts);

  return (
    <section className="band">
      <div className="shell py-9 band-in">
        <div className="eyebrow eyebrow-band flex items-center gap-2" style={{ animationDelay: "0ms" }}>
          {live ? (
            <>
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-white/80" />
              Live · rolling 24 hours
            </>
          ) : (
            <>
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: "var(--flag)" }} />
              Not connected to the API
            </>
          )}
        </div>

        <h1 className="t-display mt-3 max-w-4xl" style={{ animationDelay: "70ms" }}>
          <span className="figure" style={{ fontWeight: 700 }}>
            {totals.customers.toLocaleString()}
          </span>{" "}
          card members, unified across four channels.
        </h1>

        <p
          className="t-body mt-3 max-w-2xl"
          style={{ color: "var(--ink-band-2)", animationDelay: "140ms" }}
        >
          Web, app, call center and branch resolved into one timeline as events arrive. Every link
          carries a confidence score and an audit row. Nothing is merged silently.
        </p>

        <div
          className="mt-8 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-y-6 gap-x-10"
          style={{ animationDelay: "210ms" }}
        >
          <Figure
            value={usd(servicing.perYear)}
            unit="/year"
            label="Avoidable servicing cost"
            note={`${repeatCustomers.toLocaleString()} members told the same story twice in ${repeatWindowDays} days`}
          />
          <Figure
            value={usd(churn.perYear)}
            unit="/year"
            label="Retained margin in reach"
            note={`${totals.open_alerts.toLocaleString()} churn signals open right now`}
            flagged={totals.open_alerts > 0}
          />
          <Figure
            value={latency.samples ? latency.p95.toFixed(0) : "—"}
            unit={latency.samples ? "ms" : ""}
            label="Time to link an event"
            note={
              latency.samples
                ? `95th percentile of ${latency.samples.toLocaleString()} measured events`
                : "waiting for the first resolved event"
            }
          />
        </div>

        <details className="mt-7 max-w-3xl no-print" style={{ animationDelay: "280ms" }}>
          <summary
            className="t-label cursor-pointer inline-flex items-center gap-1.5"
            style={{ color: "var(--ink-band-2)" }}
          >
            How these are calculated
          </summary>
          <div className="mt-3 pt-3 border-t" style={{ borderColor: "rgba(255,255,255,0.18)" }}>
            <p className="t-label mb-3" style={{ color: "var(--ink-band-2)" }}>
              Planning assumptions, not measurements. Swap them for AmEx servicing figures and every
              number above recalculates.
            </p>
            <dl className="grid sm:grid-cols-2 gap-x-10 gap-y-1.5">
              {ASSUMPTION_NOTES.map((a) => (
                <div
                  key={a.label}
                  className="flex items-baseline justify-between gap-4 py-1 border-b"
                  style={{ borderColor: "rgba(255,255,255,0.1)" }}
                >
                  <dt className="t-label" style={{ color: "var(--ink-band-2)" }}>
                    {a.label}
                  </dt>
                  <dd className="figure t-label">{a.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </details>
      </div>
    </section>
  );
}

function Figure({
  value,
  unit,
  label,
  note,
  flagged,
}: {
  value: string;
  unit?: string;
  label: string;
  note: string;
  flagged?: boolean;
}) {
  return (
    <div>
      <div className="flex items-baseline gap-1.5">
        <span
          className="figure"
          style={{
            fontSize: "2.125rem",
            fontWeight: 600,
            lineHeight: 1,
            letterSpacing: "-0.03em",
            color: flagged ? "#FF8F7F" : "var(--ink-band)",
          }}
        >
          {value}
        </span>
        {unit && (
          <span className="t-label" style={{ color: "var(--ink-band-2)" }}>
            {unit}
          </span>
        )}
      </div>
      <div className="eyebrow eyebrow-band mt-2.5">{label}</div>
      <div className="t-label mt-1" style={{ color: "var(--ink-band-2)" }}>
        {note}
      </div>
    </div>
  );
}
