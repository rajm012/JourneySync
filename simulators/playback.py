"""Playback simulator — replays Others/data events against the live API."""
from __future__ import annotations
import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(ROOT) / "data"))


def load_customers() -> list[dict]:
    with open(DATA_DIR / "customers.json") as f:
        return json.load(f)


def load_events() -> list[dict]:
    with open(DATA_DIR / "events.json") as f:
        return json.load(f)


def event_to_api_payload(ev: dict, occurred_at: str | None = None, fresh_id: bool = False) -> dict:
    occurred = occurred_at or ev["occurred_at"]
    if occurred.endswith("Z"):
        occurred = occurred[:-1] + "+00:00"
    event_id = ev["event_id"]
    if fresh_id:
        import uuid
        event_id = f"ev-{uuid.uuid4().hex[:12]}"
    return {
        "event_id": event_id,
        "channel": ev["channel"],
        "event_type": ev["event_type"],
        "occurred_at": occurred,
        "identity": ev.get("identity") or {},
        "signals": ev.get("signals") or {},
        "payload": ev.get("payload") or {},
    }


async def push(client: httpx.AsyncClient, ev: dict, occurred_at: str | None = None, fresh_id: bool = False) -> tuple[bool, str]:
    payload = event_to_api_payload(ev, occurred_at=occurred_at, fresh_id=fresh_id)
    try:
        r = await client.post("/api/events", json=payload, timeout=10.0)
        if r.status_code >= 400:
            return False, f"HTTP {r.status_code}: {r.text[:120]}"
        return True, r.json().get("event_id", "?")
    except Exception as e:
        return False, repr(e)[:120]


async def one_customer(
    events: list[dict],
    customer_id: str,
    api: str,
    *,
    live_timestamps: bool = True,
    delay_s: float = 0.08,
) -> int:
    """Push all events for one customer, chronologically.

    live_timestamps=True remaps occurred_at to "now + offset" so alert rules
    that look at wall-clock windows still fire during a demo replay.
    """
    cust_events = [e for e in events if e.get("customer_id_hint") == customer_id]
    cust_events.sort(key=lambda e: e["occurred_at"])
    print(f"[customer] {customer_id}: {len(cust_events)} events")
    # Anchor the latest source event near "now" while preserving the original
    # gaps between sessions/days. The old i*2-second remap made a realistic
    # month-long journey appear to have happened on one day.
    source_times = [datetime.fromisoformat(e["occurred_at"].replace("Z", "+00:00")) for e in cust_events]
    latest_source = max(source_times) if source_times else datetime.now(timezone.utc)
    latest_live = datetime.now(timezone.utc)
    sent = 0
    async with httpx.AsyncClient(base_url=api, timeout=10.0) as client:
        for ev, source_time in zip(cust_events, source_times):
            occurred = (latest_live - (latest_source - source_time)).isoformat() if live_timestamps else None
            ok, _info = await push(client, ev, occurred_at=occurred, fresh_id=live_timestamps)
            mark = "✓" if ok else "✗"
            print(f"  {mark} {ev['channel']:12s}  {ev['event_type']}")
            if ok:
                sent += 1
            await asyncio.sleep(delay_s)
    print(f"[customer] {customer_id} done ({sent}/{len(cust_events)}).")
    return sent


async def hero(api: str, delay_s: float = 0.08) -> str:
    customers = load_customers()
    events = load_events()
    hero_cust = next((c for c in customers if "demo_hero" in c.get("tags", [])), None)
    if not hero_cust:
        hero_cust = next((c for c in customers if c.get("customer_id") == "C0001"), None)
    if not hero_cust:
        raise RuntimeError("no demo_hero / C0001 in customers.json")
    print(f"[hero] {hero_cust['name']} ({hero_cust['customer_id']})")
    await one_customer(events, hero_cust["customer_id"], api, live_timestamps=True, delay_s=delay_s)
    return hero_cust["customer_id"]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--mode", choices=["hero", "customer"], default="hero")
    p.add_argument("--api", default=os.environ.get("API", "http://127.0.0.1:8000"))
    p.add_argument("--customer-id", default="C0001")
    p.add_argument("--delay", type=float, default=0.08)
    args = p.parse_args()
    if args.mode == "hero":
        asyncio.run(hero(args.api, delay_s=args.delay))
    else:
        asyncio.run(one_customer(load_events(), args.customer_id, args.api, delay_s=args.delay))


if __name__ == "__main__":
    main()
