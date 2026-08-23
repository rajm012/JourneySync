"""Resolver worker — consumes events.raw, runs resolution, stitches to Mongo.

Run with: python -m app.workers.resolver_worker

ACK policy: only acknowledge after successful processing. Failures stay in the
pending list and are reclaimed via XAUTOCLAIM. After MAX_DELIVERIES, the
message is moved to a dead-letter stream so poison pills cannot block forever.
"""
from __future__ import annotations
import asyncio
import orjson
from datetime import datetime, timezone

from sqlalchemy import text

from app.core.config import settings
from app.core.db import SessionLocal
from app.core.redis_client import get_redis, ensure_consumer_group
from app.services.ingestion import parse_event, now_ms
from app.services.resolution import IdentityResolver
from app.services.stitching import Stitcher
from app.services.alerts import AlertEngine


CONSUMER_NAME = "resolver-1"
MAX_CONCURRENCY = 16
# Reclaim messages stuck in pending longer than this (ms).
CLAIM_IDLE_MS = 15_000
MAX_DELIVERIES = 5
DLQ_STREAM = "events.dlq"


def _field(fields: dict, key: str):
    raw = fields.get(key.encode() if isinstance(next(iter(fields), b""), bytes) else key)
    if raw is None:
        raw = fields.get(key) if isinstance(key, str) else None
        if raw is None and isinstance(key, str):
            raw = fields.get(key.encode())
    if isinstance(raw, bytes):
        return raw.decode()
    return raw


async def handle_message(raw_event: bytes | str, received_at_ms: int | None) -> None:
    ev = parse_event(raw_event)
    async with SessionLocal() as session:
        resolver = IdentityResolver(session)
        result = await resolver.resolve(ev)

        ev.customer_id = result.customer_id
        ev.confidence = result.confidence
        ev.match_method = result.method  # type: ignore[assignment]
        ev.match_status = result.match_status  # type: ignore[assignment]
        ev.resolved_at = datetime.now(timezone.utc)

        # Stitch matched + uncertain (tentative) timelines; skip conflicts (no customer).
        if ev.customer_id and ev.match_status != "conflict":
            stitcher = Stitcher()
            await stitcher.append(ev)

        # Alerts only for a real customer id
        if ev.customer_id:
            engine = AlertEngine(session)
            await engine.evaluate_for_event(
                customer_id=ev.customer_id,
                channel=ev.channel,
                event_type=ev.event_type,
                payload=ev.payload,
            )

        if received_at_ms is not None:
            latency = max(0.0, float(now_ms() - received_at_ms))
            await session.execute(
                text("""
                    INSERT INTO ingest_latency (event_id, latency_ms)
                    VALUES (:e, :ms)
                """),
                {"e": ev.event_id, "ms": latency},
            )
            await session.commit()

    r = get_redis()
    msg = {
        "event_id": ev.event_id,
        "customer_id": ev.customer_id,
        "channel": ev.channel,
        "event_type": ev.event_type,
        "confidence": ev.confidence,
        "match_status": ev.match_status,
        "occurred_at": ev.occurred_at.isoformat(),
    }
    await r.xadd(settings.RESOLVED_STREAM, {"event": orjson.dumps(msg).decode()})
    await r.publish(settings.RESOLVED_CHANNEL, orjson.dumps(msg).decode())


async def _delivery_count(r, msg_id) -> int:
    """Best-effort delivery count from XPENDING; default 1 if unknown."""
    try:
        mid = msg_id.decode() if isinstance(msg_id, bytes) else msg_id
        info = await r.xpending_range(
            settings.RAW_STREAM, settings.CONSUMER_GROUP, mid, mid, count=1
        )
        if info:
            entry = info[0]
            if isinstance(entry, dict):
                return int(entry.get("times_delivered") or entry.get(b"times_delivered") or 1)
            # redis-py may return a tuple-like structure
            if hasattr(entry, "get"):
                return int(entry.get("times_delivered", 1))
    except Exception:
        pass
    return 1


async def _dead_letter(r, msg_id, fields: dict, err: str) -> None:
    payload = {
        "msg_id": msg_id.decode() if isinstance(msg_id, bytes) else str(msg_id),
        "error": err,
        "fields": {
            (k.decode() if isinstance(k, bytes) else str(k)): (
                v.decode() if isinstance(v, bytes) else str(v)
            )
            for k, v in fields.items()
        },
    }
    await r.xadd(DLQ_STREAM, {"event": orjson.dumps(payload).decode()})
    await r.xack(settings.RAW_STREAM, settings.CONSUMER_GROUP, msg_id)
    print(f"[resolver_worker] dead-lettered {msg_id}: {err}")


async def _process_one(r, msg_id, fields: dict, sem: asyncio.Semaphore) -> None:
    async with sem:
        raw = fields.get(b"event") or fields.get("event")
        if raw is None:
            await r.xack(settings.RAW_STREAM, settings.CONSUMER_GROUP, msg_id)
            return
        received_raw = fields.get(b"received_at_ms") or fields.get("received_at_ms")
        received_at_ms = None
        if received_raw is not None:
            try:
                received_at_ms = int(
                    received_raw.decode() if isinstance(received_raw, bytes) else received_raw
                )
            except (TypeError, ValueError):
                received_at_ms = None
        try:
            await handle_message(raw, received_at_ms)
            await r.xack(settings.RAW_STREAM, settings.CONSUMER_GROUP, msg_id)
        except Exception as e:
            print(f"[resolver_worker] error on {msg_id}: {e!r}")
            deliveries = await _delivery_count(r, msg_id)
            if deliveries >= MAX_DELIVERIES:
                await _dead_letter(r, msg_id, fields, repr(e))
            # else: leave pending for XAUTOCLAIM retry — do NOT ack


async def _claim_stale(r) -> list:
    """Reclaim idle pending messages so failures are retried."""
    try:
        result = await r.xautoclaim(
            settings.RAW_STREAM,
            settings.CONSUMER_GROUP,
            CONSUMER_NAME,
            min_idle_time=CLAIM_IDLE_MS,
            start_id="0-0",
            count=50,
        )
        # redis-py: (next_id, [(id, fields), ...], deleted_ids?)
        if isinstance(result, (list, tuple)) and len(result) >= 2:
            return result[1] or []
    except Exception as e:
        print(f"[resolver_worker] xautoclaim error: {e!r}")
    return []


async def main() -> None:
    r = get_redis()
    await ensure_consumer_group(settings.RAW_STREAM, settings.CONSUMER_GROUP)
    sem = asyncio.Semaphore(MAX_CONCURRENCY)

    print(
        f"[resolver_worker] consuming from {settings.RAW_STREAM} as {CONSUMER_NAME} "
        f"(concurrency={MAX_CONCURRENCY}, claim_idle_ms={CLAIM_IDLE_MS})"
    )
    while True:
        try:
            claimed = await _claim_stale(r)
            msgs = await r.xreadgroup(
                settings.CONSUMER_GROUP,
                CONSUMER_NAME,
                {settings.RAW_STREAM: ">"},
                count=100,
                block=1000,
            )
            tasks = []
            for msg_id, fields in claimed:
                tasks.append(_process_one(r, msg_id, fields, sem))
            if msgs:
                for _stream, entries in msgs:
                    for msg_id, fields in entries:
                        tasks.append(_process_one(r, msg_id, fields, sem))
            if tasks:
                await asyncio.gather(*tasks)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"[resolver_worker] loop error: {e!r}")
            await asyncio.sleep(0.5)


if __name__ == "__main__":
    asyncio.run(main())
