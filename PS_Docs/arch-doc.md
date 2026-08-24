# JourneySync — architecture

> Real-time cross-channel identity resolution and journey stitching.
> American Express CodeStreet 2026 · Team Cinephiles.

Diagram for slides: [`docs/architecture.svg`](architecture.svg) (1600×900, 16:9).

---

## 1. What the system actually does

A card member touches the bank on the website, in the app, on the phone and at a
branch. Each of those channels writes its own record, keyed its own way — a
cookie, a device id, a phone number, a staff-entered account number. Nobody
downstream can tell that the four records are one person, so the call-centre
agent starts from zero and the member repeats themselves.

JourneySync sits on top of those existing systems and does two things:

1. **Resolves identity** — decides, per event, which member it belongs to, with a
   confidence score and a written reason.
2. **Stitches the journey** — appends the resolved event to that member's single
   chronological timeline across every channel.

Everything else in the product (funnel, review queue, repeat-contact list, churn
alerts) is a read over those two outputs.

The design constraint that shapes the whole system: **a wrong merge is far more
expensive than a missed one.** Showing member A's history to member B's agent is
a privacy incident. So the resolver is built to refuse rather than guess, and
every decision it makes is recorded so it can be argued with afterwards.

---

## 2. The shape at a glance

Six containers, one command ([`docker-compose.yml`](../docker-compose.yml)):

| Service | Image / build | Role | Host port |
|---|---|---|---|
| `backend` | `./backend` (FastAPI + uvicorn `--reload`) | HTTP ingest + all read APIs + SSE | `8000` |
| `worker` | same image, different command | `python -m app.workers.resolver_worker` | — |
| `postgres` | `postgres:16-alpine` | identity graph, audit, alerts, latency | `5434` |
| `mongo` | `mongo:7` | one timeline document per member | `27018` |
| `redis` | `redis:7-alpine` (`--appendonly yes`) | stream, consumer group, pub/sub, dedup keys | `6381` |
| `frontend` | `node:20-alpine` running `next dev` | Next.js 14 dashboard | `3000` |

Two deliberate choices in the topology:

- **`backend` and `worker` are the same image with different commands.** The API
  process only validates and enqueues; the worker does all the thinking. They can
  be scaled independently, and a slow resolution can never make an ingest
  request slow. (In a real deployment you'd run N workers; the consumer group and
  the unique indexes already make that safe — see §4.6.)
- **Host DB ports are shifted** (5434/27018/6381) so the demo can't collide with
  whatever Postgres or Redis is already running on a judge's laptop. Inside the
  compose network the services still use the standard ports.

Startup is ordered by health, not by hope: `backend` and `worker` both wait on
`service_healthy` for all three datastores, and `frontend` waits on `backend`'s
`/health` check. That's why `docker compose up` works from cold with no retries.

