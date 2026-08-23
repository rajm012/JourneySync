"use client";
import { Alert, api } from "@/lib/api";
import { ASSUMPTIONS, usd } from "@/lib/economics";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/* Alerts stay boxed. Everything else in the product is ruled, so a box now
   means one thing: this interrupts you. The left edge carries the severity. */

const SEV: Record<string, { badge: string; edge: string; act: string }> = {
  critical: { badge: "badge-critical", edge: "card-flag", act: "Act now" },
  high: { badge: "badge-high", edge: "card-flag", act: "Act this shift" },
  medium: { badge: "badge-medium", edge: "card-flag-2", act: "Review this shift" },
  low: { badge: "badge-low", edge: "card-quiet", act: "Watchlist" },
};

function AlertTime({ createdAt }: { createdAt: string }) {
  const [text, setText] = useState(createdAt.slice(11, 16));
  useEffect(() => {
    setText(new Date(createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  }, [createdAt]);
  return <>{text}</>;
}

const perAlert = ASSUMPTIONS.churnSaveRate * ASSUMPTIONS.annualMarginPerRetainedCustomer;

export function AlertsFeed({
  alerts,
  compact = false,
}: {
  alerts: Alert[];
  /** Narrow sidebar layout. */
  compact?: boolean;
}) {
  const [localAlerts, setLocalAlerts] = useState(alerts);
  const [acking, setAcking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  useEffect(() => setLocalAlerts(alerts), [alerts]);

  async function ack(id: string) {
    setAcking(id);
    setError(null);
    try {
      await api.ackAlert(id);
      setLocalAlerts((prev) => prev.filter((a) => a.id !== id));
      router.refresh();
    } catch (e: any) {
      setError(e?.message || "Couldn't acknowledge that alert. Try again.");
    } finally {
      setAcking(null);
    }
  }

  if (localAlerts.length === 0) {
    return (
      <p className="t-body text-soft py-3">
        Nothing open. Churn and escalation signals appear here the moment a rule fires.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <p className="t-label" style={{ color: "var(--flag)" }}>
          {error}
        </p>
      )}
      {localAlerts.map((a) => {
        const sev = SEV[a.severity] || SEV.low;
        return (
          <article key={a.id} className={`card ${sev.edge}`}>
            <div className="flex items-baseline gap-2.5 flex-wrap">
              <span className={`badge ${sev.badge}`}>{a.severity.toUpperCase()}</span>
              <h3 className="t-body font-semibold leading-snug">{a.title}</h3>
              <span className="t-label text-muted figure ml-auto shrink-0">
                <AlertTime createdAt={a.created_at} />
              </span>
            </div>

            <p className="t-label text-soft mt-2">{a.body}</p>

            <div
              className="mt-3 pt-2.5 border-t flex flex-wrap items-baseline gap-x-5 gap-y-2"
              style={{ borderColor: "var(--rule)" }}
            >
              <div className="min-w-0 flex-1">
                <div className="eyebrow">Do this next</div>
                <div className="t-body font-medium mt-0.5">{a.suggested_action}</div>
              </div>
              <div className="shrink-0">
                <div className="eyebrow">At stake</div>
                <div className="figure t-body font-semibold mt-0.5">{usd(perAlert)}/yr</div>
              </div>
            </div>

            <div className={`mt-3 flex gap-2 ${compact ? "flex-col" : "flex-wrap"}`}>
              <Link
                href={`/dashboard/customers/${a.customer_id}`}
                className={`btn-ghost t-label text-center ${compact ? "w-full" : ""}`}
              >
                Open the journey
              </Link>
              <button
                onClick={() => ack(a.id)}
                disabled={acking === a.id}
                className={`btn t-label ${compact ? "w-full" : ""}`}
              >
                {acking === a.id ? "Acknowledging…" : "Acknowledge"}
              </button>
              {!compact && (
                <span className="t-label text-muted self-center figure ml-auto">{a.rule_id}</span>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
