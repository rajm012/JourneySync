"""Seed identity graph from the rich synthetic customer dataset."""
from __future__ import annotations
import hashlib
import json
import os
import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from pymongo import UpdateOne
from app.core.mongo import get_db


def resolve_customers_path(path: str | Path | None = None) -> Path:
    if path:
        return Path(path)
    env = os.environ.get("CUSTOMERS_PATH")
    if env:
        return Path(env)
    here = Path(__file__).resolve()
    candidates = [
        Path("/app/data/customers.json"),                 # Docker
        here.parents[3] / "data" / "customers.json",      # local: Others/data
        here.parents[2] / "data" / "customers.json",
    ]
    for c in candidates:
        if c.is_file():
            return c
    raise FileNotFoundError(
        "customers.json not found. Set CUSTOMERS_PATH or place it under Others/data/."
    )


async def seed_customers(session: AsyncSession, path: str | Path | None = None) -> dict:
    """Upsert customers + identifiers + device signals into Postgres.

    Without this, the resolver invents random Cxxxxx IDs and the demo cannot
    reliably open /dashboard/customers/C0001 (Asha).
    """
    p = resolve_customers_path(path)
    customers = json.loads(p.read_text())
    inserted = 0
    for c in customers:
        geo = c.get("home_geo") or [None, None]
        await session.execute(
            text("""
                INSERT INTO customers (
                    customer_id, name, email, phone_e164, loyalty_card,
                    home_geo_lat, home_geo_lon
                ) VALUES (
                    :cid, :name, :email, :phone, :loyalty, :lat, :lon
                )
                ON CONFLICT (customer_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    email = EXCLUDED.email,
                    phone_e164 = EXCLUDED.phone_e164,
                    loyalty_card = EXCLUDED.loyalty_card,
                    home_geo_lat = EXCLUDED.home_geo_lat,
                    home_geo_lon = EXCLUDED.home_geo_lon,
                    updated_at = NOW()
            """),
            {
                "cid": c["customer_id"],
                "name": c.get("name"),
                "email": c.get("email"),
                "phone": c.get("phone_e164"),
                "loyalty": c.get("loyalty_card"),
                "lat": geo[0] if len(geo) > 0 else None,
                "lon": geo[1] if len(geo) > 1 else None,
            },
        )
        for id_type, value in [
            ("user_id", c["customer_id"]),
            ("email", c.get("email")),
            ("phone_e164", c.get("phone_e164")),
            ("loyalty_card", c.get("loyalty_card")),
        ]:
            if value:
                await session.execute(
                    text("""
                        INSERT INTO identifiers (customer_id, id_type, id_value)
                        VALUES (:c, :t, :v)
                        ON CONFLICT (id_type, id_value) DO UPDATE
                          SET customer_id = EXCLUDED.customer_id
                    """),
                    {"c": c["customer_id"], "t": id_type, "v": value},
                )
        fps = [c.get("primary_device_fp"), c.get("mobile_device_fp"), c.get("tablet_device_fp")]
        fps += c.get("secondary_device_fps") or []
        for fp in fps:
            if not fp:
                continue
            await session.execute(
                text("""
                    INSERT INTO signals (customer_id, signal_type, signal_value, last_seen)
                    VALUES (:c, 'device_fp', :v, NOW())
                    ON CONFLICT (customer_id, signal_type, signal_value)
                    DO UPDATE SET last_seen = NOW()
                """),
                {"c": c["customer_id"], "v": fp},
            )
        inserted += 1
    await session.commit()
    activity = await seed_demo_activity(session, p.parent / "events.json")
    return {"seeded": inserted, "path": str(p), **activity}


