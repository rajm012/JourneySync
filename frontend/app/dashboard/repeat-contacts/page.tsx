import { api } from "@/lib/api";
import { ASSUMPTIONS, repeatContactValue, inr } from "@/lib/economics";
import { channel } from "@/lib/channels";
import { ChannelIcon } from "@/app/components/ChannelIcon";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const RISK: Record<string, string> = {
  high: "badge-critical",
  medium: "badge-medium",
  elevated: "badge-high",
};

const WINDOWS = [
  { d: 3, m: 2, label: "3 days · 2+" },
  { d: 7, m: 2, label: "7 days · 2+" },
  { d: 7, m: 3, label: "7 days · 3+" },
  { d: 30, m: 2, label: "30 days · 2+" },
];

export default async function RepeatContactsPage({
  searchParams,
}: {
  searchParams?: { days?: string; min?: string };
}) {
  const days = Number(searchParams?.days || 7) || 7;
  const min = Number(searchParams?.min || 2) || 2;

  const data = await api.repeatContacts(days, min).catch(() => null);
  const items = data?.items ?? [];
  const count = data?.count ?? 0;

  const totalContacts = items.reduce((s, c) => s + c.total, 0);
  const value = repeatContactValue(count, days);

  return (
    <div className="shell pt-8">
      <header className="pb-5 border-b" style={{ borderColor: "var(--rule-strong)" }}>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <div className="eyebrow">The earliest churn signal we have</div>
            <h1 className="t-h1 mt-1.5">Members repeating themselves</h1>
          </div>
          <div className="segment no-print">
            {WINDOWS.map((opt) => (
              <Link
                key={opt.label}
                href={`/dashboard/repeat-contacts?days=${opt.d}&min=${opt.m}`}
                data-on={days === opt.d && min === opt.m}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>
        <p className="t-body text-soft mt-3 max-w-3xl">
          {min}+ call or branch contacts in {days} days. A second contact usually means the first one
          didn&apos;t land — and every one of these members has already told us their story once.
        </p>
      </header>

      {!data && (
        <div className="card card-flag mt-6">
          <h2 className="t-body font-semibold">This view can&apos;t reach the API</h2>
          <p className="t-label text-soft mt-1">Start the backend on port 8000 and reload.</p>
        </div>
      )}

      <dl className="mt-7 flex flex-wrap gap-x-12 gap-y-5">
        <Fig label="Members flagged" value={count.toLocaleString()} flagged={count > 0} />
        <Fig label="Contacts in window" value={totalContacts.toLocaleString()} />
        <Fig
          label="Servicing cost, annualised"
          value={inr(value.perYear)}
          note={`${count.toLocaleString()} members in ${days} days, at ${inr(ASSUMPTIONS.costPerAssistedContact)} per assisted contact fully allocated`}
        />
        <Fig
          label="Worst case"
          value={items[0] ? `${items[0].total} contacts` : "—"}
          note={items[0]?.name || undefined}
        />
      </dl>

      <div className="mt-9 overflow-x-auto scroll-quiet">
        <table className="ledger">
          <caption className="sr-only">Members with repeat assisted contacts</caption>
          <thead>
            <tr>
              <th>Member</th>
              <th>Risk</th>
              <th className="num">Contacts</th>
              <th>Where they reached us</th>
              <th>Last contact</th>
              <th className="num">Cost so far</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((c) => (
              <tr key={c.customer_id}>
                <td>
                  <div className="font-medium">{c.name || "Unknown member"}</div>
                  <div className="figure t-label text-muted">{c.customer_id}</div>
                  <div className="figure t-label text-soft">{c.phone_e164 || c.email || "—"}</div>
                </td>
                <td>
                  <span className={`badge ${RISK[c.risk] || "badge-low"}`}>{c.risk}</span>
                </td>
                <td className="num" style={{ fontSize: "1.125rem", fontWeight: 600 }}>
                  {c.total}
                </td>
                <td>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    {c.by_channel.map((ch) => (
                      <span key={ch.channel} className="flex items-center gap-1.5 t-label text-soft">
                        <span style={{ color: channel(ch.channel).color }}>
                          <ChannelIcon channel={ch.channel} className="w-4 h-4" />
                        </span>
                        {channel(ch.channel).label}
                        <span className="figure text-muted">{ch.count}</span>
                      </span>
                    ))}
                  </div>
                </td>
                <td className="figure t-label text-muted whitespace-nowrap">
                  {c.last_contact_at ? c.last_contact_at.slice(0, 16).replace("T", " ") : "—"}
                </td>
                <td className="num">{inr(c.total * ASSUMPTIONS.costPerAssistedContact)}</td>
                <td className="text-right whitespace-nowrap">
                  <Link href={`/dashboard/customers/${c.customer_id}`} className="text-link t-label">
                    Open journey →
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {items.length === 0 && data && (
          <p className="t-body text-soft py-10 max-w-2xl">
            Nobody hit {min} assisted contacts in {days} days. Widen the window, or run Asha&apos;s
            journey — she reaches us by phone and then in a branch.
          </p>
        )}
      </div>

      {count > items.length && (
        <p className="t-label text-muted mt-4">
          Showing the {items.length} highest-effort members of {count.toLocaleString()} matching this
          window.
        </p>
      )}
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
