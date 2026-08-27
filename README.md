# JourneySync

> Real-time cross-channel identity resolution and customer journey stitching.
> American Express CodeStreet 2026 — In-Person Finale. **Team Cinephiles.**

Four channels — web, mobile app, call center, branch — become one timeline per card member in single-digit-to-low-double-digit milliseconds per event, with a confidence score and an audit row behind every link. **Nothing is ever merged silently.**

Modelled impact on the **1,300,853 AmEx India cards** the RBI reported in force in June 2026: **₹91–103 Crore a year** across churn prevention, cross-sell recovery and handle-time reduction — 3.6–4.1% of the card revenue that spend implies. Every input is printed on the dashboard and served with its source at [`/api/economics`](#the-cost-model-is-an-endpoint-not-a-slide), so any of them can be argued with.

---

## Quick start (one command)

```bash
docker compose up --build
```

First boot takes ~2 minutes: the frontend container runs `npm install`, and the backend seeds the 1,000-member catalog with multi-day activity in the background. Nothing needs to be triggered by hand — the dashboard is populated the moment it loads.

| | |
|---|---|
| Dashboard | http://localhost:3000 |
| API docs | http://localhost:8000/docs |
| The cost model, with its sources | http://localhost:8000/api/economics |
| Liveness | http://localhost:8000/health |
| Dependency readiness, with round-trip times | http://localhost:8000/health/ready |

Host-published DB ports are shifted to avoid clashing with local services: Postgres `5434`, Mongo `27018`, Redis `6381`. Inside Compose the services use their normal internal names and ports.

## The 90-second tour

1. **http://localhost:3000/dashboard** — the answer first: members unified, p95 time-to-link, avoidable servicing cost. Below the rule, the ₹91–103 Cr model with all ten inputs stated and sourced.
2. Press **`P`** to scale the entire interface for a projector. Every size in the product is in `rem`, so one root font-size change moves all of it.
3. **Run Asha's journey** in the demo strip. Watch the four lanes stitch together live, and the event ticker fill from the server-sent stream.
4. **http://localhost:3000/dashboard/customers/C0001** — one member, four channels, and her identity graph: which identifiers are proven, which behavioural signals are soft, and every link the resolver *refused* to make.
5. **/dashboard/unresolved** — the review queue. This is the control, not a backlog: it is how you can tell a confident link from an assumed one.
6. **/dashboard/funnel** — the deepest drop-off, counted in distinct resolved members rather than in clicks.
7. **Load test · 10,000 events** — 10k events over 30 seconds, and the latency percentiles on the Overview move while you watch.
