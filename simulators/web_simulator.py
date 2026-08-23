"""Web channel simulator.

Generates realistic web events (page_view, product_view, add_to_cart, payment_attempt,
payment_success, payment_failed, login_failed) and POSTs them to /api/events.
"""
from __future__ import annotations
import argparse
import asyncio
import random
import os
import sys
from datetime import datetime, timezone, timedelta

import httpx

# Make sibling modules importable when run from anywhere
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Docker: ROOT=/app (app + simulators + data as siblings). Local: ROOT=Others/.
sys.path.insert(0, ROOT)
_backend = os.path.join(ROOT, "backend")
if os.path.isdir(_backend):
    sys.path.insert(0, _backend)

from simulators.common import load_ground_truth, pick_customer, now, gen_event_id, ip_subnet, jitter_geo


WEB_EVENT_TYPES = [
    "page_view", "product_view", "add_to_cart", "payment_attempt",
    "payment_success", "payment_failed", "login_failed",
]


def make_web_event(c: dict, anon: bool = False):
    et = random.choice(WEB_EVENT_TYPES)
    idh = {}
    if not anon and random.random() < 0.7:
        # Strong identity
        if random.random() < 0.5:
            idh["email"] = c["email"]
        else:
            idh["loyalty_card"] = c["loyalty_card"]

    device_fp = c["primary_device_fp"]
    ip = f"{random.randint(20,250)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"
    payload = {"url": f"/products/{random.randint(1, 200)}"}
    if et == "payment_failed":
        payload["reason"] = random.choice(["insufficient_funds", "card_declined", "3ds_failed"])
    return {
        "event_id": gen_event_id(),
        "channel": "web",
        "event_type": et,
        "occurred_at": now().isoformat(),
        "identity": idh,
        "signals": {
            "device_fp": device_fp,
            "ip": ip,
            "ip_subnet": ip_subnet(ip),
            "geo": jitter_geo(c.get("home_geo")),
            "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15",
        },
        "payload": payload,
    }


async def run(n: int, anon_pct: float, rate: float, api: str, ground_truth: str):
    customers = load_ground_truth(ground_truth)
    async with httpx.AsyncClient(base_url=api, timeout=10.0) as client:
        sent = 0
        while sent < n:
            c = pick_customer(customers)
            ev = make_web_event(c, anon=random.random() < anon_pct)
            r = await client.post("/api/events", json=ev)
            r.raise_for_status()
            sent += 1
            if rate > 0:
                await asyncio.sleep(1.0 / rate)
        print(f"[web_simulator] sent {sent} events")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=100)
    p.add_argument("--anon-pct", type=float, default=0.3, help="fraction of events with no strong identity")
    p.add_argument("--rate", type=float, default=20, help="events per second (0 = as fast as possible)")
    p.add_argument("--api", default="http://localhost:8000")
    p.add_argument("--ground-truth", default=None)
    args = p.parse_args()
    asyncio.run(run(args.n, args.anon_pct, args.rate, args.api, args.ground_truth or ""))


if __name__ == "__main__":
    main()
