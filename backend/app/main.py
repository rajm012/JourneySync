"""FastAPI entry point."""
from __future__ import annotations
import asyncio
import time
from contextlib import asynccontextmanager
from app.api import analytics, customers, demo, events
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api import sse
from app.core.db import SessionLocal, engine
from app.core.mongo import ensure_indexes, get_client
from app.core.redis_client import ensure_consumer_group, get_redis
from app.core.config import settings
from app.services.seed import seed_customers


async def ensure_schema() -> None:
    """Idempotent DDL for indexes added after first volume init.

    Self-healing: stray duplicate open alerts (from runs before the app-level
    dedup existed) permanently block CREATE UNIQUE INDEX on every future
    startup unless we clear them first — so the safety net silently never
    turns on. Collapse duplicates to the newest row before (re)creating it.
    """
    try:
        async with engine.begin() as conn:
            await conn.execute(text("""
                UPDATE alerts SET status='resolved', resolved_at=NOW()
                WHERE status='open' AND id IN (
                    SELECT id FROM (
                        SELECT id, ROW_NUMBER() OVER (
                            PARTITION BY customer_id, rule_id ORDER BY created_at DESC
                        ) rn
                        FROM alerts WHERE status='open'
                    ) dupes WHERE rn > 1
                )
            """))
            await conn.execute(text("""
                CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_open_rule
                ON alerts (customer_id, rule_id) WHERE status = 'open'
            """))
    except Exception as e:
        print(f"[startup] ensure_schema skipped: {e!r}")


async def _startup_seed() -> None:
    """Load the 1,000-customer catalog + multi-day activity in the background.

    Without this, a fresh `docker compose up` (or one hitting a volume left
    over from before this catalog existed) serves whatever was seeded last —
    which can silently be the old 51-customer, single-day dataset. Runs as a
    background task rather than inline so it never delays the health check.
    """
    try:
        async with SessionLocal() as session:
            result = await seed_customers(session)
            print(f"[startup] seeded demo catalog: {result}")
    except Exception as e:
        print(f"[startup] seed_customers skipped: {e!r}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Docker's embedded DNS can briefly lag while dependent containers join
    # the network. Retry startup-only Mongo initialization instead of taking
    # down the API on the first transient resolution failure.
    for attempt in range(1, 6):
        try:
            await ensure_indexes()
            break
        except Exception as exc:
            if attempt == 5:
                raise
            delay = attempt * 2
            print(f"[startup] Mongo index initialization failed (attempt {attempt}/5): {exc!r}; retrying in {delay}s")
            await asyncio.sleep(delay)
    await ensure_schema()
    await ensure_consumer_group(settings.RAW_STREAM, settings.CONSUMER_GROUP)
    asyncio.create_task(_startup_seed())
    yield


app = FastAPI(
    title="JourneySync API",
    description="Real-time cross-channel identity resolution & customer journey stitching.",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS for the Next.js dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],   # demo only; lock down for prod
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(events.router)
app.include_router(customers.router)
app.include_router(analytics.router)
app.include_router(sse.router)
app.include_router(demo.router)


@app.get("/health")
async def health():
    return {"status": "ok", "service": "journeysync"}


@app.get("/health/ready")
async def health_ready():
    """Dependency readiness with round-trip latency — a live-in-the-room
    answer to "how do you know your stack is actually healthy?", not just
    "the process is running"."""
    checks: dict[str, dict] = {}
    ok = True

    t0 = time.perf_counter()
    try:
        async with SessionLocal() as s:
            await s.execute(text("SELECT 1"))
        checks["postgres"] = {"status": "ok", "latency_ms": round((time.perf_counter() - t0) * 1000, 2)}
    except Exception as e:
        ok = False
        checks["postgres"] = {"status": "error", "detail": str(e)}

    t0 = time.perf_counter()
    try:
        await get_client().admin.command("ping")
        checks["mongo"] = {"status": "ok", "latency_ms": round((time.perf_counter() - t0) * 1000, 2)}
    except Exception as e:
        ok = False
        checks["mongo"] = {"status": "error", "detail": str(e)}

    t0 = time.perf_counter()
    try:
        await get_redis().ping()
        checks["redis"] = {"status": "ok", "latency_ms": round((time.perf_counter() - t0) * 1000, 2)}
    except Exception as e:
        ok = False
        checks["redis"] = {"status": "error", "detail": str(e)}

    body = {"status": "ready" if ok else "degraded", "checks": checks}
    return JSONResponse(content=body, status_code=200 if ok else 503)


@app.get("/")
async def root():
    return {
        "service": "JourneySync",
        "version": "0.1.0",
        "docs": "/docs",
        "endpoints": [
            "POST /api/events",
            "POST /api/events/bulk",
            "GET  /api/customers",
            "GET  /api/customers/{id}",
            "GET  /api/customers/{id}/timeline",
            "GET  /api/funnel",
            "GET  /api/alerts",
            "POST /api/alerts/{id}/ack",
            "GET  /api/metrics",
            "GET  /api/stream  (SSE)",
        ],
    }