async def seed_demo_activity(session: AsyncSession, events_path: Path) -> dict:
    """Idempotently load historical demo events plus realistic review/alert samples."""
    if not events_path.is_file():
        return {"activity_seeded": 0}
    events = json.loads(events_path.read_text())
    grouped: dict[str, list[dict]] = {}
    for e in events:
        cid = e.get("customer_id_hint")
        if not cid:
            continue
        occurred = datetime.fromisoformat(e["occurred_at"].replace("Z", "+00:00"))
        grouped.setdefault(cid, []).append({
            "event_id": e["event_id"], "channel": e["channel"], "event_type": e["event_type"],
            "occurred_at": occurred, "confidence": 0.96, "match_method": "seeded_deterministic",
            "match_status": "matched", "payload": e.get("payload") or {},
        })
    db = get_db()
    operations = []
    for cid, customer_events in grouped.items():
        customer_events.sort(key=lambda x: x["occurred_at"])
        operations.append(UpdateOne(
            {"customer_id": cid},
            {"$set": {"customer_id": cid, "events": customer_events, "total_events": len(customer_events),
                      "channels_touched": sorted({x["channel"] for x in customer_events}),
                      "first_seen": customer_events[0]["occurred_at"], "last_seen": customer_events[-1]["occurred_at"]}},
            upsert=True,
        ))
    if operations:
        await db.timelines.bulk_write(operations, ordered=False)

    # A useful-sized, varied manual review queue. Ids are deterministic hashes
    # of the index (not random) so reruns stay idempotent, but still read like
    # real event ids rather than "seed-review-000".
    review_reasons = [
        "device seen for the first time on this account",
        "IP subnet matched a known device but geo drifted > 200km",
        "two strong identifiers (email vs loyalty card) pointed at different customers",
        "confidence sat just under the auto-link threshold",
        "recent signal window (30m) had no overlapping device or subnet",
        "a stale device fingerprint reappeared after 90+ days",
    ]
    statuses = [("uncertain", "probabilistic_ip_only"), ("unresolved", "insufficient_signals"), ("conflict", "conflict_guard")]
    for i in range(36):
        status, method = statuses[i % len(statuses)]
        reason = review_reasons[(i * 3) % len(review_reasons)]
        base_conf = {"uncertain": 0.38, "unresolved": 0.16, "conflict": 0.09}[status]
        confidence = round(base_conf + (i % 7) * 0.02, 2)
        cid = f"C{(i % 30) + 2:04d}" if status != "unresolved" else None
        event_id = f"ev-{hashlib.md5(f'review-{i}'.encode()).hexdigest()[:10]}"
        await session.execute(text("""
            INSERT INTO match_audit (event_id, customer_id, confidence, method, signals_json, match_status, decided_at)
            SELECT :event, :cid, :confidence, :method, CAST(:signals AS jsonb), :status, NOW() - (:hours * INTERVAL '1 hour')
            WHERE NOT EXISTS (SELECT 1 FROM match_audit WHERE event_id=:event)
        """), {"event": event_id, "cid": cid, "confidence": confidence,
                 "method": method, "status": status, "hours": i * 3 + 1,
                 "signals": json.dumps({"device_fp": f"d-unseen{i:02x}{i:03d}", "ip_subnet": f"10.{(i * 13) % 255}.{i % 40}.0/24", "reason": reason})})

    # Alert copy — enough distinct scenarios per severity that repeats aren't
    # verbatim duplicates. Each entry is (rule, severity, title, body(i), action).
    queues = ["billing", "service", "fraud", "retention", "card services", "loans"]
    products = ["travel card", "rewards card", "fixed deposit", "personal loan", "premium checking"]
    channel_pairs = [("app", "call center"), ("web", "branch"), ("app", "branch"), ("web", "call center")]
    stuck_reasons = [
        "a failed OTP verification", "a profile locked after 3 attempts",
        "an address-change request stuck in review", "a disputed transaction still pending",
    ]
    keyword_sets = [["cancel"], ["close account"], ["frustrated", "cancel"], ["unhappy"], ["disappointed", "close account"]]

    def pick(pool, i, salt=0):
        return pool[(i * 7 + salt * 3 + 1) % len(pool)]

    alert_scenarios = [
        ("R3_funnel_drop_then_call", "medium", "Checkout abandoned before support call",
         lambda i: f"Customer called {pick(queues, i)} {12 + (i * 5) % 24} minutes after abandoning a {pick(products, i, 1)} application.",
         "Open the incomplete application and continue from the last verified step."),
        ("R5_repeat_service_contact", "medium", "Third service contact this week",
         lambda i: f"Card-delivery status was queried across {pick(channel_pairs, i)[0]} and {pick(channel_pairs, i)[1]} {2 + i % 3} times this week.",
         "Assign one case owner and send a proactive delivery update."),
        ("R6_digital_to_assisted", "medium", "Digital servicing moved to an agent",
         lambda i: f"A self-service attempt failed twice in the app because of {pick(stuck_reasons, i, 2)} before agent handoff.",
         "Resolve the underlying block and confirm completion on the preferred channel."),
        ("R7_dispute_followup", "medium", "Dispute case needs follow-up",
         lambda i: f"Customer revisited the dispute page {3 + i % 5} days after a branch filing with no status update.",
         "Review dispute SLA and send a case-status notification today."),
        ("R8_branch_wait_abandoned", "medium", "Branch visit ended without service",
         lambda i: f"Customer queued for {15 + (i * 4) % 30} minutes at a branch and left before being served.",
         "Offer a priority callback or a scheduled branch slot."),
        ("R9_ivr_loop", "medium", "Repeated IVR menu loops without resolution",
         lambda i: f"Customer cycled through the {pick(queues, i, 3)} IVR menu {3 + i % 3} times without reaching an agent.",
         "Route directly to a senior agent on next contact; skip the IVR."),
        ("R10_card_delivery_delay", "medium", "Card delivery queried twice",
         lambda i: f"Delivery status for a {pick(products, i, 2)} was queried twice, {4 + i % 6} days after dispatch.",
         "Confirm courier status and send a proactive ETA update."),
        ("R11_new_device_signin", "high", "Sign-in from an unrecognized device",
         lambda i: f"A successful sign-in occurred from a device never seen on this account, {1 + i % 4} days after the last known device.",
         "Confirm the device with the customer via a known channel."),
        ("R12_high_value_drop", "high", "High-value cart abandoned without follow-up",
         lambda i: f"A {pick(products, i, 4)} cart worth a high-value tier was abandoned with no follow-up contact in {6 + i % 18} hours.",
         "Prioritise a callback before the standard retention window closes."),
        ("R13_repeated_escalation", "critical", "Customer escalated twice in 48 hours",
         lambda i: f"Customer was transferred to a senior agent on {pick(channel_pairs, i, 1)[1]} twice within 48 hours.",
         "Assign a single senior owner; do not re-route to a new agent."),
        ("R4_churn_keyword", "critical", "Account closure intent detected",
         lambda i: f"Transcript in the {pick(queues, i, 5)} queue contains: {', '.join(pick(keyword_sets, i))}.",
         "Escalate to a senior retention specialist with full journey context."),
    ]
    for i in range(30):
        rule, sev, title, body_fn, action = alert_scenarios[i % len(alert_scenarios)]
        cid = f"C{(i % 40) + 2:04d}"; aid = f"AL-SEED-{i:03d}"
        await session.execute(text("""
            INSERT INTO alerts (id, customer_id, rule_id, severity, title, body, suggested_action, created_at)
            VALUES (:id,:cid,:rule,:sev,:title,:body,:action,NOW()-(:hours * INTERVAL '1 hour'))
            ON CONFLICT (id) DO UPDATE SET
                customer_id=EXCLUDED.customer_id, rule_id=EXCLUDED.rule_id, severity=EXCLUDED.severity,
                title=EXCLUDED.title, body=EXCLUDED.body, suggested_action=EXCLUDED.suggested_action
        """), {"id":aid,"cid":cid,"rule":f"{rule}_{i}","sev":sev,"title":title,"body":body_fn(i),"action":action,"hours":i*2+1})
    await session.commit()
    return {"activity_seeded": len(events), "timelines_seeded": len(grouped), "review_samples": 36, "alert_samples": 30}