There are two health endpoints, and the difference matters if you're asked about
operability: `/health` says the process is up (that's what Docker polls), while
`/health/ready` round-trips Postgres, Mongo and Redis, reports the latency of
each, and returns `503 degraded` if any one is down. The second is the honest
answer to "how do you know your stack is actually healthy?"

Boot is also self-correcting rather than assumed-clean: `lifespan` in
[`backend/app/main.py`](../backend/app/main.py) creates the Mongo indexes, runs
the idempotent DDL, ensures the Redis consumer group exists, and kicks the
catalogue seed off as a **background task** so it can never delay the health
check.

---

## 3. The write path

```
channel event
   │  POST /api/events
   ▼
FastAPI ingest ──► Redis Stream events.raw ──► resolver worker
                                                  │
                                    ┌─────────────┼──────────────┐
                                    ▼             ▼              ▼
                             Postgres        Mongo          Redis pub/sub
                          (identity+audit)  (timeline)     (events.resolved)
```

### 3.1 One schema for four channels

[`backend/app/schemas/event.py`](../backend/app/schemas/event.py) defines a single
`ChannelEvent`, and every channel posts that shape:

```
event_id, channel, event_type, occurred_at,
identity  { user_id, email, loyalty_card, phone_e164 }   ← things we can prove
signals   { device_fp, ip, ip_subnet, geo, user_agent }  ← things we can only infer
payload   { … channel-specific }
```

The split between `identity` and `signals` is the most important line in the
codebase: it is the same split the resolver later uses to decide how much a
piece of evidence is allowed to prove. Adding a fifth channel means posting the
same envelope — no schema migration, no new pipeline.

Normalisation happens **here, at the edge**, in Pydantic validators: emails are
lower-cased, phones are reduced to E.164 digits, blanks are trimmed to `None`.
That is not cosmetic. Because it happens once on the way in, the deterministic
match later can be a literal indexed equality lookup instead of a fuzzy
comparison — which is what makes it both exact and free.

### 3.2 Accept fast, decide later

[`backend/app/api/events.py`](../backend/app/api/events.py) does almost nothing:
validate, stamp `received_at_ms`, publish, return. No database is touched on the
request path. The endpoint's latency is therefore independent of how much work
resolution turns out to need — a burst can queue instead of timing out.

### 3.3 Exactly once, enforced in one round trip

[`backend/app/services/ingestion.py`](../backend/app/services/ingestion.py) does
the dedup and the enqueue **atomically**, in a Lua script:

```lua
if redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX') then
  return redis.call('XADD', KEYS[2], '*', 'event', ARGV[2], 'received_at_ms', ARGV[3])
end
return false
```

Key is `journeysync:event:{event_id}`, TTL 7 days. A retried POST — client
timeout, at-least-once upstream queue, a re-run demo script — gets a `200` with
`duplicate: true` and never enters the stream, so it is never resolved, stitched,
counted or audited twice. Doing this as two commands would leave a window where
a crash between them either loses the event or double-counts it; the script
closes it.

### 3.4 The stream is the buffer

`events.raw`, consumer group `resolvers`. This is why the "10,000 events in 30
seconds" burst demo doesn't fall over: the API absorbs the burst at memory
speed, and the worker drains at whatever rate Postgres and Mongo allow. Load
shedding becomes queue depth instead of dropped events or 500s.

### 3.5 The worker's delivery guarantees

[`backend/app/workers/resolver_worker.py`](../backend/app/workers/resolver_worker.py):

- `XREADGROUP` with `block=1000`, `count=100`, up to 16 messages in flight
  (`asyncio.Semaphore`).
- **ACK only after success.** A failure leaves the message in the pending list.
- `XAUTOCLAIM` reclaims anything idle for >15s, so a worker that dies mid-message
  doesn't strand it.
- After `MAX_DELIVERIES = 5`, the message goes to `events.dlq` and is acked — a
  poison pill can't block the group forever.

That combination is what makes the pipeline at-least-once on delivery and
effectively exactly-once on effect (the ingest dedup key plus the idempotent
stitch in §5.1 absorb the retries).

---

## 4. The resolver — the actual IP

[`backend/app/services/resolution.py`](../backend/app/services/resolution.py).
`resolve()` walks a ladder and stops at the first rung that answers. Cheap and
exact first; expensive and probabilistic only when necessary.

### 4.1 Rung 1 — deterministic

Look up *every* strong identifier on the event against
`identifiers UNIQUE (id_type, id_value)`. Not the first one that hits — all of
them. Confidence `1.0`, method `deterministic`.

Why all of them: if you stop at the first hit you never discover that the email
and the loyalty card on the same event point at two different members. The
system would resolve confidently and be wrong, silently.

### 4.2 Rung 2 — identifier conflict guard

Two or more proven identifiers resolving to different `customer_id`s →
`match_status = "conflict"`, `customer_id = None`, confidence `0.0`. Nothing is
linked, nothing is stitched, a `match_audit` row is written naming both members.

### 4.3 Rung 3 — behavioural conflict guard

A proven identifier alone is *still* not enough. `_behavioral_conflict()` runs on
every deterministic match and asks: does strong behavioural evidence on this same
event point at somebody else? (Someone else's device used with a shared or stolen
email.) If so, refuse.

It's written to be cheap in the common case, which matters because it runs on the
overwhelming majority of traffic:

1. One indexed lookup — has *any other* member recorded this `device_fp` or
   `ip_subnet` in the last 30 minutes?
2. Only if that finds something, pay for the full probabilistic pass.
3. Only refuse if the other member's score clears `RESOLVE_CONFIDENCE_THRESHOLD`
   (0.6) on its own — a coincidental shared office IP subnet must not be able to
   block an otherwise-clean match.

Under normal traffic step 2 almost never runs.

### 4.4 Rung 4 — probabilistic

For anonymous traffic. Pull recent `signals` rows (30-minute window) matching
`device_fp` or `ip_subnet`, group by member, score each candidate
([`core/config.py`](../backend/app/core/config.py) — all weights are env-tunable):

| Signal | Weight | How it scores |
|---|---|---|
| `device_fp` | 0.45 | exact match |
| `ip_subnet` | 0.20 | exact match on the /24 |
| recency | 0.20 | linear decay over the 30-minute window |
| geo | 0.15 | full credit within 50 km of home, decaying over 150 km (haversine) |

Best candidate wins, and the score becomes the confidence. Device dominates
because it's the most person-specific of the four; IP is weakest because a subnet
is a household or an office, not a person.

Bands:

| Score | Status | What happens |
|---|---|---|
| ≥ 0.60 | `matched` | linked automatically, audit row written |
| 0.30 – 0.60 | `uncertain` | linked *tentatively* and surfaced in the review queue |
| < 0.30 | `unresolved` | held apart; nothing is linked |

### 4.5 Rung 5 — hybrid

If deterministic and probabilistic independently agree on the same member,
confidence is `min(1.0, det + 0.4 × prob)`. Agreement between two independent
methods should be worth more than either alone, but it should not be additive to
the point of meaninglessness — hence the 0.4 discount.

### 4.6 Rung 6 — new member, race-safe

Nobody claimed any identifier: mint a `customer_id`, then try to claim the
identifiers with `INSERT … ON CONFLICT (id_type, id_value) DO NOTHING RETURNING`.
If a claim loses, another concurrent worker already owns that email/phone — so
the orphan customer row is deleted and the winner's id is returned. **The unique
index is the arbiter, not application locking**, which is what makes running
multiple workers safe with no coordination.

### 4.7 Everything is audited

Every rung — including the refusals — writes one row to `match_audit`:
`event_id, customer_id, confidence, method, signals_json, match_status,
decided_at`. `signals_json` holds the *evidence*, so a conflict row names both
candidate members and the identifier that disagreed.

This table is the product, not a log. The review queue, the precision/recall
number, and the "refused link" marks in the member graph are all reads over it.
It's how the claim "no silent merges" is demonstrable rather than asserted.

Only on a confirmed `matched` does the resolver *enrich* the graph — attach any
new strong identifiers and behavioural signals to that member. So the graph
learns from clean matches and learns nothing from disputed ones.

---

## 5. The read path

### 5.1 Stitching

[`backend/app/services/stitching.py`](../backend/app/services/stitching.py) writes
one Mongo document per member with the events embedded:

```js
{ customer_id, first_seen, last_seen, total_events,
  channels_touched: ["web","mobile_app","call_center"],
  events: [ { event_id, channel, event_type, occurred_at,
              confidence, match_method, match_status, payload }, … ] }
```

The append is idempotent by filter, not by check-then-write:

```js
update_one(
  { customer_id, "events.event_id": { $nin: [event_id] } },
  { $setOnInsert…, $min: {first_seen}, $max: {last_seen},
    $addToSet: {channels_touched}, $inc: {total_events}, $push: {events} },
  upsert=True )
```

If the event is already in the array the filter doesn't match and nothing
happens. This is the second half of the exactly-once story — a redelivered
message cannot inflate a timeline.

Note what is *not* stitched: `conflict` events. They have no member, so they
appear only in the audit trail and the review queue. `uncertain` events **are**
stitched, tentatively, and carry their status into the UI so a low-confidence
entry is visibly low-confidence.

### 5.2 Why two databases

This is the question a technical judge will ask, and the answer is that the two
workloads have nothing in common.

**Postgres** answers *"is this the same person, and why do you say so?"* — small
rows, high write concurrency, and correctness that must be enforced by the
database itself:

- `identifiers UNIQUE (id_type, id_value)` — simultaneously the deterministic
  match index and the guarantee that one identifier can belong to exactly one
  member.
- `signals UNIQUE (customer_id, signal_type, signal_value)`, indexed on
  `signal_value` and `last_seen` — the probabilistic candidate lookup.
- `alerts` with a **partial** unique index `WHERE status='open'` — one open alert
  per member per rule, enforced by the schema.
- `match_audit`, `ingest_latency` — append-only evidence.

**Mongo** answers *"show me everything this person has ever done."* That is one
document, one read, no joins and no fan-out. In a relational store the same
question is a join against an events table that grows without bound, sorted per
request. Embedding matches the access pattern exactly: the timeline is always
read whole, always for one member.

`ensure_schema()` in [`backend/app/main.py`](../backend/app/main.py) is
self-healing: on boot it collapses any duplicate open alerts with a
`ROW_NUMBER() OVER (PARTITION BY customer_id, rule_id …)` pass *before* creating
the partial unique index — so pre-existing dirty data can't leave the dedup net
permanently uninstalled.

### 5.3 Read APIs

| Endpoint | Source | Notes |
|---|---|---|
| `GET /api/customers` | Postgres + Mongo | catalogue paginated from Postgres so members with no recent events still appear; summaries joined in from Mongo |
| `GET /api/customers/{id}/timeline` | Mongo | `$sortArray` + `$slice` server-side |
| `GET /api/customers/{id}/graph` | Postgres | identifiers, signals, and refused links for one member |
| `GET /api/funnel` | Mongo aggregation | distinct members per step inside the window |
| `GET /api/unresolved` | `match_audit` | the review queue, plus a summary by status and method |
| `GET /api/analytics/repeat-contacts` | Mongo aggregation | 2+ assisted contacts in N days |
| `GET /api/metrics` | Postgres + Redis | totals, latency percentiles, cached accuracy |
| `GET /api/stream` | Redis pub/sub | SSE |

Two details worth knowing because they were bugs:

- **`_iso()` stamps UTC explicitly.** Motor returns naive datetimes; a naive ISO
  string is parsed as UTC by Node and as *local time* by the browser, so the
  server-rendered and client-rendered markup disagreed and React logged a
  hydration mismatch. Both [`api/customers.py`](../backend/app/api/customers.py)
  and [`api/analytics.py`](../backend/app/api/analytics.py) now stamp the zone.
- **The funnel's first rung unions `page_view` and `app_open`.** Web and mobile
  are parallel entry points, not sequential steps; splitting them across two
  rungs produced negative drop-off once the later steps were channel-agnostic.
- **The graph's conflict query checks two shapes, not one.** A refusal can
  associate a member either through `match_audit.customer_id` or through a
  customer id buried in `signals_json` — an identifier-vs-identifier conflict has
  no winning `customer_id` at all, so its only trace is inside the evidence blob.
  Querying one column found only half the refusals and the graph showed none for
  members whose conflicts had the other shape. The JSON match is quoted
  (`'%"' || :c || '"%'`) so `C0001` can't accidentally match `C00010`.

---

## 6. Real time, pushed not polled

The worker publishes each resolved event twice — `XADD` to `events.resolved` (a
durable log for anything that wants to replay) and `PUBLISH` to the
`events.resolved` channel (fan-out for anything watching now). The alert engine
publishes to `alerts.raised`.

[`backend/app/api/sse.py`](../backend/app/api/sse.py) subscribes to both and
relays over Server-Sent Events, with a 15-second `ping` so the connection
survives idle periods and intermediary timeouts.

The browser side is [`frontend/lib/sse.ts`](../frontend/lib/sse.ts). One subtlety
that matters: the message callback is held in a **ref**, not in the effect's
dependency array. Callers pass inline closures that change identity on every
render — often triggered by the callback's own `setState` — so depending on it
directly tore down and reopened the `EventSource` on every message. A reconnect
storm under any real event volume. The ref makes the connection open exactly
once.

SSE rather than WebSockets because the traffic is entirely server→client, SSE
reconnects on its own, and it rides plain HTTP through any corporate proxy.

---

## 7. Measurement, not assertion

**Latency.** `received_at_ms` is stamped onto the stream entry at ingest. When the
worker finishes resolving and stitching, it writes `now − received_at_ms` into
`ingest_latency`. So the number on the dashboard is true end-to-end (accept →
resolved → persisted), not a server-side span.
[`services/metrics.py`](../backend/app/services/metrics.py) computes p50/p95/p99
over a rolling window.

**Precision / recall.** Two independent paths, deliberately:

- *Live* — `MetricsService.precision_recall()` scores the last 24h of
  `match_audit` against the seeded catalogue by recovering the expected member
  from the identifiers attached to the resolved member. Cached in Redis at
  `metrics:accuracy`.
- *Harness* — [`backend/app/eval/evaluate.py`](../backend/app/eval/evaluate.py)
  generates a labelled set (4 identified + 1 anonymous event per member, plus 20
  deliberate collision events: member A's email arriving on member B's device),
  runs the resolver inline, and scores against known labels. It reports two
  numbers the live path can't: the **collision quarantine rate** (what share of
  engineered contradictions the system refused) and **`collision_wrong`** — how
  many it answered *silently and incorrectly*. That second number is the one that
  backs the safety claim, and it is meant to stay at zero.

