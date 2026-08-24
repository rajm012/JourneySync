import { api, Metrics } from "@/lib/api";
import { AlertsFeed } from "../components/AlertsFeed";
import { MetricsStrip } from "../components/MetricsStrip";
import { LiveStreamTicker } from "../components/LiveStreamTicker";
import { JourneySpine } from "../components/JourneySpine";
import { DemoControls } from "../components/DemoControls";
import { VerdictBand } from "../components/VerdictBand";
import { OpportunityModel } from "../components/OpportunityModel";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const EMPTY_METRICS: Metrics = {
  totals: { customers: 0, resolutions: 0, uncertain: 0, alerts: 0, open_alerts: 0 },
  latency: { samples: 0, p50: 0, p95: 0, p99: 0, avg: 0, max: 0 },
  accuracy: undefined,
};

const REPEAT_WINDOW_DAYS = 30;

function pickHero(items: { customer_id: string; name?: string | null; total_events?: number }[]) {
  if (!items.length) return undefined;
  const asha = items.find(
    (c) => c.customer_id === "C0001" || (c.name || "").toLowerCase().startsWith("asha"),
  );
  return asha ?? [...items].sort((a, b) => (b.total_events ?? 0) - (a.total_events ?? 0))[0];
}

export default async function Dashboard() {
  // Resolve to null on failure rather than to zeroes: a dead backend has to
  // look dead, not like a quiet day.
  const [metrics, alerts, customers, repeats] = await Promise.all([
    api.metrics().catch(() => null),
    api.alerts("open").catch(() => null),
    api.customers().catch(() => null),
    api.repeatContacts(REPEAT_WINDOW_DAYS, 2).catch(() => null),
  ]);

  const live = metrics !== null;
  const m = metrics ?? EMPTY_METRICS;
  const openAlerts = alerts?.items ?? [];
  const hero = pickHero(customers?.items ?? []);

  const [timeline, graph] = hero
    ? await Promise.all([
        api.timeline(hero.customer_id).catch(() => null),
        api.identityGraph(hero.customer_id).catch(() => null),
      ])
    : [null, null];

  return (
    <>
      <VerdictBand
        metrics={m}
        repeatCustomers={repeats?.count ?? 0}
        repeatWindowDays={REPEAT_WINDOW_DAYS}
        live={live}
      />

      <div className="shell">
        {!live && (
          <div className="card card-flag mt-6">
            <h2 className="t-body font-semibold">The dashboard can&apos;t reach the API</h2>
            <p className="t-label text-soft mt-1">
              Every figure on this page is unavailable, not zero. Start the backend on port 8000 and
              reload.
            </p>
          </div>
        )}

        {/* Demo controls are stage machinery, not product. They sit in a quiet
            strip under the message rather than competing with it. */}
        <div
          className="flex flex-wrap items-baseline justify-between gap-4 py-4 border-b no-print"
          style={{ borderColor: "var(--rule)" }}
        >
          <span className="eyebrow">Demo controls</span>
          <DemoControls />
        </div>

        <div className="mt-9">
          {hero ? (
            <JourneySpine
              events={timeline?.events ?? []}
              conflicts={graph?.conflicts ?? []}
              title={`${hero.name || hero.customer_id} — one member, four channels`}
            />
          ) : (
            <JourneySpine events={[]} />
          )}
          {hero && (
            <div className="mt-4">
              <Link href={`/dashboard/customers/${hero.customer_id}`} className="text-link t-body">
                Open the full journey and the evidence behind it →
              </Link>
            </div>
          )}
        </div>

        <div className="mt-11">
          <h2 className="eyebrow mb-3">Measured, not asserted</h2>
          <MetricsStrip metrics={m} />
        </div>

        <div className="mt-12 pt-11 border-t" style={{ borderColor: "var(--rule-strong)" }}>
          <OpportunityModel />
        </div>

        <div className="mt-11 grid grid-cols-1 lg:grid-cols-2 gap-x-12 gap-y-10 items-start">
          <div>
            <div className="flex items-end justify-between gap-3 mb-3">
              <div>
                <div className="eyebrow">Act today</div>
                <h2 className="t-h2 mt-1.5">
                  Risk signals{openAlerts.length > 0 && <span className="figure"> ({openAlerts.length})</span>}
                </h2>
              </div>
              <Link href="/dashboard/alerts" className="text-link t-label shrink-0">
                All signals →
              </Link>
            </div>
            <div className="panel">
              <AlertsFeed alerts={openAlerts.slice(0, 3)} compact />
            </div>
          </div>

          <LiveStreamTicker />
        </div>

        <nav className="mt-11" aria-label="Other views">
          <h2 className="eyebrow mb-1">Then look at</h2>
          <ul>
            {[
              [
                "/dashboard/funnel",
                "Where journeys break",
                "The single step losing you the most members right now.",
              ],
              [
                "/dashboard/unresolved",
                "The review queue",
                "Every link the resolver refused to make on its own.",
              ],
              [
                "/dashboard/repeat-contacts",
                "Members repeating themselves",
                "The leading churn signal, priced.",
              ],
            ].map(([href, title, blurb]) => (
              <li key={href} className="border-b" style={{ borderColor: "var(--rule)" }}>
                <Link
                  href={href}
                  className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3.5 hover-surface transition-colors -mx-2 px-2"
                >
                  <span className="t-body font-semibold">{title}</span>
                  <span className="t-label text-soft flex-1">{blurb}</span>
                  <span className="t-label text-link">Open →</span>
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </>
  );
}
