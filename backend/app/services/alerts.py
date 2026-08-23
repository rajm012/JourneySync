"""Alert engine — rule-based for the MVP.

R1: ≥ 3 failed_login in 24h
R2: ≥ 2 payment_failures in 7d
R3: deep funnel drop + call_center contact within 30 min (no payment_success)
R4: 'cancel' / 'close account' / 'frustrated' keyword in call transcript
"""
from __future__ import annotations
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.mongo import get_db
from app.core.redis_client import get_redis


class AlertEngine:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.db_mongo = get_db()

    async def evaluate_for_event(self, customer_id: str, channel: str, event_type: str, payload: dict) -> list[dict]:
        """Return any alerts triggered by this new event."""
        if not customer_id:
            return []

        alerts: list[dict] = []
        now = datetime.now(timezone.utc)

        # R1: failed login burst
        if event_type == "login_failed":
            count = await self._count_events(customer_id, "login_failed", since=now - timedelta(hours=24))
            if count >= 3:
                alerts.append(self._make_alert(
                    customer_id, "R1_failed_login_burst", "high",
                    "Repeated failed logins (24h)",
                    f"{count} failed logins in the last 24 hours",
                    "Trigger password-reset nudge + retention outreach within 1h",
                ))

        # R2: payment failures
        if event_type == "payment_failed":
            count = await self._count_events(customer_id, "payment_failed", since=now - timedelta(days=7))
            if count >= 2:
                alerts.append(self._make_alert(
                    customer_id, "R2_payment_fail_then_call", "high",
                    "Repeated payment failures (7d)",
                    f"{count} payment failures in the last 7 days",
                    "Assign to retention desk; offer payment-plan callback",
                ))

        # R3: cart activity then call, without completing payment in the window
        if channel == "call_center" and event_type in (
            "call_connected", "call_initiated", "agent_handoff",
        ):
            since = now - timedelta(minutes=30)
            carts = await self._count_events(customer_id, "add_to_cart", since=since)
            paid = await self._count_events(customer_id, "payment_success", since=since)
            if carts > 0 and paid == 0:
                alerts.append(self._make_alert(
                    customer_id, "R3_funnel_drop_then_call", "medium",
                    "Funnel drop followed by call center contact",
                    "Customer added to cart, did not pay, then called within 30 min",
                    "Agent to call back with cart context within 5 min",
                ))

        # R4: churn keyword — only on transcript events (not every payload with text)
        text_blob = (
            (payload or {}).get("transcript")
            or (payload or {}).get("text")
            or ""
        )
        keywords = ["cancel", "close account", "frustrated", "disappointed", "unhappy"]
        if event_type in ("transcript", "transcript_segment") and text_blob:
            hit = [k for k in keywords if k in text_blob.lower()]
            if hit:
                alerts.append(self._make_alert(
                    customer_id, "R4_churn_keyword", "critical",
                    "Churn keyword detected in call transcript",
                    f"Transcript contains: {', '.join(hit)}",
                    "Escalate to senior agent; preserve full timeline for review",
                ))

        # Persist with open-alert dedup (one open alert per customer+rule)
        for a in alerts:
            await self._upsert_open_alert(a)

        return alerts

    async def _upsert_open_alert(self, a: dict) -> None:
        existing = (
            await self.session.execute(
                text("""
                    SELECT id FROM alerts
                    WHERE customer_id=:c AND rule_id=:r AND status='open'
                    LIMIT 1
                """),
                {"c": a["customer_id"], "r": a["rule_id"]},
            )
        ).first()
        if existing:
            await self.session.execute(
                text("""
                    UPDATE alerts
                    SET body=:body, title=:title, suggested_action=:action, severity=:sev
                    WHERE id=:id
                """),
                {
                    "id": existing[0],
                    "body": a["body"],
                    "title": a["title"],
                    "action": a["suggested_action"],
                    "sev": a["severity"],
                },
            )
            await self.session.commit()
            a["id"] = existing[0]
        else:
            try:
                await self.session.execute(
                    text("""
                        INSERT INTO alerts (id, customer_id, rule_id, severity, title, body, suggested_action)
                        VALUES (:id, :customer_id, :rule_id, :severity, :title, :body, :suggested_action)
                    """),
                    a,
                )
                await self.session.commit()
            except Exception:
                await self.session.rollback()
                # Race: another worker inserted the open alert — update that one
                row = (
                    await self.session.execute(
                        text("""
                            SELECT id FROM alerts
                            WHERE customer_id=:c AND rule_id=:r AND status='open'
                            LIMIT 1
                        """),
                        {"c": a["customer_id"], "r": a["rule_id"]},
                    )
                ).first()
                if row:
                    a["id"] = row[0]
                    await self.session.execute(
                        text("""
                            UPDATE alerts
                            SET body=:body, title=:title, suggested_action=:action, severity=:sev
                            WHERE id=:id
                        """),
                        {
                            "id": row[0],
                            "body": a["body"],
                            "title": a["title"],
                            "action": a["suggested_action"],
                            "sev": a["severity"],
                        },
                    )
                    await self.session.commit()

        import orjson
        r = get_redis()
        await r.publish(settings.ALERTS_CHANNEL, orjson.dumps(a))

    async def _count_events(self, customer_id: str, event_type: str, since: datetime) -> int:
        pipeline = [
            {"$match": {"customer_id": customer_id}},
            {"$unwind": "$events"},
            {"$match": {"events.event_type": event_type, "events.occurred_at": {"$gte": since}}},
            {"$count": "n"},
        ]
        async for doc in self.db_mongo.timelines.aggregate(pipeline):
            return doc["n"]
        return 0

    def _make_alert(self, customer_id, rule_id, severity, title, body, action) -> dict:
        return {
            "id": f"AL-{uuid.uuid4().hex[:8]}",
            "customer_id": customer_id,
            "rule_id": rule_id,
            "severity": severity,
            "title": title,
            "body": body,
            "suggested_action": action,
        }

    async def list_alerts(self, status: str = "open", limit: int = 50) -> list[dict]:
        rows = (await self.session.execute(
            text("""
                SELECT id, customer_id, rule_id, severity, title, body, suggested_action,
                       status, created_at, acknowledged_at, resolved_at
                FROM alerts
                WHERE status = :s
                ORDER BY
                    CASE severity
                        WHEN 'critical' THEN 0
                        WHEN 'high' THEN 1
                        WHEN 'medium' THEN 2
                        ELSE 3
                    END,
                    created_at DESC
                LIMIT :l
            """),
            {"s": status, "l": limit},
        )).all()
        cols = ["id", "customer_id", "rule_id", "severity", "title", "body",
                "suggested_action", "status", "created_at", "acknowledged_at", "resolved_at"]
        return [dict(zip(cols, r)) for r in rows]

    async def acknowledge(self, alert_id: str) -> bool:
        result = await self.session.execute(
            text("""UPDATE alerts SET status='acknowledged', acknowledged_at=NOW()
                    WHERE id=:id RETURNING id"""),
            {"id": alert_id},
        )
        await self.session.commit()
        return result.first() is not None
