import { Metrics } from "@/lib/api";
import { LIVE_FIGURE_NOTES, PORTFOLIO, churnSaveValue, repeatContactValue, inr} from "@/lib/economics";

/* ==========================================================================
   The verdict band
   --------------------------------------------------------------------------
   What a director sees before scrolling and before any chart: the answer, in
   one sentence, with its consequence in money and minutes. The arithmetic is
   open — the inputs are one click away, so the numbers can be argued with
   instead of taken on faith.

   Each money figure is given twice: what the observed cohort is worth, and the
   same rate projected onto the 1.30M cards RBI says AmEx has in force. The
   first is true and small; the second is what it means at scale and says so.
   Never the second alone — a demo-sized cohort dressed as a book is the one
   thing that would cost us the room.
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
  // The cohort size is what turns a count into a rate, and a rate is the only
  // thing worth projecting onto the real card base.
  const cohort = totals.customers;
  const servicing = repeatContactValue(repeatCustomers, repeatWindowDays, cohort);
  const churn = churnSaveValue(totals.open_alerts, cohort);
  const atScale = `${(PORTFOLIO.cardsInForce / 1_000_000).toFixed(2)}M cards in force`;

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
            value={inr(servicing.perYear)}
            unit="/year"
            label="Avoidable servicing cost"
            note={`${repeatCustomers.toLocaleString()} of ${cohort.toLocaleString()} members told the same story twice in ${repeatWindowDays} days`}
            projection={
              servicing.portfolioPerYear === null
                ? undefined
                : `${inr(servicing.portfolioPerYear)} at that rate across ${atScale}`
            }
          />
          <Figure
            value={inr(churn.perYear)}
            unit="/year"
            label="Retained margin in reach"
            note={`${totals.open_alerts.toLocaleString()} churn signals open right now`}
            flagged={totals.open_alerts > 0}
            projection={
              churn.portfolioPerYear === null
                ? undefined
                : `${inr(churn.portfolioPerYear)} at that rate across ${atScale}`
            }
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
              The counts are measured. The prices come from published figures —
              RBI's card statistics for the base, AmEx's own reported revenue yield
              for what a card is worth, and a built-up Indian servicing seat for
              what a contact costs. Every one of them, with its derivation and its
              source, is served at{" "}
              <span className="figure">/api/economics</span>.
            </p>
            <p className="t-label mb-3" style={{ color: "var(--ink-band-2)" }}>
              The projected lines take the rate we measured and apply it to the card
              base — they are not additions to the portfolio model further down this
              page, which prices handle time rather than whole avoided contacts.
            </p>
            <dl className="grid sm:grid-cols-2 gap-x-10 gap-y-1.5">
              {LIVE_FIGURE_NOTES.map((a) => (
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

function Figure({value, unit, label, note, projection, flagged}: {
  value: string;
  unit?: string;
  label: string;
  note: string;
  /** The same rate at portfolio scale. Always secondary to the measured line. */
  projection?: string;
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
      {projection && (
        <div className="figure t-label mt-1" style={{ color: "var(--ink-band-2)" }}>
          → {projection}
        </div>
      )}
    </div>
  );
}