**The dataset is fixed** — 1,000 members and 12,564 events in
[`data/`](../data) — so both numbers are reproducible rather than
lucky.

---

## 8. Alerts

[`backend/app/services/alerts.py`](../backend/app/services/alerts.py) runs
synchronously inside the same worker transaction as resolution, so an alert can
never lag the event that caused it.

| Rule | Trigger |
|---|---|
| R1 | ≥ 3 `login_failed` in 24h |
| R2 | ≥ 2 `payment_failed` in 7d |
| R3 | `add_to_cart` with no `payment_success`, then a call-centre contact within 30 min |
| R4 | churn keyword in a call transcript (`cancel`, `close account`, `frustrated`, …) |

R3 is the one that only exists *because* identity is resolved: the cart is a web
event and the call is a phone event, and they are the same person only after
resolution. It is the demo's proof that stitching creates information that
neither channel had.

Every alert carries a `suggested_action`. The design position is that an analyst
should be told what to do, not handed a chart. Dedup is belt-and-braces:
application-level upsert *and* the partial unique index, with the race path
falling back to updating the winner.

---

## 9. Frontend

Next.js 14 App Router, React 18, TypeScript, Tailwind.
[`frontend/`](../frontend).

- **Server components fetch on the server** (`dynamic = "force-dynamic"`,
  `revalidate = 0`). Inside Docker the SSR process calls `API_INTERNAL_URL`
  (`http://backend:8000`); the browser uses `NEXT_PUBLIC_API_URL`
  (`http://localhost:8000`) so SSE isn't buffered through Next.
