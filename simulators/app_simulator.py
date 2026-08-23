"""Mobile-app channel simulator."""
from __future__ import annotations
import argparse
import asyncio
import random
import os
import sys
import httpx

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Docker: ROOT=/app (app + simulators + data as siblings). Local: ROOT=Others/.
sys.path.insert(0, ROOT)
_backend = os.path.join(ROOT, "backend")
if os.path.isdir(_backend):
    sys.path.insert(0, _backend)

from simulators.common import load_ground_truth, pick_customer, now, gen_event_id, ip_subnet, jitter_geo


APP_EVENT_TYPES = [
    "app_open", "product_view", "add_to_cart", "payment_attempt",
    "payment_success", "payment_failed", "login_failed",
]


def make_app_event(c: dict, anon: bool = False):
    et = random.choice(APP_EVENT_TYPES)
    idh = {}
    if not anon and random.random() < 0.8:
        which = random.choice(["user_id", "phone", "email"])
        if which == "user_id":
            idh["user_id"] = c["customer_id"]
        elif which == "phone":
            idh["phone_e164"] = c["phone_e164"]
        else:
            idh["email"] = c["email"]

    # Mobile devices rotate IPs more; pick a /24 stable
    ip = f"{random.randint(20,250)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"
    payload = {"screen": f"ProductDetail/{random.randint(1,200)}"}
    return {
        "event_id": gen_event_id(),
        "channel": "mobile_app",
        "event_type": et,
        "occurred_at": now().isoformat(),
        "identity": idh,
        "signals": {
            "device_fp": c["primary_device_fp"],
            "ip": ip,
            "ip_subnet": ip_subnet(ip),
            "geo": jitter_geo(c.get("home_geo"), km=2.0),
            "user_agent": "AmExApp/4.2.0 (iOS 17.4; iPhone15,2)",
        },
        "payload": payload,
    }


async def run(n: int, anon_pct: float, rate: float, api: str, ground_truth: str):
    customers = load_ground_truth(ground_truth)
    async with httpx.AsyncClient(base_url=api, timeout=10.0) as client:
        sent = 0
        while sent < n:
            c = pick_customer(customers)
            ev = make_app_event(c, anon=random.random() < anon_pct)
            r = await client.post("/api/events", json=ev)
            r.raise_for_status()
            sent += 1
            if rate > 0:
                await asyncio.sleep(1.0 / rate)
        print(f"[app_simulator] sent {sent} events")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=100)
    p.add_argument("--anon-pct", type=float, default=0.2)
    p.add_argument("--rate", type=float, default=15)
    p.add_argument("--api", default="http://localhost:8000")
    p.add_argument("--ground-truth", default=None)
    args = p.parse_args()
    asyncio.run(run(args.n, args.anon_pct, args.rate, args.api, args.ground_truth or ""))


if __name__ == "__main__":
    main()
