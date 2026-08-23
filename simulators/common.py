"""Shared helpers for the channel simulators."""
from __future__ import annotations
import json
import os
import random
import uuid
from datetime import datetime, timezone
from pathlib import Path

from faker import Faker

fake = Faker("en_IN")

DATA_DIR = Path(os.environ.get("DATA_DIR", Path(__file__).resolve().parents[1] / "data"))


def load_ground_truth(path: str | None = None) -> list[dict]:
    """Load demo customers. Prefer rich customers.json (data-m), else ground_truth.json."""
    if path:
        p = Path(path)
    else:
        env = os.environ.get("CUSTOMERS_PATH") or os.environ.get("GROUND_TRUTH")
        if env:
            p = Path(env)
        else:
            rich = DATA_DIR / "customers.json"
            legacy = DATA_DIR / "ground_truth.json"
            p = rich if rich.is_file() else legacy
    with open(p) as f:
        return json.load(f)


def pick_customer(customers: list[dict]) -> dict:
    return random.choice(customers)


def now() -> datetime:
    return datetime.now(timezone.utc)


def gen_event_id() -> str:
    return f"ev-{uuid.uuid4().hex[:12]}"


def ip_subnet(ip: str) -> str:
    parts = ip.split(".")
    if len(parts) != 4:
        return ip
    return ".".join(parts[:3]) + ".0/24"


def jitter_geo(home_geo, km: float = 5.0):
    """Slightly perturb the home geo to simulate a real device."""
    if not home_geo:
        return None
    dx = random.uniform(-km, km) / 111.0
    dy = random.uniform(-km, km) / 111.0
    return (home_geo[0] + dx, home_geo[1] + dy)