- **Failure is honest.** Every fetch resolves to `null`, never to a zeroed
  object, and the page says "unavailable, not zero". A dead backend must look
  dead — a demo that shows confident zeros is worse than one that shows an error.
- **One design language, two colour rules.** A cool navy→cyan ramp means *channel*;
  warm red/amber means *a human is needed*. Nothing else in the product is
  coloured, so hue is always information. Libre Franklin (Franklin Gothic
  lineage — the voice of American finance) for prose, IBM Plex Mono with tabular
  figures for every number.
- **Presentation mode.** Everything is sized in `rem` against a single root
  `font-size`; pressing `P` moves the root to 18.5px and the entire interface
  scales for the back of a boardroom. Nothing renders below 13px.
- **Charts are hand-drawn SVG**, animated with `stroke-dasharray`/`stroke-dashoffset`,
  and every one of them degrades gracefully under `prefers-reduced-motion`.
- **The identity graph** ([`IdentityGraphView.tsx`](../frontend/app/components/IdentityGraphView.tsx))
  puts the member at the hub with the `customer_id` under it, and fans the
  evidence out on three fixed arcs — proven identifiers left, behavioural signals
  right, refused links on a warm arc below. Labels are always placed on the far
  side of a node from the hub while edges always arrive from the hub side, so an
  edge can never cross a label. Refusals are drawn as numbered badges and then
  listed *in full* in a ledger below the graph, keyed to the same numbers: the
  graph can run out of room for a mark, but it can never run out of room for the
  record.

