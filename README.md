# JourneySync

> Real-time cross-channel identity resolution and customer journey stitching.
> American Express CodeStreet 2026 — In-Person Finale. **Team Cinephiles.**

Four channels — web, mobile app, call center, branch — become one timeline per
card member in single-digit-to-low-double-digit milliseconds per event, with a
confidence score and an audit row behind every link. **Nothing is ever merged
silently.**

Modelled impact on AmEx India's 2 million premium members: **₹237–256 Crore a
year** across churn prevention, handle-time reduction and cross-sell recovery.
Every input is printed on the dashboard, so any of them can be argued with.

---

## Quick start (one command)

```bash
docker compose up --build
```

First boot takes ~2 minutes: the frontend container runs `npm install`, and the
backend seeds the 1,000-member catalog with multi-day activity in the
background. Nothing needs to be triggered by hand — the dashboard is populated
the moment it loads.

| | |
|---|---|
| Dashboard | http://localhost:3000 |
| API docs | http://localhost:8000/docs |
| Liveness | http://localhost:8000/health |
| Dependency readiness, with round-trip times | http://localhost:8000/health/ready |

Host-published DB ports are shifted to avoid clashing with local services:
Postgres `5434`, Mongo `27018`, Redis `6381`. Inside Compose the services use
their normal internal names and ports.

## The 90-second tour

1. **http://localhost:3000/dashboard** — the answer first: members unified, p95
   time-to-link, avoidable servicing cost. Below the rule, the ₹237–256 Cr
   model with all six inputs stated.
2. Press **`P`** to scale the entire interface for a projector. Every size in
   the product is in `rem`, so one root font-size change moves all of it.
3. **Run Asha's journey** in the demo strip. Watch the four lanes stitch
   together live, and the event ticker fill from the server-sent stream.
4. **http://localhost:3000/dashboard/customers/C0001** — one member, four
   channels, and her identity graph: which identifiers are proven, which
   behavioural signals are soft, and every link the resolver *refused* to make.
5. **/dashboard/unresolved** — the review queue. This is the control, not a
   backlog: it is how you can tell a confident link from an assumed one.
6. **/dashboard/funnel** — the deepest drop-off, counted in distinct resolved
   members rather than in clicks.
7. **Load test · 10,000 events** — 10k events over 30 seconds, and the latency
   percentiles on the Overview move while you watch.

## How this maps to the problem statement

| Task | Where it lives | What proves it |
|---|---|---|
| Identity resolution algorithm across app, web, call-center, in-person | `backend/app/services/resolution.py` | Six-rung ladder: deterministic → identifier-conflict guard → behavioural-conflict guard → probabilistic → hybrid → new identity. Every branch writes a `match_audit` row. |
| Pipeline to ingest, normalize and stitch into a unified timeline | `backend/app/api/events.py`, `backend/app/workers/resolver_worker.py` | One event schema for all four channels; Redis Streams as the buffer; exactly-once via a Lua `SET NX + XADD`; ack-after-success with `XAUTOCLAIM` recovery and a DLQ. |
| Analyst interface: stitched journeys, drop-offs, escalations, unresolved | `frontend/app/dashboard/**` | Journey spine, funnel, risk signals, review queue, identity graph — six views, all live. |
| Journey analytics correlating churn, repeat contact, poor experience | `backend/app/services/alerts.py`, `backend/app/api/analytics.py` | Rules R1–R4 over the *stitched* timeline, plus the repeat-contact view — the earliest churn signal we have, priced. |
| Test and optimize for accuracy, latency, actionability | `backend/app/eval/evaluate.py`, `/api/metrics` | Precision / recall against the 1,000-member ground truth, plus collision counts; p50/p95/p99 measured per event in `ingest_latency`; every alert carries the action to take. |

## How a link is decided

| Confidence | What happens |
|---|---|
| ≥ 0.60 | Linked automatically, with an audit row |
| 0.30 – 0.60 | Held in the review queue for a human |
| < 0.30 | Held apart from this identity |

Two guards sit above the score. If a **proven identifier** and **strong
behaviour** point at different members, the event is refused and queued — never
merged, in either direction. Those refusals are drawn on the member's identity
graph and listed in full beneath it.

## Measuring it

```bash
# Precision / recall against the 1,000-member ground truth (caches into /api/metrics)
docker compose exec backend python -m app.eval.evaluate
# or, from anywhere:
curl -X POST http://localhost:8000/api/metrics/refresh-accuracy

# Latency under load — 10k events in 30 seconds
docker compose exec backend python -m simulators.run_demo --scenario burst

# Asha's four-channel hero journey (~27 events, played back on the real clock)
docker compose exec backend python -m simulators.run_demo --scenario demo
```

Latency is measured end to end per event and read over a rolling 24 hours, so
the figure does not go blank when the room stops generating traffic.

## Repo layout

```
Others/
├── docker-compose.yml       # postgres · mongo · redis · backend · worker · frontend
├── data/
│   ├── customers.json       # 1,000-member synthetic catalog
│   ├── events.json          # multi-day cross-channel activity
│   └── ground_truth.json    # labels for the accuracy harness
├── simulators/              # web, app and call-center event generators + playback
├── backend/                 # FastAPI: ingest, resolve, stitch, alert, evaluate
│   ├── app/api/             # events, customers, analytics, sse, demo
│   ├── app/services/        # resolution, stitching, alerts, metrics, seed
│   ├── app/workers/         # resolver_worker — the consumer group
│   └── app/eval/            # precision / recall harness
├── frontend/                # Next.js 14 App Router dashboard
│   ├── app/dashboard/       # overview, members, journeys, risk, review, repeat
│   ├── app/components/      # journey spine, identity graph, funnel, ticker
│   └── lib/economics.ts     # the business case, every figure derived
└── docs/
    ├── ARCHITECTURE.md      # how it works and why it works that way
    ├── architecture.svg     # 16:9 diagram for the deck
    └── TALKING-THE-NUMBERS.md
```

## Why the design looks like this

A ledger, not a dashboard: hairline rules instead of boxes, tabular figures that
line up in a column, and exactly two colour rules — the cool navy-to-cyan ramp
is the four channels, and warm red or amber means *something needs a human*.
Money is left in ink, because a rupee is neither a channel nor a refusal. If it
has a hue in this interface, it means something.

## Honest limits

- Probabilistic matching uses device fingerprint, IP subnet and a 30-minute
  behavioural window. No ML model is trained; the weights are hand-set and
  visible in `resolution.py`.
- The accuracy harness scores against our own synthetic ground truth, so it
  measures the algorithm, not real AmEx traffic.
- CORS is wide open and there is no auth. This is a demo, and it says so in
  `main.py`.
- The ₹237–256 Cr is a model on stated inputs, not a measurement. The dashboard
  draws a hard rule between what it measured and what it modelled.

## The three things to remember

- **Connected data, not more data.** It sits on top of existing systems.
- **Real-time and auditable.** Every match carries a confidence score. No silent
  merges — refusals are a feature, and they are visible.
- **Actionable, not analytical.** Every risk signal names the next action, and
  prices what happens if nobody takes it.
