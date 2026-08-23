"""Redis async client + helpers."""
import redis.asyncio as redis_async

from app.core.config import settings

_redis: redis_async.Redis | None = None


def get_redis() -> redis_async.Redis:
    global _redis
    if _redis is None:
        _redis = redis_async.from_url(settings.REDIS_URL, decode_responses=False)
    return _redis


async def ensure_consumer_group(stream: str, group: str) -> None:
    r = get_redis()
    try:
        await r.xgroup_create(stream, group, id="0", mkstream=True)
    except redis_async.ResponseError as e:
        if "BUSYGROUP" not in str(e):
            raise
