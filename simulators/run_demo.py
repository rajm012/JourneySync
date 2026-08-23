"""Curated demo orchestrator — runs the 90-second hero scenario.

Usage:
  python -m simulators.run_demo --scenario demo      # 90s curated story
  python -m simulators.run_demo --scenario burst     # 10k events / 30s
  python -m simulators.run_demo --scenario alerts    # trigger specific alerts
"""
from __future__ import annotations
import argparse
import asyncio
import os
import random
import sys
import time
from datetime import datetime, timezone, timedelta

import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Docker: ROOT=/app (app + simulators + data as siblings). Local: ROOT=Others/.
sys.path.insert(0, ROOT)
_backend = os.path.join(ROOT, "backend")
if os.path.isdir(_backend):
    sys.path.insert(0, _backend)

from simulators.common import load_ground_truth, now, gen_event_id, ip_subnet, jitter_geo


API = os.environ.get("API", "http://localhost:8000")


async def post(client: httpx.AsyncClient, ev: dict) -> dict:
    r = await client.post("/api/events", json=ev)
    r.raise_for_status()
    return r.json()


def make_event(channel, event_type, identity, signals, payload=None, occurred_at=None):
    return {
        "event_id": gen_event_id(),
        "channel": channel,
        "event_type": event_type,
        "occurred_at": (occurred_at or now()).isoformat(),
        "identity": identity or {},
        "signals": signals or {},
        "payload": payload or {},
    }


async def scenario_demo(api: str):
    """Hero story: seed identity graph, then replay Asha (C0001) from data-m."""
    from simulators.playback import hero

    # Ensure seed happened (UI path seeds first; CLI path may not).
    try:
        async with httpx.AsyncClient(base_url=api, timeout=30.0) as client:
            r = await client.post("/api/demo/seed")
            if r.status_code < 400:
                print(f"[demo] seed → {r.json()}")
            else:
                print(f"[demo] seed skipped/failed: HTTP {r.status_code}")
    except Exception as e:
        print(f"[demo] seed call failed ({e}); continuing — assume already seeded")

    customer_id = await hero(api, delay_s=0.08)
    await scenario_review_queue(api)
    print("[demo] story complete.")
    print(f"[demo] API timeline: {api}/api/customers/{customer_id}/timeline")
    print(f"[demo] UI: http://localhost:3000/dashboard/customers/{customer_id}")


async def scenario_review_queue(api: str):
    """Seed the Unresolved Issues queue with real audit rows.

    - ip_subnet only → probabilistic ~0.40 → uncertain (review band)
    - Asha's email on another customer's established device → conflict_guard
    """
    customers = load_ground_truth()
    asha = next((c for c in customers if c.get("customer_id") == "C0001"), customers[0])
    other = next((c for c in customers if c.get("customer_id") != asha["customer_id"]), customers[-1])
    print(f"[review] seeding uncertain + conflict rows ({asha['name']} / {other['name']})")
    async with httpx.AsyncClient(base_url=api, timeout=10.0) as client:
        # Establish other customer's device as a strong behavioral identity
        for i in range(3):
            await post(client, make_event("web", "page_view", {"email": other["email"]}, {
                "device_fp": other["primary_device_fp"],
                "ip": "203.0.113.10",
                "ip_subnet": "203.0.113.0/24",
            }, {"url": f"/establish-other-{i}"}))
            await asyncio.sleep(0.05)

        # Weak IP-only anonymous traffic → uncertain band
        for i in range(12):
            await post(client, make_event("web", "page_view", {}, {
                "ip": "103.21.45.200",
                "ip_subnet": "103.21.45.0/24",
            }, {"url": f"/anon-uncertain-{i}", "note": "ip_subnet only"}))
            await asyncio.sleep(0.05)

        # Conflicts: known identifiers appearing on an established foreign device.
        for i in range(5):
            await post(client, make_event("web", "page_view", {"email": asha["email"]}, {
                "device_fp": other["primary_device_fp"], "ip": "203.0.113.10", "ip_subnet": "203.0.113.0/24",
            }, {"url": f"/conflict-shared-email-{i}", "note": "identifier vs behavioral conflict"}))
    print("[review] done — check /dashboard/unresolved")


