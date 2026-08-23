# JourneySync

> Real-time cross-channel identity resolution & customer journey stitching.
> American Express Hackathon — In-Person Finale. **Team Cinephiles.**

## Quick start (one command)

```bash
cp .env.example .env
docker compose up --build
```

Then:
- Frontend → http://localhost:3000
- Backend API → http://localhost:8000/docs
- Backend health → http://localhost:8000/health

Host-published DB ports (to avoid clashes with other local services):
Postgres `5434`, Mongo `27018`, Redis `6381`. Inside Compose, services still use the normal internal names/ports.

## Repo layout

```
journeysync/
├── docker-compose.yml          # postgres + mongo + redis + backend + worker + frontend
├── data/ground_truth.json      # 100-customer synthetic dataset
├── simulators/                 # web, app, call-center event generators
├── backend/                    # FastAPI: ingest, resolve, stitch, alert, eval
├── frontend/                   # Next.js dashboard (timeline, funnel, alerts)
└── docs/                       # the master plan, demo script, winning strategy
```

## Run the demo scenario

In a separate terminal, after `docker compose up`:

```bash
# Seed identity graph (51 customers including Asha C0001)
docker compose exec backend curl -s -X POST http://127.0.0.1:8000/api/demo/seed

# Hero story — Asha's 4-channel journey from data-m (~27 events)
docker compose exec backend python -m simulators.run_demo --scenario demo

# Or from the UI: Dashboard → "Run hero scenario"

# 10k-event burst (latency proof)
docker compose exec backend python -m simulators.run_demo --scenario burst

# Precision / recall (caches into /api/metrics)
docker compose exec backend python -m app.eval.evaluate
# or: curl -X POST http://localhost:8000/api/metrics/refresh-accuracy
```

After the hero run, open http://localhost:3000/dashboard/customers/C0001

Also check:
- Unresolved review queue → http://localhost:3000/dashboard/unresolved
- Repeat contacts → http://localhost:3000/dashboard/repeat-contacts

