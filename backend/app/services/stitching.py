"""Stitching service: append resolved events to per-customer Mongo timeline.

Timeline document shape:
{
  customer_id: "C0042",
  name: "Asha Iyer",
  known_identifiers: {email, phone, loyalty_card},
  total_events: 38,
  channels_touched: ["web", "mobile_app", "call_center"],
  first_seen: ISODate,
  last_seen:  ISODate,
  events: [
    {event_id, channel, event_type, occurred_at, confidence, match_status, payload, ...},
    ...
  ]
}
"""
from __future__ import annotations
from datetime import datetime
from typing import Any

from app.core.mongo import get_db
from app.schemas.event import UnifiedEvent


class Stitcher:
    def __init__(self):
        self.db = get_db()
        self.timelines = self.db.timelines

    async def append(self, ev: UnifiedEvent) -> None:
        if not ev.customer_id:
            return

        event_doc: dict[str, Any] = {
            "event_id": ev.event_id,
            "channel": ev.channel,
            "event_type": ev.event_type,
            "occurred_at": ev.occurred_at,
            "confidence": ev.confidence,
            "match_method": ev.match_method,
            "match_status": ev.match_status,
            "payload": ev.payload,
        }

        # Idempotent stitch: only push when this event_id is not already present.
        # Use $nin (not $ne) so a doc that already contains this event_id is skipped
        # even when other events exist in the array.
        await self.timelines.update_one(
            {"customer_id": ev.customer_id, "events.event_id": {"$nin": [ev.event_id]}},
            {
                "$setOnInsert": {"customer_id": ev.customer_id},
                "$min": {"first_seen": ev.occurred_at},
                "$max": {"last_seen": ev.occurred_at},
                "$addToSet": {"channels_touched": ev.channel},
                "$inc": {"total_events": 1},
                "$push": {"events": event_doc},
            },
            upsert=True,
        )

    async def get_timeline(self, customer_id: str, limit: int = 200) -> dict | None:
        # Project events descending by occurred_at, then limit
        pipeline = [
            {"$match": {"customer_id": customer_id}},
            {
                "$project": {
                    "customer_id": 1,
                    "first_seen": 1,
                    "last_seen": 1,
                    "total_events": 1,
                    "channels_touched": 1,
                    "events": {"$slice": [
                        {"$sortArray": {"input": "$events", "sortBy": {"occurred_at": -1}}},
                        limit,
                    ]},
                }
            },
        ]
        cursor = self.timelines.aggregate(pipeline)
        async for doc in cursor:
            return doc
        return None

    async def list_customers(self, limit: int = 100) -> list[dict]:
        cursor = self.timelines.find(
            {},
            {"events": 0},  # don't ship events in the list view
        ).sort("last_seen", -1).limit(limit)
        return [doc async for doc in cursor]

    async def customer_summaries(self, customer_ids: list[str]) -> list[dict]:
        if not customer_ids:
            return []
        cursor = self.timelines.find(
            {"customer_id": {"$in": customer_ids}},
            {"events": 0},
        )
        return [doc async for doc in cursor]

    async def funnel(self, since: datetime | None = None) -> dict:
        """Compute the canonical funnel."""
        match: dict = {}
        if since:
            match["events.occurred_at"] = {"$gte": since}

        # Canonical funnel steps. "visit" is the union of any web page_view or
        # mobile app_open — they're parallel entry channels, not sequential
        # steps, so they must not be split across two funnel rungs (that
        # produces nonsensical negative drop-off once downstream steps are
        # channel-agnostic).
        steps = [
            ("visit",           None, ["page_view", "app_open"]),
            ("product_view",    None, ["product_view"]),
            ("add_to_cart",     None, ["add_to_cart"]),
            ("payment_attempt", None, ["payment_attempt"]),
            ("payment_success", None, ["payment_success"]),
        ]

        result = {}
        required_types: list[list[str]] = []
        for name, channel, etypes in steps:
            required_types.append(etypes)
            # Pre-unwind: docs that have at least one matching event in-window
            q: dict = {"events.event_type": {"$in": etypes}}
            if channel:
                q["events.channel"] = channel
            q.update(match)
            # Post-unwind: must re-apply time + type filters (unwind expands all events)
            event_match: dict = {"events.event_type": {"$in": etypes}}
            if channel:
                event_match["events.channel"] = channel
            if since:
                event_match["events.occurred_at"] = {"$gte": since}
            # Distinct customers who hit this step inside the window
            pipeline = [
                {"$match": q},
                {"$unwind": "$events"},
                {"$match": ({"events.occurred_at": {"$gte": since}} if since else {})},
                {"$group": {"_id": "$customer_id", "types": {"$addToSet": "$events.event_type"}}},
                {"$match": {"$and": [
                    {"$expr": {"$gt": [{"$size": {"$setIntersection": ["$types", needed]}}, 0]}}
                    for needed in required_types
                ]}},
                {"$count": "n"},
            ]
            n = 0
            async for doc in self.timelines.aggregate(pipeline):
                n = doc["n"]
            result[name] = n
        return result

    async def repeat_contacts(
        self,
        since: datetime,
        min_contacts: int = 2,
        limit: int = 50,
    ) -> list[dict]:
        """Customers with N+ call_center/branch interactions in the window."""
        pipeline = [
            {"$unwind": "$events"},
            {
                "$match": {
                    "events.occurred_at": {"$gte": since},
                    "events.channel": {"$in": ["call_center", "branch"]},
                }
            },
            {
                "$group": {
                    "_id": {
                        "customer_id": "$customer_id",
                        "channel": "$events.channel",
                    },
                    "count": {"$sum": 1},
                    "last_at": {"$max": "$events.occurred_at"},
                }
            },
            {
                "$group": {
                    "_id": "$_id.customer_id",
                    "total": {"$sum": "$count"},
                    "by_channel": {
                        "$push": {
                            "channel": "$_id.channel",
                            "count": "$count",
                            "last_at": "$last_at",
                        }
                    },
                    "last_contact_at": {"$max": "$last_at"},
                }
            },
            {"$match": {"total": {"$gte": min_contacts}}},
            {"$sort": {"total": -1}},
            {"$limit": limit},
        ]
        items: list[dict] = []
        async for doc in self.timelines.aggregate(pipeline):
            items.append({
                "customer_id": doc["_id"],
                "total": doc["total"],
                "by_channel": doc.get("by_channel") or [],
                "last_contact_at": doc.get("last_contact_at"),
            })
        return items
