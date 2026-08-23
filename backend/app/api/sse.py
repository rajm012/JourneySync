"""SSE: server-push live events and alerts to the dashboard."""
from __future__ import annotations
import asyncio
import json
import orjson
from fastapi import APIRouter, Request
from sse_starlette.sse import EventSourceResponse

from app.core.redis_client import get_redis
from app.core.config import settings


router = APIRouter(prefix="/api", tags=["stream"])


@router.get("/stream")
async def stream(request: Request):
    """SSE channel pushing live resolved events and alerts."""
    queue: asyncio.Queue = asyncio.Queue()

    async def listen():
        r = get_redis()
        ps = r.pubsub()
        await ps.subscribe(settings.RESOLVED_CHANNEL, settings.ALERTS_CHANNEL)
        try:
            async for msg in ps.listen():
                if msg.get("type") != "message":
                    continue
                channel = msg["channel"].decode() if isinstance(msg["channel"], bytes) else msg["channel"]
                data = msg["data"]
                if isinstance(data, bytes):
                    data = data.decode()
                payload = {"channel": channel, "data": orjson.loads(data)}
                await queue.put(payload)
        except asyncio.CancelledError:
            pass
        finally:
            try:
                await ps.unsubscribe()
                await ps.close()
            except Exception:
                pass

    task = asyncio.create_task(listen())

    async def event_gen():
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    payload = await asyncio.wait_for(queue.get(), timeout=15.0)
                    yield {"event": "message", "data": json.dumps(payload, default=str)}
                except asyncio.TimeoutError:
                    # heartbeat so the connection doesn't die
                    yield {"event": "ping", "data": "{}"}
        finally:
            task.cancel()

    return EventSourceResponse(event_gen())
