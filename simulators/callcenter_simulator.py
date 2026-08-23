"""Call-center channel simulator (IVR + agent transcripts)."""
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


CALL_EVENT_TYPES = [
    "call_connected", "ivr_menu", "agent_handoff", "transcript",
]


# Pre-baked transcript fragments
NORMAL_FRAGMENTS = [
    "Hi, I'd like to check my balance.",
    "Can you confirm my last transaction?",
    "Thanks, that's all I needed.",
    "I'd like to dispute a charge on my card.",
    "What's my reward points balance?",
]

CHURN_FRAGMENTS = [
    "I'm thinking about closing my account.",
    "This is really frustrating, I want to cancel.",
    "I'm unhappy with the service.",
    "I want to talk to someone about canceling.",
]


def make_call_event(c: dict, force_keyword: bool = False):
    et = random.choice(CALL_EVENT_TYPES)
    # Call-center events almost always have a phone number (ANI)
    idh = {"phone_e164": c["phone_e164"]}

    # 80% of calls use a known device (e.g. callback from app), 20% use a new one
    device_fp = c["primary_device_fp"] if random.random() < 0.8 else f"d-{random.randint(10**11, 10**12)}"
    ip = f"{random.randint(20,250)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"

    payload = {
        "ani": c["phone_e164"],
        "queue": random.choice(["retention", "service", "fraud", "general"]),
        "agent_id": f"A{random.randint(1000, 9999)}",
    }
    if et == "transcript":
        if force_keyword:
            payload["transcript"] = random.choice(CHURN_FRAGMENTS)
        else:
            payload["transcript"] = random.choice(NORMAL_FRAGMENTS)

    return {
        "event_id": gen_event_id(),
        "channel": "call_center",
        "event_type": et,
        "occurred_at": now().isoformat(),
        "identity": idh,
        "signals": {
            "device_fp": device_fp,
            "ip": ip,
            "ip_subnet": ip_subnet(ip),
            "geo": jitter_geo(c.get("home_geo"), km=1.0),
        },
        "payload": payload,
    }


async def run(n: int, rate: float, api: str, ground_truth: str, churn_frac: float):
    customers = load_ground_truth(ground_truth)
    async with httpx.AsyncClient(base_url=api, timeout=10.0) as client:
        sent = 0
        while sent < n:
            c = pick_customer(customers)
            force_kw = random.random() < churn_frac
            ev = make_call_event(c, force_keyword=force_kw)
            r = await client.post("/api/events", json=ev)
            r.raise_for_status()
            sent += 1
            if rate > 0:
                await asyncio.sleep(1.0 / rate)
        print(f"[callcenter_simulator] sent {sent} events ({churn_frac*100:.0f}% churn-keyword)")


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--n", type=int, default=50)
    p.add_argument("--rate", type=float, default=5)
    p.add_argument("--api", default="http://localhost:8000")
    p.add_argument("--ground-truth", default=None)
    p.add_argument("--churn-frac", type=float, default=0.1, help="fraction of calls with a churn keyword")
    args = p.parse_args()
    asyncio.run(run(args.n, args.rate, args.api, args.ground_truth or "", args.churn_frac))


if __name__ == "__main__":
    main()
