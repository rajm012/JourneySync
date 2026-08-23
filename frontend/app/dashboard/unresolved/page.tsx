import { api, UnresolvedResponse } from "@/lib/api";
import { ConfidenceBadge } from "@/app/components/ConfidenceBadge";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const STATUS: Record<string, { badge: string; meaning: string }> = {
  conflict: {
    badge: "badge-conflict",
    meaning: "A proven identifier and strong behaviour pointed at different members.",
  },
  uncertain: {
    badge: "badge-uncertain",
    meaning: "Evidence leaned one way but not far enough to link on its own.",
  },
  unresolved: {
    badge: "badge-unresolved",
    meaning: "Nothing tied this event to a known member.",
  },
};

export default async function ReviewQueuePage() {
  const data = await api.unresolved(100).catch(() => null);
  const summary: UnresolvedResponse["summary"] =
    data?.summary ?? { needing_review: 0, by_status: {}, by_method: {} };
  const items = data?.items ?? [];

  const topMethod = Object.entries(summary.by_method).sort((a, b) => b[1] - a[1])[0];

  return (
    <div className="shell pt-8">
      <header className="pb-5 border-b" style={{ borderColor: "var(--rule-strong)" }}>
        <div className="eyebrow">Nothing here was merged</div>
        <h1 className="t-h1 mt-1.5">The review queue</h1>
        <p className="t-body text-soft mt-3 max-w-3xl">
          Links the resolver would not make on its own. A silent merge puts one member&apos;s history
          in front of another member&apos;s agent, so when the evidence disagrees the decision comes
          here instead. This queue is the control, not a backlog.
        </p>
      </header>

      {!data && (
        <div className="card card-flag mt-6">
          <h2 className="t-body font-semibold">The review queue can&apos;t reach the API</h2>
          <p className="t-label text-soft mt-1">
            Start the backend on port 8000 and reload. This page is showing nothing, not zero.
          </p>
        </div>
      )}

      <dl className="mt-7 flex flex-wrap gap-x-12 gap-y-5">
        <Fig label="Awaiting a decision" value={summary.needing_review.toLocaleString()} />
        <Fig
          label="Evidence conflicts"
          value={(summary.by_status.conflict ?? 0).toLocaleString()}
          flagged={(summary.by_status.conflict ?? 0) > 0}
        />
        <Fig label="Below threshold" value={(summary.by_status.uncertain ?? 0).toLocaleString()} />
        <Fig label="No candidate" value={(summary.by_status.unresolved ?? 0).toLocaleString()} />
        <Fig
          label="Most common cause"
          value={topMethod ? topMethod[0].replace(/_/g, " ") : "—"}
          mono={false}
        />
      </dl>

      <div className="mt-9 overflow-x-auto scroll-quiet">
        <table className="ledger">
          <caption className="sr-only">Matches held for human review</caption>
          <thead>
            <tr>
              <th>Decided</th>
              <th>Status</th>
              <th>Why</th>
              <th className="num">Confidence</th>
              <th>Candidate member</th>
              <th>Evidence</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((row) => {
              const s = STATUS[row.match_status] ?? STATUS.unresolved;
              return (
                <tr key={row.id}>
                  <td className="figure t-label text-muted whitespace-nowrap">
                    {row.decided_at ? row.decided_at.slice(0, 16).replace("T", " ") : "—"}
                  </td>
                  <td>
                    <span className={`badge ${s.badge}`}>{row.match_status}</span>
                  </td>
                  <td className="t-label text-soft max-w-[19rem]">{s.meaning}</td>
                  <td className="num">
                    <ConfidenceBadge value={row.confidence ?? 0} />
                  </td>
                  <td>
                    <div className="font-medium">{row.customer_name || "None proposed"}</div>
                    <div className="figure t-label text-muted">{row.customer_id || "—"}</div>
                  </td>
                  <td className="t-label text-soft max-w-[15rem]">
                    <div className="mb-0.5">{row.method.replace(/_/g, " ")}</div>
                    <div className="figure text-muted truncate">
                      {Object.entries(row.signals || {})
                        .slice(0, 3)
                        .map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : v}`)
                        .join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="text-right whitespace-nowrap">
                    {row.customer_id ? (
                      <Link
                        href={`/dashboard/customers/${row.customer_id}`}
                        className="text-link t-label"
                      >
                        Review →
                      </Link>
                    ) : (
                      <span className="t-label text-muted">No candidate</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {items.length === 0 && data && (
          <p className="t-body text-soft py-10 max-w-2xl">
            Nothing is waiting. Every event in the window matched clearly enough to link, or clearly
            enough to leave alone — and this queue is how you can tell the difference.
          </p>
        )}
      </div>
    </div>
  );
}

function Fig({
  label,
  value,
  flagged,
  mono = true,
}: {
  label: string;
  value: string;
  flagged?: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={`mt-1 ${mono ? "figure" : ""}`}
        style={{
          fontSize: "1.5rem",
          fontWeight: 600,
          letterSpacing: "-0.03em",
          color: flagged ? "var(--flag)" : "var(--ink)",
        }}
      >
        {value}
      </dd>
    </div>
  );
}
