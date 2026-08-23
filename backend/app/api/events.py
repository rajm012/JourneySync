"""Ingest API: POST /events."""
from __future__ import annotations

from fastapi import APIRouter

from app.schemas.event import ChannelEvent
from app.services.ingestion import publish_event, now_ms


router = APIRouter(prefix="/api", tags=["events"])


@router.post("/events")
async def post_event(ev: ChannelEvent):
    """Ingest a single channel event, idempotently on event_id.

    E2E latency (ingest → resolve/persist) is recorded by the resolver worker
    using the received_at_ms stamped onto the Redis stream message. A retried
    POST with the same event_id is accepted but not re-ingested.
    """
    received_at = now_ms()
    msg_id, duplicate = await publish_event(ev, received_at_ms=received_at)
    return {
        "event_id": ev.event_id,
        "stream_msg_id": msg_id,
        "received_at_ms": received_at,
        "duplicate": duplicate,
    }


@router.post("/events/bulk")
async def post_events_bulk(events: list[ChannelEvent]):
    """Bulk ingest (used by the burst-test button), idempotent per event_id."""
    ids = []
    accepted = 0
    duplicates = 0
    for ev in events:
        received_at = now_ms()
        msg_id, duplicate = await publish_event(ev, received_at_ms=received_at)
        if duplicate:
            duplicates += 1
        else:
            accepted += 1
        ids.append({
            "event_id": ev.event_id,
            "stream_msg_id": msg_id,
            "received_at_ms": received_at,
            "duplicate": duplicate,
        })
    return {"count": len(ids), "accepted": accepted, "duplicates": duplicates, "items": ids}
