
import { MARKET_POSITION, PORTFOLIO, SOURCED_INPUTS, churnSaveValue, inr, inrRange, totalOpportunity} from "@/lib/economics";

/* ==========================================================================
   The opportunity model
   --------------------------------------------------------------------------
   Everything above this section on the page is measured. This section is a
   model, and it says so in its own eyebrow — mixing the two is the one thing
   that would make a director stop trusting the measured half.

   Each stream shows its arithmetic on the same line as its result, and each
   input carries the kind of number it is: regulatory, reported, derived or
   benchmark. That last word is doing real work — it marks the four figures an
   AmEx director can overwrite from their own data, which is a shorter and more
   useful list than "everything here is an assumption".

   The figures carry no colour: money is neither a channel nor a refusal, so it
   stays in ink and the colour rule survives.
   ========================================================================== */

const KIND_LABEL: Record<string, string> = {
  regulatory: "RBI",
  reported: "AmEx reported",
  derived: "Derived",
  benchmark: "Benchmark",
};

export function OpportunityModel() {
  const model = totalOpportunity();
  const perSignal = churnSaveValue(1).perYear;

  return (
    <section>
      <div className="flex items-end justify-between gap-6 flex-wrap mb-4">
        <div>
          <div className="eyebrow">Modelled, not measured</div>
          <h2 className="t-h2 mt-1.5">What this is worth at portfolio scale</h2>
        </div>
        <p className="t-label text-muted max-w-md lg:text-right">
          Built on {PORTFOLIO.cardsInForce.toLocaleString("en-IN")} AmEx India cards
          in force — RBI's June 2026 figure, not an estimate. Every input below
          names its source, and the four marked <em>Benchmark</em> are the ones to
          argue with.
        </p>
      </div>

      <div className="panel">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <span
            className="figure"
            style={{ fontSize: "2.75rem", fontWeight: 600, lineHeight: 1, letterSpacing: "-0.035em" }}
          >
            {inrRange(model.low, model.high)}
          </span>
          <span className="t-body text-soft">a year</span>
          <span className="t-label text-muted">
            · {(model.shareOfRevenueLow * 100).toFixed(1)}–
            {(model.shareOfRevenueHigh * 100).toFixed(1)}% of the{" "}
            {inr(model.revenueProxy)} that spend implies in card revenue
          </span>
        </div>

        <table className="ledger mt-7">
          <caption className="sr-only">The three value streams and their inputs</caption>
          <thead>
            <tr>
              <th>Stream</th>
              <th>How it is derived</th>
              <th className="num">Annual impact</th>
            </tr>
          </thead>
          <tbody>
            {model.streams.map((s) => (
              <tr key={s.key}>
                <td>
                  <div className="t-body font-semibold">{s.label}</div>
                  <div className="t-label text-soft mt-0.5">{s.detail}</div>
                </td>
                <td className="figure t-label text-muted">{s.basis}</td>
                <td className="num t-body font-semibold whitespace-nowrap">
                  {inrRange(s.low, s.high)}
                </td>
              </tr>
            ))}
            <tr>
              <td className="t-body font-semibold">Total</td>
              <td className="t-label text-soft">
                Conservative. Prices handle time rather than whole avoided contacts,
                and excludes NPS, the regulatory value of the audit trail, and the
                fraud signal a stitched timeline produces.
              </td>
              <td className="num t-body font-semibold whitespace-nowrap">
                {inrRange(model.low, model.high)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-7 pt-5 border-t" style={{ borderColor: "var(--rule-strong)" }}>
          <div className="flex items-baseline justify-between gap-4 flex-wrap mb-3">
            <div className="eyebrow">Every input, and where it came from</div>
            <div className="t-label text-muted">
              Served with its arithmetic at{" "}
              <span className="figure">/api/economics</span> — eight of these are
              query parameters
            </div>
          </div>
          <dl className="grid sm:grid-cols-2 gap-x-10 gap-y-0">
            {SOURCED_INPUTS.map((a) => (
              <div
                key={a.label}
                className="py-2.5 border-b"
                style={{ borderColor: "var(--rule)" }}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="t-label">{a.label}</dt>
                  <dd className="figure t-label font-semibold whitespace-nowrap">
                    {a.value}
                  </dd>
                </div>
                <div className="t-label text-soft mt-1">
                  <span className="eyebrow">{KIND_LABEL[a.kind]}</span>
                  <span className="ml-2">{a.source}</span>
                </div>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <p className="t-body text-soft mt-3 max-w-4xl">
        One churn signal caught while the member is still in the journey is worth{" "}
        <span className="figure font-semibold" style={{ color: "var(--ink)" }}>
          {inr(perSignal)}
        </span>{" "}
        a year on its own. The model only becomes a crore figure because AmEx India
        carries{" "}
        <span className="figure font-semibold" style={{ color: "var(--ink)" }}>
          {(MARKET_POSITION.shareOfSpend * 100).toFixed(2)}%
        </span>{" "}
        of India&rsquo;s credit-card spend on{" "}
        <span className="figure font-semibold" style={{ color: "var(--ink)" }}>
          {(MARKET_POSITION.shareOfCards * 100).toFixed(2)}%
        </span>{" "}
        of its cards — {MARKET_POSITION.spendPerCardMultiple.toFixed(2)}× the
        industry&rsquo;s spend per card. On a book that concentrated, losing one
        member is expensive enough that the resolution has to happen in
        milliseconds rather than in a report somebody reads on Monday.
      </p>
    </section>
  );
}
