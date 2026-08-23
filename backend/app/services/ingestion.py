"""Ingestion service: validate, normalize, publish to Redis stream."""
from __future__ import annotations
import time
from datetime import datetime
import orjson

from app.core.config import settings
from app.core.redis_client import get_redis
from app.schemas.event import ChannelEvent, UnifiedEvent


def _to_jsonable(ev: ChannelEvent) -> dict:
    """ChannelEvent → dict with datetimes as ISO strings."""
    d = ev.model_dump()
    d["occurred_at"] = ev.occurred_at.isoformat()
    return d


# SET NX + XADD happen atomically so a retried POST with the same event_id
# (client timeout-and-retry, an at-least-once upstream queue, a re-run demo
# script) is acknowledged but never enters the stream — and therefore never
# gets resolved, stitched, or audited — twice.
_IDEMPOTENT_PUBLISH_SCRIPT = """
if redis.call('SET', KEYS[1], '1', 'EX', ARGV[1], 'NX') then
  return redis.call('XADD', KEYS[2], '*', 'event', ARGV[2], 'received_at_ms', ARGV[3])
end
return false
"""


async def publish_event(ev: ChannelEvent, received_at_ms: int | None = None) -> tuple[str | None, bool]:
    """Publish a single event to the raw stream, exactly once per event_id.

    Returns (stream_msg_id, is_duplicate). A duplicate returns (None, True)
    without touching the stream.
    """
    r = get_redis()
    ts = received_at_ms if received_at_ms is not None else now_ms()
    dedup_key = f"journeysync:event:{ev.event_id}"
    result = await r.eval(
        _IDEMPOTENT_PUBLISH_SCRIPT,
        2,
        dedup_key,
        settings.RAW_STREAM,
        settings.IDEMPOTENCY_TTL_SECONDS,
        orjson.dumps(_to_jsonable(ev)).decode(),
        str(ts),
    )
    if not result:
        return None, True
    msg_id = result.decode() if isinstance(result, bytes) else result
    return msg_id, False


def parse_event(raw: bytes | str) -> UnifiedEvent:
    """Parse a stored event back into a UnifiedEvent (resolved fields default)."""
    if isinstance(raw, bytes):
        raw = raw.decode()
    d = orjson.loads(raw)
    d["occurred_at"] = datetime.fromisoformat(d["occurred_at"])
    return UnifiedEvent(**d)


def now_ms() -> int:
    return int(time.time() * 1000)
