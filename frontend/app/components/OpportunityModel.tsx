
import {ASSUMPTION_NOTES, handleTimeValue, inr, inrRange, totalOpportunity} from "@/lib/economics";

/* ==========================================================================
   The opportunity model
   --------------------------------------------------------------------------
   Everything above this section on the page is measured. This section is a
   model, and it says so in its own eyebrow — mixing the two is the one thing
   that would make a director stop trusting the measured half.

   Each stream shows its arithmetic on the same line as its result, because the
   fastest way to lose a room is to show a number nobody can reconstruct. The
   figures carry no colour: money is neither a channel nor a refusal, so it
   stays in ink and the colour rule survives.
   ========================================================================== */

export function OpportunityModel() {
  const model = totalOpportunity();

  return (
    <section>
      <div className="flex items-end justify-between gap-6 flex-wrap mb-4">
        <div>
          <div className="eyebrow">Modelled, not measured</div>
          <h2 className="t-h2 mt-1.5">What this is worth at portfolio scale</h2>
        </div>
        <p className="t-label text-muted max-w-md lg:text-right">
          AmEx India premium portfolio. Industry data and our own model — every input
          is listed below, so any one of them can be argued with.
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
                Conservative. Excludes NPS improvement, the reduced regulatory risk the
                audit trail buys, and the value of the fraud signal.
              </td>
              <td className="num t-body font-semibold whitespace-nowrap">
                {inrRange(model.low, model.high)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-7 pt-5 border-t" style={{ borderColor: "var(--rule-strong)" }}>
          <div className="eyebrow mb-3">Every input, stated</div>
          <dl className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-10 gap-y-0">
            {ASSUMPTION_NOTES.map((a) => (
              <div
                key={a.label}
                className="flex items-baseline justify-between gap-4 py-2 border-b"
                style={{ borderColor: "var(--rule)" }}
              >
                <dt className="t-label text-soft">{a.label}</dt>
                <dd className="figure t-label whitespace-nowrap">{a.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>

      <p className="t-body text-soft mt-3 max-w-4xl">
        One informed contact is worth{" "}
        <span className="figure font-semibold" style={{ color: "var(--ink)" }}>
          {inr(handleTimeValue(1).value)}
        </span>{" "}
        on its own. The model only becomes a crore figure because it happens three
        million times a year — which is exactly why it has to be sub-second and
        automatic rather than a report somebody reads on Monday.
      </p>
    </section>
  );
}
