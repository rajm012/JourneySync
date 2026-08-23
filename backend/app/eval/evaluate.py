"""Evaluation: precision/recall against the seeded customer catalog.

Usage:
  python -m app.eval.evaluate
"""
from __future__ import annotations
import asyncio
import json
import os
import random
from datetime import datetime, timedelta, timezone
from pathlib import Path

from app.core.db import SessionLocal
from app.schemas.event import ChannelEvent, UnifiedEvent, IdentityHints, BehavioralSignals
from app.services.resolution import IdentityResolver
from app.services.stitching import Stitcher
from app.services.metrics import MetricsService, build_gt_lookups
from app.services.seed import seed_customers, resolve_customers_path


ROOT = Path(__file__).resolve().parents[2]


async def load_customers(path: str | None = None) -> list[dict]:
    p = Path(path) if path else resolve_customers_path()
    return json.loads(p.read_text())


def make_event_for_customer(c: dict, channel: str, anon: bool = False) -> ChannelEvent:
    idh = IdentityHints()
    sig = BehavioralSignals()
    expected = c["customer_id"]
    if not anon:
        which = random.choice(["email", "phone", "loyalty", "user_id", "all"])
        if which in ("email", "all"):
            idh.email = c["email"]
        if which in ("phone", "all"):
            idh.phone_e164 = c["phone_e164"]
        if which in ("loyalty", "all"):
            idh.loyalty_card = c.get("loyalty_card")
        if which in ("user_id", "all"):
            idh.user_id = c["customer_id"]

    sig.device_fp = c.get("primary_device_fp") or c.get("mobile_device_fp")
    sig.ip = f"{random.randint(1,254)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}"
    sig.ip_subnet = ".".join(sig.ip.split(".")[:3]) + ".0/24"
    geo = c.get("home_geo")
    if geo:
        sig.geo = tuple(geo)  # type: ignore[assignment]

    etype = random.choice([
        "page_view", "product_view", "add_to_cart", "payment_attempt", "payment_success",
        "app_open", "call_connected", "login_failed",
    ])

    ev = ChannelEvent(
        channel=channel,  # type: ignore[arg-type]
        event_type=etype,
        occurred_at=datetime.now(timezone.utc) - timedelta(seconds=random.randint(0, 60)),
        identity=idh,
        signals=sig,
        payload={"_expected_customer_id": expected, "anon": anon},
    )
    return ev


def make_collision_event(c1: dict, c2: dict) -> ChannelEvent:
    """c1's email on c2's device — deterministic should win → c1."""
    idh = IdentityHints(email=c1["email"])
    sig = BehavioralSignals(
        device_fp=c2.get("primary_device_fp"),
        ip=f"{random.randint(1,254)}.{random.randint(0,255)}.{random.randint(0,255)}.{random.randint(1,254)}",
    )
    sig.ip_subnet = ".".join(sig.ip.split(".")[:3]) + ".0/24"
    return ChannelEvent(
        channel="web",
        event_type="page_view",
        occurred_at=datetime.now(timezone.utc),
        identity=idh,
        signals=sig,
        payload={"_expected_customer_id": c1["customer_id"], "collision": True},
    )


async def run_resolution_inline(events: list[ChannelEvent]) -> list[UnifiedEvent]:
    resolved: list[UnifiedEvent] = []
    async with SessionLocal() as session:
        resolver = IdentityResolver(session)
        stitcher = Stitcher()
        for ev in events:
            uev = UnifiedEvent(**ev.model_dump())
            r = await resolver.resolve(uev)
            uev.customer_id = r.customer_id
            uev.confidence = r.confidence
            uev.match_method = r.method  # type: ignore[assignment]
            uev.match_status = r.match_status  # type: ignore[assignment]
            uev.resolved_at = datetime.now(timezone.utc)
            await stitcher.append(uev)
            resolved.append(uev)
    return resolved


async def main():
    # Prefer rich customers.json (seeded demo catalog)
    path = os.environ.get("CUSTOMERS_PATH") or os.environ.get("GROUND_TRUTH")
    print(f"[eval] loading customers from {path or 'auto'}")
    gt = await load_customers(path)
    print(f"[eval] {len(gt)} customers")

    async with SessionLocal() as session:
        seeded = await seed_customers(session)
        print(f"[eval] seed → {seeded}")

    events: list[ChannelEvent] = []
    for c in gt:
        for _ in range(4):
            events.append(make_event_for_customer(
                c, random.choice(["web", "mobile_app", "call_center"]), anon=False,
            ))
        events.append(make_event_for_customer(c, "web", anon=True))

    if len(gt) >= 5:
        pool = gt[: min(30, len(gt))]
        for _ in range(20):
            c1, c2 = random.sample(pool, 2)
            events.append(make_collision_event(c1, c2))

    print(f"[eval] generated {len(events)} events, running resolver...")
    resolved = await run_resolution_inline(events)

    gt_lookup, gt_ids = build_gt_lookups(gt)
    correct = 0
    scored = 0
    collision_total = 0
    collision_quarantined = 0
    collision_wrong = 0
    for ev in resolved:
        expected = (ev.payload or {}).get("_expected_customer_id")
        is_collision = bool((ev.payload or {}).get("collision"))
        if is_collision:
            collision_total += 1
            if ev.match_status == "conflict":
                collision_quarantined += 1
            elif ev.customer_id and expected and ev.customer_id != expected:
                collision_wrong += 1
        if not expected or not ev.customer_id:
            continue
        scored += 1
        if ev.customer_id == expected:
            correct += 1

    precision = correct / scored if scored else 0.0
    touched = {ev.customer_id for ev in resolved if ev.customer_id}
    recall = len(touched & gt_ids) / len(gt_ids) if gt_ids else 0.0

    print(f"[eval] precision: {correct}/{scored} = {precision:.4f}")
    print(f"[eval] recall:    {len(touched & gt_ids)}/{len(gt_ids)} = {recall:.4f}")
    if collision_total:
        quarantine_rate = collision_quarantined / collision_total
        print(
            f"[eval] collision quarantine rate: {collision_quarantined}/{collision_total} "
            f"= {quarantine_rate:.4f} (silently wrong: {collision_wrong})"
        )

    payload = {
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "scored": scored,
        "true_positives": correct,
        "collision_total": collision_total,
        "collision_quarantined": collision_quarantined,
        "collision_wrong": collision_wrong,
        "catalog_size": len(gt_ids),
        "customers_touched": len(touched & gt_ids),
        "measured_at": datetime.now(timezone.utc).isoformat(),
        "source": "eval_harness",
    }
    async with SessionLocal() as session:
        m = MetricsService(session)
        await m.save_accuracy(payload)
        # Also refresh live audit view for comparison
        live = await m.precision_recall(gt)
        print(f"[eval] live_audit precision={live['precision']} recall={live['recall']}")

    print("[eval] accuracy cached for /api/metrics")
    print("[eval] done.")

    from app.core.redis_client import get_redis
    await get_redis().aclose()


if __name__ == "__main__":
    asyncio.run(main())
