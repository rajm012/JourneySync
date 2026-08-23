"""Metrics service: precision, recall, latency."""
from __future__ import annotations
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.redis_client import get_redis


ACCURACY_KEY = "metrics:accuracy"


def _load_customers() -> list[dict]:
    env = os.environ.get("CUSTOMERS_PATH") or os.environ.get("GROUND_TRUTH")
    candidates = []
    if env:
        candidates.append(Path(env))
    candidates.extend([
        Path("/app/data/customers.json"),
        Path("/app/data/ground_truth.json"),
        Path(__file__).resolve().parents[3] / "data" / "customers.json",
        Path(__file__).resolve().parents[3] / "data" / "ground_truth.json",
    ])
    for p in candidates:
        if p.is_file():
            return json.loads(p.read_text())
    return []


def build_gt_lookups(ground_truth: list[dict]) -> tuple[dict[tuple[str, str], str], set[str]]:
    """Map strong identifiers → expected customer_id."""
    gt: dict[tuple[str, str], str] = {}
    ids: set[str] = set()
    for c in ground_truth:
        cid = c["customer_id"]
        ids.add(cid)
        if c.get("email"):
            gt[("email", c["email"].lower())] = cid
        if c.get("phone_e164"):
            gt[("phone_e164", c["phone_e164"])] = cid
        if c.get("loyalty_card"):
            gt[("loyalty_card", c["loyalty_card"])] = cid
        if c.get("customer_id"):
            gt[("user_id", c["customer_id"])] = cid
        if c.get("primary_device_fp"):
            gt[("device_fp", c["primary_device_fp"])] = cid
        if c.get("mobile_device_fp"):
            gt[("device_fp", c["mobile_device_fp"])] = cid
        for d in c.get("secondary_device_fps", []) or []:
            gt[("device_fp", d)] = cid
    return gt, ids


class MetricsService:
    def __init__(self, session: AsyncSession):
        self.session = session

    async def precision_recall(self, ground_truth: list[dict] | None = None) -> dict:
        """Score recent match_audit rows against the seeded customer catalog.

        For each audit row we recover the expected customer via identifiers
        linked to the resolved customer_id, then check the resolved id matches
        the catalog entry for those identifiers. Deterministic matches against
        seeded customers are the primary precision signal for the live strip.
        """
        gt_list = ground_truth if ground_truth is not None else _load_customers()
        gt_lookup, gt_ids = build_gt_lookups(gt_list)

        rows = (await self.session.execute(text("""
            SELECT ma.customer_id, ma.method, ma.match_status, ma.confidence,
                   ma.signals_json
            FROM match_audit ma
            WHERE ma.decided_at >= NOW() - INTERVAL '24 hours'
            ORDER BY ma.decided_at DESC
            LIMIT 5000
        """))).all()

        # Also pull identifier map for resolved customers
        id_rows = (await self.session.execute(text("""
            SELECT customer_id, id_type, id_value FROM identifiers
        """))).all()
        by_customer: dict[str, list[tuple[str, str]]] = {}
        for cid, id_type, id_value in id_rows:
            by_customer.setdefault(cid, []).append((id_type, id_value))

        tp = 0
        scored = 0
        uncertain = 0
        unresolved = 0
        conflict = 0
        touched: set[str] = set()

        for customer_id, method, status, confidence, signals in rows:
            if status == "uncertain":
                uncertain += 1
            elif status == "unresolved":
                unresolved += 1
            elif status == "conflict":
                conflict += 1

            if not customer_id:
                continue
            touched.add(customer_id)

            # Infer expected GT id from identifiers on the resolved customer
            expected = None
            for id_type, id_value in by_customer.get(customer_id, []):
                key = (id_type, id_value.lower() if id_type == "email" else id_value)
                if key in gt_lookup:
                    expected = gt_lookup[key]
                    break
            # Fallback: signals_json may carry email/phone/device
            if expected is None and isinstance(signals, dict):
                for k in ("email", "phone_e164", "loyalty_card", "user_id", "device_fp"):
                    v = signals.get(k)
                    if not v or not isinstance(v, str):
                        continue
                    key = (k, v.lower() if k == "email" else v)
                    if key in gt_lookup:
                        expected = gt_lookup[key]
                        break

            if expected is None:
                # Anonymous / new_identity outside catalog — skip precision denom
                continue

            scored += 1
            if customer_id == expected and status in ("matched", "uncertain"):
                # uncertain still linked to the right person counts as a true positive
                # for "did we find the right customer", though flagged for review
                tp += 1
            elif customer_id == expected:
                tp += 1

        precision = round(tp / scored, 4) if scored else 0.0
        # Recall: share of catalog customers that received ≥1 resolution in window
        recall = round(len(touched & gt_ids) / len(gt_ids), 4) if gt_ids else 0.0

        return {
            "precision": precision,
            "recall": recall,
            "scored": scored,
            "true_positives": tp,
            "uncertain": uncertain,
            "unresolved": unresolved,
            "conflict": conflict,
            "catalog_size": len(gt_ids),
            "customers_touched": len(touched & gt_ids),
            "measured_at": datetime.now(timezone.utc).isoformat(),
            "source": "live_audit",
        }

    async def save_accuracy(self, payload: dict) -> None:
        r = get_redis()
        await r.set(ACCURACY_KEY, json.dumps(payload))

    async def load_accuracy(self) -> dict | None:
        r = get_redis()
        raw = await r.get(ACCURACY_KEY)
        if not raw:
            return None
        if isinstance(raw, bytes):
            raw = raw.decode()
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            return None

    async def latency(self, since_minutes: int = 5) -> dict:
        """Pull latency samples from ingest_latency table; compute p50, p95, p99."""
        since = datetime.now(timezone.utc) - timedelta(minutes=since_minutes)
        rows = (await self.session.execute(text("""
            SELECT latency_ms FROM ingest_latency
            WHERE recorded_at >= :since
              AND latency_ms > 0
            ORDER BY latency_ms ASC
        """), {"since": since})).all()
        samples = [float(r[0]) for r in rows]
        if not samples:
            return {"samples": 0, "p50": 0, "p95": 0, "p99": 0, "avg": 0, "max": 0}

        def pct(p: float) -> float:
            if not samples:
                return 0.0
            k = max(0, min(len(samples) - 1, int(round((p / 100) * (len(samples) - 1)))))
            return round(samples[k], 1)

        return {
            "samples": len(samples),
            "p50": pct(50),
            "p95": pct(95),
            "p99": pct(99),
            "avg": round(sum(samples) / len(samples), 1),
            "max": round(samples[-1], 1),
        }

    async def totals(self) -> dict:
        rows = (await self.session.execute(text("""
            SELECT
              (SELECT COUNT(*) FROM customers) AS customers,
              (SELECT COUNT(*) FROM match_audit) AS resolutions,
              (SELECT COUNT(*) FROM match_audit WHERE match_status IN ('uncertain', 'conflict')) AS uncertain,
              (SELECT COUNT(*) FROM alerts) AS alerts,
              (SELECT COUNT(*) FROM alerts WHERE status='open') AS open_alerts
        """))).first()
        return {
            "customers": rows[0],
            "resolutions": rows[1],
            "uncertain": rows[2],
            "alerts": rows[3],
            "open_alerts": rows[4],
        }
