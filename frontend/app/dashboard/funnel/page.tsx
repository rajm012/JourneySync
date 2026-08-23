import { api } from "@/lib/api";
import { FunnelChart } from "@/app/components/FunnelChart";
import Link from "next/link";

export const dynamic = "force-dynamic";

const WINDOWS: [number, string][] = [
  [24, "24 hours"],
  [72, "3 days"],
  [168, "7 days"],
  [720, "30 days"],
];

export default async function FunnelPage({ searchParams }: { searchParams?: { hours?: string } }) {
  const requested = Number(searchParams?.hours);
  const hours = WINDOWS.some(([h]) => h === requested) ? requested : 168;

  const funnel = await api.funnel(hours).catch(() => null);
  const steps = funnel?.steps ?? [];
  const first = steps[0]?.count ?? 0;
  const last = steps.at(-1)?.count ?? 0;
  const conversion = first ? Math.round((last / first) * 100) : 0;
  const worst = steps
    .slice(1)
    .sort((a, b) => (b.drop_off_pct ?? 0) - (a.drop_off_pct ?? 0))[0];

  return (
    <div className="shell pt-8">
      <header className="pb-5 border-b" style={{ borderColor: "var(--rule-strong)" }}>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <div className="eyebrow">One question, one answer</div>
            <h1 className="t-h1 mt-1.5">Where should we intervene?</h1>
          </div>
          <div className="segment no-print">
            {WINDOWS.map(([h, label]) => (
              <Link key={h} href={`?hours=${h}`} data-on={hours === h}>
                {label}
              </Link>
            ))}
          </div>
        </div>
        <p className="t-body text-soft mt-3 max-w-3xl">
          Every step counts distinct members, not clicks. Because the same person is resolved across
          web, app, call center and branch, a journey that starts online and finishes on the phone
          stays one journey here.
        </p>
      </header>

      {!funnel && (
        <div className="card card-flag mt-6">
          <h2 className="t-body font-semibold">This view can&apos;t reach the API</h2>
          <p className="t-label text-soft mt-1">Start the backend on port 8000 and reload.</p>
        </div>
      )}

      <dl className="mt-7 flex flex-wrap gap-x-12 gap-y-5">
        <Fig label="Started a journey" value={first.toLocaleString()} />
        <Fig label="Finished it" value={last.toLocaleString()} />
        <Fig label="End-to-end" value={`${conversion}%`} />
        <Fig
          label="Act here first"
          value={worst?.step.replace(/_/g, " ") ?? "—"}
          note={worst ? `${worst.drop_off_pct ?? 0}% lost at this step` : undefined}
          flagged={(worst?.drop_off_pct ?? 0) > 40}
          mono={false}
        />
      </dl>

      {funnel && (
        <div className="mt-10">
          <FunnelChart funnel={funnel} />
        </div>
      )}

      {steps.length > 0 && (
        <div className="mt-11 overflow-x-auto scroll-quiet">
          <h2 className="eyebrow mb-3">Step by step</h2>
          <table className="ledger">
            <thead>
              <tr>
                <th>Step</th>
                <th className="num">Members</th>
                <th className="num">Lost from previous</th>
                <th className="num">Share of starters</th>
              </tr>
            </thead>
            <tbody>
              {steps.map((s, i) => {
                const lost = i === 0 ? null : (steps[i - 1].count ?? 0) - s.count;
                return (
                  <tr key={s.step}>
                    <td className="font-medium capitalize">{s.step.replace(/_/g, " ")}</td>
                    <td className="num">{s.count.toLocaleString()}</td>
                    <td
                      className="num"
                      style={{ color: (s.drop_off_pct ?? 0) > 40 ? "var(--flag)" : "var(--ink-2)" }}
                    >
                      {lost == null
                        ? "—"
                        : `−${lost.toLocaleString()}${s.drop_off_pct != null ? ` (${s.drop_off_pct}%)` : ""}`}
                    </td>
                    <td className="num text-soft">
                      {first ? `${Math.round((s.count / first) * 100)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Fig({
  label,
  value,
  note,
  flagged,
  mono = true,
}: {
  label: string;
  value: string;
  note?: string;
  flagged?: boolean;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className={`mt-1 ${mono ? "figure" : "capitalize"}`}
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
