import { api } from "@/lib/api";
import { CHANNEL_ORDER, channel } from "@/lib/channels";
import Link from "next/link";

export const dynamic = "force-dynamic";

const LIMIT = 24;

export default async function MembersPage({
  searchParams,
}: {
  searchParams?: { page?: string; q?: string };
}) {
  const page = Math.max(1, Number(searchParams?.page || 1) || 1);
  const q = searchParams?.q || "";
  const data = await api.customers(LIMIT, (page - 1) * LIMIT, q).catch(() => null);

  const items = data?.items ?? [];
  const total = data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / LIMIT));

  return (
    <div className="shell pt-8">
      <header className="pb-5 border-b" style={{ borderColor: "var(--rule-strong)" }}>
        <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
          <div>
            <div className="eyebrow">One row per person, not per channel</div>
            <h1 className="t-h1 mt-1.5">Card members</h1>
          </div>
          <form className="flex gap-2 no-print" role="search">
            <label className="sr-only" htmlFor="q">
              Search members
            </label>
            <input
              id="q"
              name="q"
              defaultValue={q}
              placeholder="Name, member ID, email or phone"
              className="field w-72 max-w-full"
            />
            <button className="btn">Search</button>
          </form>
        </div>
        <p className="t-body text-soft mt-3 max-w-3xl">
          {total.toLocaleString()} identities assembled from web, app, call center and branch traffic.
          The coverage column shows which channels each member has actually used.
        </p>
      </header>

      {!data && (
        <div className="card card-flag mt-6">
          <h2 className="t-body font-semibold">This view can&apos;t reach the API</h2>
          <p className="t-label text-soft mt-1">Start the backend on port 8000 and reload.</p>
        </div>
      )}

      <div className="mt-8 overflow-x-auto scroll-quiet">
        <table className="ledger">
          <caption className="sr-only">Card members and their channel coverage</caption>
          <thead>
            <tr>
              <th>Member</th>
              <th>Reachable at</th>
              <th>Coverage</th>
              <th className="num">Events</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((c) => {
              const touched = new Set(c.channels_touched || []);
              return (
                <tr key={c.customer_id}>
                  <td>
                    <div className="font-medium">{c.name || "Unknown member"}</div>
                    <div className="figure t-label text-muted">{c.customer_id}</div>
                  </td>
                  <td className="t-label text-soft">
                    <div className="figure truncate max-w-[15rem]">{c.email || "No email"}</div>
                    <div className="figure text-muted">{c.phone_e164 || "No phone"}</div>
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5" title={
                      touched.size
                        ? CHANNEL_ORDER.filter((k) => touched.has(k)).map((k) => channel(k).label).join(", ")
                        : "No tracked activity"
                    }>
                      {CHANNEL_ORDER.map((k) => (
                        <span
                          key={k}
                          className="inline-block w-3.5 h-3.5"
                          style={{
                            background: touched.has(k) ? channel(k).color : "transparent",
                            boxShadow: touched.has(k)
                              ? undefined
                              : "inset 0 0 0 1px var(--rule-strong)",
                          }}
                          aria-hidden
                        />
                      ))}
                      <span className="figure t-label text-muted ml-1.5">
                        {touched.size}/{CHANNEL_ORDER.length}
                      </span>
                    </div>
                  </td>
                  <td className="num" style={{ fontSize: "1.0625rem", fontWeight: 600 }}>
                    {(c.total_events || 0).toLocaleString()}
                  </td>
                  <td className="text-right whitespace-nowrap">
                    <Link href={`/dashboard/customers/${c.customer_id}`} className="text-link t-label">
                      Open journey →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {items.length === 0 && data && (
          <p className="t-body text-soft py-10 max-w-2xl">
            {q ? (
              <>
                Nothing matches “{q}”. Try a member ID like <span className="figure">C0001</span>, or
                clear the search.
              </>
            ) : (
              "No members loaded yet. Run the demo reset from the overview to load the catalog."
            )}
          </p>
        )}
      </div>

      {pages > 1 && (
        <nav
          className="mt-6 pt-4 border-t flex items-center justify-between gap-4 no-print"
          style={{ borderColor: "var(--rule)" }}
          aria-label="Pagination"
        >
          <span className="t-label text-muted figure">
            Page {page} of {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link className="btn-ghost t-label" href={`?page=${page - 1}&q=${encodeURIComponent(q)}`}>
                ← Previous
              </Link>
            )}
            {page < pages && (
              <Link className="btn-ghost t-label" href={`?page=${page + 1}&q=${encodeURIComponent(q)}`}>
                Next →
              </Link>
            )}
          </div>
        </nav>
      )}
    </div>
  );
}
