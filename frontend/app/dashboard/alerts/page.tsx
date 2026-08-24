import { api, Alert } from "@/lib/api";
import { AlertsFeed } from "@/app/components/AlertsFeed";
import { ASSUMPTIONS, churnSaveValue, inr } from "@/lib/economics";

export const dynamic = "force-dynamic";

type Bucket = {
  key: "critical" | "high" | "medium" | "low";
  label: string;
  when: string;
};

const BUCKETS: Bucket[] = [
  { key: "critical", label: "Act now", when: "Closure or churn intent is already in motion." },
  { key: "high", label: "Act first this shift", when: "The member is at risk and still reachable." },
  { key: "medium", label: "Review this shift", when: "Elevated risk, no immediate trigger." },
  { key: "low", label: "Watchlist", when: "Informational. No action expected today." },
];

export default async function RiskPage() {
  const data = await api.alerts("open").catch(() => null);
  const items = data?.items ?? ([] as Alert[]);
  const value = churnSaveValue(items.length);

  return (
    <div className="shell pt-8">
      <header className="pb-5 border-b" style={{ borderColor: "var(--rule-strong)" }}>
        <div className="eyebrow">Ordered by what to do, not by what fired</div>
        <h1 className="t-h1 mt-1.5">Risk signals</h1>
        <p className="t-body text-soft mt-3 max-w-3xl">
          Rules watch the stitched journey — churn language on a call, a payment abandoned after a
          branch visit, a member contacting us again within the day. Each signal carries the action an
          analyst should take. The analyst still decides.
        </p>
      </header>

      {!data && (
        <div className="card card-flag mt-6">
          <h2 className="t-body font-semibold">This view can&apos;t reach the API</h2>
          <p className="t-label text-soft mt-1">Start the backend on port 8000 and reload.</p>
        </div>
      )}

      <dl className="mt-7 flex flex-wrap gap-x-12 gap-y-5">
        <Fig label="Open now" value={items.length.toLocaleString()} flagged={items.length > 0} />
        <Fig
          label="Needing action today"
          value={items
            .filter((a) => a.severity === "critical" || a.severity === "high")
            .length.toLocaleString()}
        />
        <Fig
          label="Retained margin in reach"
          value={inr(value.perYear)}
          note={`${Math.round(ASSUMPTIONS.churnSaveRate * 100)} percentage-point save-rate improvement in the business case`}
        />
      </dl>

      <div className="mt-10 space-y-11">
        {BUCKETS.map((bucket) => {
          const group = items.filter((a) => a.severity === bucket.key);
          return (
            <section key={bucket.key}>
              <div
                className="flex items-end justify-between gap-4 pb-2 border-b"
                style={{ borderColor: "var(--rule-strong)" }}
              >
                <div>
                  <h2 className="t-h2">{bucket.label}</h2>
                  <p className="t-label text-muted mt-1">{bucket.when}</p>
                </div>
                <span
                  className="figure shrink-0"
                  style={{
                    fontSize: "1.5rem",
                    fontWeight: 600,
                    letterSpacing: "-0.03em",
                    color: group.length
                      ? bucket.key === "critical" || bucket.key === "high"
                        ? "var(--flag)"
                        : "var(--ink)"
                      : "var(--ink-3)",
                  }}
                >
                  {group.length}
                </span>
              </div>
              <div className="mt-4">
                {group.length === 0 ? (
                  <p className="t-label text-muted">Nothing in this band.</p>
                ) : (
                  <AlertsFeed alerts={group} />
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Fig({
  label,
  value,
  note,
  flagged,
}: {
  label: string;
  value: string;
  note?: string;
  flagged?: boolean;
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className="figure mt-1"
        style={{
          fontSize: "1.5rem",
          fontWeight: 600,
          letterSpacing: "-0.03em",
          color: flagged ? "var(--flag)" : "var(--ink)",
        }}
      >
        {value}
      </dd>
      {note && <dd className="t-label text-muted mt-0.5">{note}</dd>}
    </div>
  );
}
