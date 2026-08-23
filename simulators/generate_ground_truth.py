"""Generate the 100-customer ground-truth dataset.

Run once: python -m simulators.generate_ground_truth
Writes to data/ground_truth.json
"""
from __future__ import annotations
import json
import os
import random
import sys
import uuid
from pathlib import Path

from faker import Faker

fake = Faker("en_IN")
random.seed(42)
Faker.seed(42)


def gen_customer(idx: int) -> dict:
    name = fake.name()
    email = f"{name.lower().replace(' ', '.')}@example.com"
    phone = "+91" + "".join([str(random.randint(0, 9)) for _ in range(10)])
    loyalty = f"LC{idx:08d}"
    home_geo = (float(fake.latitude()), float(fake.longitude()))
    primary_device = f"d-{uuid.uuid4().hex[:12]}"
    secondaries = [f"d-{uuid.uuid4().hex[:12]}" for _ in range(random.randint(0, 2))]
    return {
        "customer_id": f"C{idx:04d}",
        "name": name,
        "email": email,
        "phone_e164": phone,
        "loyalty_card": loyalty,
        "home_geo": home_geo,
        "primary_device_fp": primary_device,
        "secondary_device_fps": secondaries,
    }


def main():
    out = Path(__file__).resolve().parents[1] / "data" / "ground_truth.json"
    out.parent.mkdir(exist_ok=True, parents=True)
    customers = [gen_customer(i) for i in range(1, 101)]
    with open(out, "w") as f:
        json.dump(customers, f, indent=2, default=str)
    print(f"wrote {len(customers)} customers to {out}")


if __name__ == "__main__":
    main()
