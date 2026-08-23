import { api, TimelineEvent } from "@/lib/api";
import { Timeline } from "@/app/components/Timeline";
import { JourneySpine } from "@/app/components/JourneySpine";
import { IdentityGraphView } from "@/app/components/IdentityGraphView";
import { AlertsFeed } from "@/app/components/AlertsFeed";
import { ChannelIcon } from "@/app/components/ChannelIcon";
import { CHANNEL_ORDER, channel } from "@/lib/channels";
import { ASSUMPTIONS, usd } from "@/lib/economics";
import { notFound } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

function fmtWhen(iso?: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short", year: "numeric" });
}

export default async function CustomerJourney({ params }: { params: { id: string } }) {
  const [customer, timeline, graph, alerts] = await Promise.all([
    api.customer(params.id).catch(() => null),
    api.timeline(params.id).catch(() => null),
    api.identityGraph(params.id).catch(() => null),
    api.alerts("open", params.id).catch(() => ({ items: [], count: 0 })),
  ]);
  if (!customer) return notFound();

  const events: TimelineEvent[] = timeline?.events ?? [];
  const ordered = [...events].sort(
    (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
  );

  const channelCounts = events.reduce<Record<string, number>>((acc, e) => {
    acc[e.channel] = (acc[e.channel] || 0) + 1;
    return acc;
  }, {});
  const assisted = events.filter((e) => channel(e.channel).assisted).length;
  const avgConfidence = events.length
    ? Math.round((events.reduce((s, e) => s + (e.confidence || 0), 0) / events.length) * 100)
    : null;
  const held = events.filter((e) => (e.confidence ?? 0) < 0.6).length;
  const savedMinutes = assisted * ASSUMPTIONS.minutesSavedPerInformedContact;

  const identifiers = [
    customer.email && { label: "Email", value: customer.email },
    customer.phone_e164 && { label: "Phone", value: customer.phone_e164 },
    customer.loyalty_card && { label: "Loyalty card", value: customer.loyalty_card },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <div className="shell pt-8">
      {/* Statement header */}
      <header className="pb-5 border-b" style={{ borderColor: "var(--rule-strong)" }}>
        <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
          <div className="min-w-0">
            <div className="eyebrow">Card member</div>
            <h1 className="t-h1 mt-1.5">{customer.name || "Unknown member"}</h1>
            <div className="figure t-label text-soft mt-1.5">{customer.customer_id}</div>
          </div>

          <dl className="flex flex-wrap gap-x-9 gap-y-3">
            <Fig label="Events stitched" value={(timeline?.total_events ?? events.length).toLocaleString()} />
            <Fig
              label="Channels touched"
              value={`${Object.keys(channelCounts).length} of ${CHANNEL_ORDER.length}`}
            />
            <Fig
              label="Avg. confidence"
              value={avgConfidence !== null ? `${avgConfidence}%` : "—"}
              flagged={avgConfidence !== null && avgConfidence < 60}
            />
            <Fig label="First seen" value={fmtWhen(timeline?.first_seen)} />
            <Fig label="Last seen" value={fmtWhen(timeline?.last_seen)} />
          </dl>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2.5">
          {identifiers.map((i) => (
            <span key={i.label} className="t-label">
              <span className="text-muted">{i.label} </span>
              <span className="figure text-soft">{i.value}</span>
            </span>
          ))}
          {Object.keys(channelCounts).length > 0 && (
            <span className="flex items-center gap-4 t-label">
              {CHANNEL_ORDER.filter((c) => channelCounts[c]).map((c) => (
                <span key={c} className="flex items-center gap-1.5 text-soft">
                  <span style={{ color: channel(c).color }}>
                    <ChannelIcon channel={c} className="w-4 h-4" />
                  </span>
                  {channel(c).label}
                  <span className="figure text-muted">{channelCounts[c]}</span>
                </span>
              ))}
            </span>
          )}
        </div>

        {assisted > 0 && (
          <p className="t-body text-soft mt-5 max-w-3xl">
            <span className="font-semibold" style={{ color: "var(--ink)" }}>
              {assisted} assisted contact{assisted === 1 ? "" : "s"}
            </span>{" "}
            in this journey. With the full history already on screen, an agent saves about{" "}
            <span className="figure font-semibold" style={{ color: "var(--ink)" }}>
              {savedMinutes.toFixed(1)} minutes
            </span>{" "}
            here — roughly{" "}
            <span className="figure font-semibold" style={{ color: "var(--ink)" }}>
              {usd(savedMinutes * ASSUMPTIONS.agentCostPerMinute)}
            </span>{" "}
            on this one member.
          </p>
        )}
      </header>

      <div className="mt-10">
        <JourneySpine events={events} conflicts={graph?.conflicts ?? []} />
      </div>

      {graph && (
        <div className="mt-12">
          <IdentityGraphView data={graph} />
        </div>
      )}

      {alerts.items.length > 0 && (
        <div className="mt-12">
          <div className="eyebrow mb-3">
            Open risk signals for this member ({alerts.items.length})
          </div>
          <AlertsFeed alerts={alerts.items} />
        </div>
      )}

      <div className="mt-12 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_17rem] gap-x-12 gap-y-9 items-start">
        <section className="min-w-0">
          <div className="flex items-end justify-between gap-4 mb-3">
            <div>
              <div className="eyebrow">Newest first</div>
              <h2 className="t-h2 mt-1.5">Every event, in one record</h2>
            </div>
            <span className="figure t-label text-muted shrink-0">{ordered.length} shown</span>
          </div>
          <Timeline events={ordered} />
        </section>

        <aside className="space-y-8">
          <section>
            <h2 className="eyebrow">How a link is decided</h2>
            <dl className="mt-2.5">
              {[
                ["≥ 60%", "badge-matched", "Linked automatically, with an audit row"],
                ["30–60%", "badge-uncertain", "Sent to the review queue"],
                ["< 30%", "badge-unresolved", "Held apart from this identity"],
              ].map(([range, cls, text]) => (
                <div
                  key={range}
                  className="flex items-baseline gap-2.5 py-2 border-b"
                  style={{ borderColor: "var(--rule)" }}
                >
                  <dt className={`badge ${cls} figure shrink-0`}>{range}</dt>
                  <dd className="t-label text-soft">{text}</dd>
                </div>
              ))}
            </dl>
            {held > 0 && (
              <p className="t-label mt-2.5" style={{ color: "var(--flag-2)" }}>
                {held} event{held === 1 ? "" : "s"} in this journey sit below 60% and were reviewed
                rather than assumed.
              </p>
            )}
          </section>

          <section>
            <h2 className="eyebrow">Related</h2>
            <ul className="mt-2">
              <li className="py-2 border-b" style={{ borderColor: "var(--rule)" }}>
                <Link href="/dashboard/unresolved" className="text-link t-label">
                  The review queue →
                </Link>
              </li>
              <li className="py-2 border-b" style={{ borderColor: "var(--rule)" }}>
                <Link href="/dashboard/repeat-contacts" className="text-link t-label">
                  Members repeating themselves →
                </Link>
              </li>
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function Fig({ label, value, flagged }: { label: string; value: string; flagged?: boolean }) {
  return (
    <div>
      <dt className="eyebrow">{label}</dt>
      <dd
        className="figure mt-1"
        style={{
          fontSize: "1.25rem",
          fontWeight: 600,
          letterSpacing: "-0.025em",
          color: flagged ? "var(--flag-2)" : "var(--ink)",
        }}
      >
        {value}
      </dd>
    </div>
  );
}