---

## 10. Correctness properties, and what enforces each

| Property | Enforced by |
|---|---|
| An event is ingested once | Redis `SET NX` + `XADD` in one Lua script |
| An event is stitched once | Mongo `$nin` filter on `events.event_id` |
| An identifier belongs to one member | `identifiers UNIQUE (id_type, id_value)` |
| Concurrent workers can't fork a member | `ON CONFLICT … RETURNING`; the index arbitrates |
| One open alert per member per rule | partial unique index `WHERE status='open'` |
| A failed message is retried, not lost | ACK-after-success + `XAUTOCLAIM` |
| A poison message can't block the queue | dead-letter after 5 deliveries |
| Contradictory evidence is never merged | conflict guards, rungs 2 and 3 |
| Every decision can be re-argued | one `match_audit` row per decision, with evidence |
| The latency number is end-to-end | `received_at_ms` stamped at accept, measured at persist |

---

## 11. Honest limits

Worth stating before a judge finds them:

- **The data is synthetic.** 1,000 members, 12,564 events, generated. The
  pipeline is real; the population is not.
- **CORS is `allow_origins=["*"]`** — flagged in the code as demo-only.
- **Alert rules are hand-written, not learned.** Deliberate: four
  explainable rules beat one unexplainable model in a room that has to sign off
  on the action. The rule ids in the schema leave room for a model to propose
  rules later.
- **Single worker in compose.** The safety properties for N workers are already
  in place (consumer group, unique-index arbitration, idempotent stitch); the
  compose file just doesn't scale it out.
- **Probabilistic recall is bounded by the 30-minute window.** A device seen
  yesterday won't be a candidate today. That's a tuning choice
  (`PROB_TIME_WINDOW_MIN`), and widening it trades recall for a larger candidate
  set to score.

---

## 12. The three sentences

1. **Connected data, not more data.** JourneySync sits on top of the systems
   AmEx already has; nothing needs replacing.
2. **Real-time and auditable.** Every match has a score and a written reason, and
   nothing merges silently.
3. **Actionable, not analytical.** Every screen ends in what to do next, with the
   money shown.
