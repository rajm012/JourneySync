"""MongoDB async client."""
from motor.motor_asyncio import AsyncIOMotorClient

from app.core.config import settings

_client: AsyncIOMotorClient | None = None


def get_client() -> AsyncIOMotorClient:
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.MONGO_URL)
    return _client


def get_db():
    return get_client()[settings.MONGO_DB]


async def ensure_indexes() -> None:
    db = get_db()
    # timelines: one doc per customer
    await db.timelines.create_index("customer_id", unique=True)
    # events embedded; index on event_id and occurred_at for fast lookups
    await db.timelines.create_index("events.event_id")
    await db.timelines.create_index("events.occurred_at")