async def scenario_burst(api: str, n: int, duration_s: int):
    """Burst N events in `duration_s` seconds. Used to prove latency claim."""
    print(f"[burst] firing {n} events in {duration_s}s")
    customers = load_ground_truth()
    # Event types must stay plausible per channel — mixing them (e.g. a
    # call_center "app_open") produces nonsense entries in customer timelines.
    channel_event_types = {
        "web": ["page_view", "product_view", "add_to_cart", "payment_attempt", "payment_success"],
        "mobile_app": ["app_open", "product_view", "add_to_cart", "payment_attempt", "payment_success"],
        "call_center": ["call_connected"],
    }
    channels = list(channel_event_types.keys())
    delay = duration_s / n

    async with httpx.AsyncClient(base_url=api, timeout=10.0) as client:
        sem = asyncio.Semaphore(200)
        async def one():
            async with sem:
                c = random.choice(customers)
                ch = random.choice(channels)
                et = random.choice(channel_event_types[ch])
                idh = {}
                if ch == "call_center":
                    idh["phone_e164"] = c["phone_e164"]
                elif random.random() < 0.7:
                    idh["user_id"] = c["customer_id"]
                ip = f"{random.randint(1,254)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"
                ev = make_event(ch, et, idh, {
                    "device_fp": c["primary_device_fp"],
                    "ip": ip,
                    "ip_subnet": ip_subnet(ip),
                    "geo": jitter_geo(c.get("home_geo"), km=2),
                })
                try:
                    await client.post("/api/events", json=ev)
                except Exception as e:
                    pass
        start = time.time()
        tasks = [one() for _ in range(n)]
        await asyncio.gather(*tasks)
        print(f"[burst] done in {time.time()-start:.2f}s")


async def scenario_alerts(api: str):
    """Trigger one of each alert type for the demo (R1–R4)."""
    customers = load_ground_truth()
    target = random.choice(customers)
    print(f"[alerts] target: {target['name']} ({target['customer_id']})")

    async with httpx.AsyncClient(base_url=api, timeout=10.0) as client:
        # R1: 3 failed logins
        for i in range(3):
            await post(client, make_event("web", "login_failed", {"email": target["email"]}, {
                "device_fp": target["primary_device_fp"],
                "ip": "103.21.45.99", "ip_subnet": "103.21.45.0/24",
                "geo": jitter_geo(target.get("home_geo")),
            }, {"reason": "wrong_password"}))
            await asyncio.sleep(0.2)

        # R2: 2 payment failures
        for i in range(2):
            await post(client, make_event("web", "payment_failed", {"email": target["email"]}, {
                "device_fp": target["primary_device_fp"],
                "ip": "103.21.45.99", "ip_subnet": "103.21.45.0/24",
                "geo": jitter_geo(target.get("home_geo")),
            }, {"reason": "card_declined", "attempt": i + 1}))
            await asyncio.sleep(0.2)

        # R3: funnel drop (cart, no pay) + call
        await post(client, make_event("mobile_app", "add_to_cart", {"user_id": target["customer_id"]}, {
            "device_fp": target["primary_device_fp"],
            "ip": "103.21.45.99", "ip_subnet": "103.21.45.0/24",
            "geo": jitter_geo(target.get("home_geo")),
        }))
        await asyncio.sleep(0.5)
        await post(client, make_event("call_center", "call_connected", {"phone_e164": target["phone_e164"]}, {
            "device_fp": target["primary_device_fp"],
            "ip": "103.21.45.99", "ip_subnet": "103.21.45.0/24",
            "geo": jitter_geo(target.get("home_geo")),
        }, {"queue": "service"}))

        # R4: churn keyword
        await asyncio.sleep(0.5)
        await post(client, make_event("call_center", "transcript", {"phone_e164": target["phone_e164"]}, {
            "device_fp": target["primary_device_fp"],
            "ip": "103.21.45.99", "ip_subnet": "103.21.45.0/24",
            "geo": jitter_geo(target.get("home_geo")),
        }, {"transcript": "I want to close my account, this is unacceptable."}))
        print("[alerts] done.")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--scenario", choices=["demo", "burst", "alerts"], default="demo")
    p.add_argument("--api", default=API)
    p.add_argument("--n", type=int, default=10000)
    p.add_argument("--duration", type=int, default=30)
    args = p.parse_args()

    if args.scenario == "demo":
        asyncio.run(scenario_demo(args.api))
    elif args.scenario == "burst":
        asyncio.run(scenario_burst(args.api, args.n, args.duration))
    elif args.scenario == "alerts":
        asyncio.run(scenario_alerts(args.api))


if __name__ == "__main__":
    main()
