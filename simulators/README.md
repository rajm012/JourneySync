# Simulators

Channel adapters that generate realistic event traffic. Each one is a standalone
Python script that POSTs to the JourneySync ingest API.

## Files

| File | Purpose |
|---|---|
| `common.py` | Shared helpers (Faker, ground-truth loader, geo jitter) |
| `generate_ground_truth.py` | One-time: writes `data/ground_truth.json` with 100 customers |
| `web_simulator.py` | Generates web events (page_view, product_view, add_to_cart, payment_*, login_failed) |
| `app_simulator.py` | Generates mobile-app events |
| `callcenter_simulator.py` | Generates IVR/agent events (incl. transcripts with churn keywords) |
| `run_demo.py` | Orchestrated scenarios for the demo: hero, burst, alerts |

## Quick start

```bash
# 1) Generate ground truth (once)
python simulators/generate_ground_truth.py

# 2) Start the stack
docker compose up

# 3) Run one simulator in another terminal
docker compose exec backend python -m simulators.web_simulator --n 500 --rate 50

# 4) Or run the hero scenario
docker compose exec backend python -m simulators.run_demo --scenario demo
```

## Scenarios

### `demo` — Asha's hero journey (90s)
A curated, narrated story: anonymous web visit → app open → product view →
add to cart → payment failure → call center with churn keyword → second
payment success. This is the demo you'll show the jury.

### `burst` — 10k events / 30s
Fires 10,000 events in 30 seconds. Used to prove the latency claim.

### `alerts` — trigger one of each rule
Generates events designed to fire R1 (failed login burst), R3 (funnel drop +
call), and R4 (churn keyword).

## Tweaking the simulators

Each simulator takes:
- `--n` — number of events to send
- `--rate` — events per second (0 = as fast as possible)
- `--anon-pct` — fraction of events with no strong identity
- `--api` — base URL of the JourneySync API

The call center simulator additionally takes `--churn-frac` to control how many
calls contain a churn keyword.
