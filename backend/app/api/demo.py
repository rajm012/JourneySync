"""Demo control endpoints — trigger the curated scenarios from the UI.

POST /api/demo/seed   → upsert data-m customers into Postgres identity graph
POST /api/demo/run    → seed + Asha's hero journey (data-m playback)
POST /api/demo/burst  → 10k events / 30s
POST /api/demo/alerts → trigger one of each alert type
POST /api/demo/reset  → wipe everything and reseed a clean 1,000-customer catalog
"""
from __future__ import annotations
import asyncio
import os
import threading
from fastapi import APIRouter
from sqlalchemy import text

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.mongo import get_db
from app.services.seed import seed_customers

router = APIRouter(prefix="/api/demo", tags=["demo"])

API = os.environ.get("API", "http://127.0.0.1:8000")


def _spawn_scenario(name: str, **kwargs):
    """Run the scenario in a fresh asyncio loop on a background thread."""
    from simulators.run_demo import scenario_demo, scenario_burst, scenario_alerts

    def _runner():
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            if name == "demo":
                loop.run_until_complete(scenario_demo(API))
            elif name == "burst":
                loop.run_until_complete(scenario_burst(
                    API, kwargs.get("n", settings.DEMO_BURST_SIZE),
                    kwargs.get("duration", settings.DEMO_BURST_DURATION_SECONDS),
                ))
            elif name == "alerts":
                loop.run_until_complete(scenario_alerts(API))
        finally:
            loop.close()

    t = threading.Thread(target=_runner, daemon=True)
    t.start()
    return t


@router.post("/seed")
async def seed():
    async with SessionLocal() as session:
        result = await seed_customers(session)
    return {"ok": True, **result}


@router.post("/run")
async def run_demo():
    # Seed first so C0001 (Asha) exists before playback starts.
    async with SessionLocal() as session:
        seeded = await seed_customers(session)
    _spawn_scenario("demo")
    return {"ok": True, "scenario": "demo", **seeded}


@router.post("/burst")
async def run_burst(n: int = 10000, duration: int = 30):
    async with SessionLocal() as session:
        await seed_customers(session)
    _spawn_scenario("burst", n=n, duration=duration)
    return {"ok": True, "scenario": "burst", "n": n, "duration": duration}


@router.post("/alerts")
async def run_alerts():
    async with SessionLocal() as session:
        await seed_customers(session)
    _spawn_scenario("alerts")
    return {"ok": True, "scenario": "alerts"}


@router.post("/reset")
async def reset_demo():
    """Wipe every synthetic customer/event/alert and reseed a clean catalog.

    Repeated demo/burst runs mint new synthetic customers that never get
    cleaned up, so the identity graph drifts above the pitched "1,000
    customers" number over time. Run this the morning of a demo so the
    numbers on screen match the one-pager.
    """
    async with SessionLocal() as session:
        await session.execute(text("TRUNCATE match_audit, alerts, signals, identifiers, customers RESTART IDENTITY CASCADE"))
        await session.commit()
    db = get_db()
    await db.timelines.delete_many({})
    async with SessionLocal() as session:
        result = await seed_customers(session)
    return {"ok": True, "reset": True, **result}
