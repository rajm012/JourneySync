"""Customer API: list + timeline."""
from __future__ import annotations
from datetime import timezone
from fastapi import APIRouter, HTTPException, Query

from app.core.db import SessionLocal
from app.services.stitching import Stitcher
from sqlalchemy import text


router = APIRouter(prefix="/api", tags=["customers"])


def _iso(dt) -> str | None:
    """Mongo/motor hands back naive (implicitly-UTC) datetimes. Serializing
    those with plain .isoformat() omits the timezone suffix, which every JS
    engine is free to interpret as *local* time rather than UTC — the browser
    and the Node SSR process then parse the same string into two different
    instants, and React logs a hydration mismatch on whatever renders from it.
    Stamp UTC explicitly before serializing so the string is unambiguous.
    """
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.isoformat()


@router.get("/customers")
async def list_customers(
    limit: int = Query(24, ge=1, le=100),
    offset: int = Query(0, ge=0),
    search: str = Query("", max_length=100),
):
    """Paginated identity catalog, including customers without recent events."""
    stitcher = Stitcher()
    async with SessionLocal() as s:
        term = f"%{search.strip()}%"
        where = """WHERE (:search = '' OR customer_id ILIKE :term OR name ILIKE :term OR email ILIKE :term OR phone_e164 ILIKE :term)"""
        total = (await s.execute(text(f"SELECT COUNT(*) FROM customers {where}"), {"search": search.strip(), "term": term})).scalar_one()
        rows = (await s.execute(text(f"""
            SELECT customer_id, name, email, phone_e164, loyalty_card
            FROM customers {where}
            ORDER BY CASE WHEN customer_id='C0001' THEN 0 ELSE 1 END, customer_id
            LIMIT :limit OFFSET :offset
        """), {"search": search.strip(), "term": term, "limit": limit, "offset": offset})).all()
    items = [{"customer_id": r[0], "name": r[1], "email": r[2], "phone_e164": r[3], "loyalty_card": r[4]} for r in rows]
    docs = await stitcher.customer_summaries([x["customer_id"] for x in items])
    summaries = {d["customer_id"]: d for d in docs}
    for d in items:
        d.update(summaries.get(d["customer_id"], {}))
        for k in ("first_seen", "last_seen"):
            if k in d and d[k] is not None:
                d[k] = _iso(d[k])
        if "_id" in d:
            d["_id"] = str(d["_id"])
        d.setdefault("total_events", 0)
        d.setdefault("channels_touched", [])
    return {"items": items, "count": len(items), "total": total, "limit": limit, "offset": offset}


@router.get("/customers/{customer_id}")
async def get_customer(customer_id: str):
    async with SessionLocal() as s:
        row = (await s.execute(
            text("""
                SELECT customer_id, name, email, phone_e164, loyalty_card,
                       home_geo_lat, home_geo_lon, created_at
                FROM customers WHERE customer_id=:c
            """),
            {"c": customer_id},
        )).first()
        if not row:
            raise HTTPException(404, "customer not found")
        cols = ["customer_id", "name", "email", "phone_e164", "loyalty_card",
                "home_geo_lat", "home_geo_lon", "created_at"]
        cust = dict(zip(cols, row))
        for k in ("created_at",):
            if cust.get(k) is not None:
                cust[k] = cust[k].isoformat()
        return cust


@router.get("/customers/{customer_id}/graph")
async def get_identity_graph(customer_id: str):
    """The identity graph behind one customer: which identifiers and
    behavioral signals we've linked to them, and any attempted links to a
    *different* customer that the conflict guard refused — the direct,
    visual proof that a match was quarantined rather than silently merged.
    """
    async with SessionLocal() as s:
        cust_row = (await s.execute(
            text("SELECT customer_id, name, email, phone_e164, loyalty_card FROM customers WHERE customer_id=:c"),
            {"c": customer_id},
        )).first()
        if not cust_row:
            raise HTTPException(404, "customer not found")
        customer = dict(zip(["customer_id", "name", "email", "phone_e164", "loyalty_card"], cust_row))

        id_rows = (await s.execute(
            text("SELECT id_type, id_value FROM identifiers WHERE customer_id=:c ORDER BY id_type"),
            {"c": customer_id},
        )).all()
        identifiers = [{"type": r[0], "value": r[1]} for r in id_rows]

        sig_rows = (await s.execute(
            text("""
                SELECT signal_type, signal_value, last_seen FROM signals
                WHERE customer_id=:c ORDER BY last_seen DESC LIMIT 25
            """),
            {"c": customer_id},
        )).all()
        signals = [
            {"type": r[0], "value": r[1], "last_seen": r[2].isoformat() if r[2] else None}
            for r in sig_rows
        ]

        # A conflict can associate a customer in two ways:
        #   1. match_audit.customer_id (seeded/manual-review conflicts), or
        #   2. a customer id inside signals_json (real identifier-vs-identifier
        #      and identifier-vs-behavioral conflicts, whose result itself has
        #      no winning customer_id).
        # Check both so the graph cannot silently omit either conflict shape.
        # Quoting the JSON value avoids C0001 accidentally matching C00010.
        conflict_rows = (await s.execute(
            text("""
                SELECT event_id, method, signals_json, decided_at FROM match_audit
                WHERE match_status = 'conflict'
                  AND (
                    customer_id = :c
                    OR signals_json::text LIKE '%"' || :c || '"%'
                  )
                ORDER BY decided_at DESC LIMIT 20
            """),
            {"c": customer_id},
        )).all()
        conflicts = [
            {
                "event_id": r[0],
                "method": r[1],
                "detail": r[2] if isinstance(r[2], dict) else {},
                "decided_at": r[3].isoformat() if r[3] else None,
            }
            for r in conflict_rows
        ]

    return {
        "customer": customer,
        "identifiers": identifiers,
        "signals": signals,
        "conflicts": conflicts,
    }


@router.get("/customers/{customer_id}/timeline")
async def get_timeline(customer_id: str, limit: int = 200):
    stitcher = Stitcher()
    doc = await stitcher.get_timeline(customer_id, limit=limit)
    if not doc:
        raise HTTPException(404, "timeline not found")
    # JSON-friendly
    for k in ("first_seen", "last_seen"):
        if k in doc and doc[k] is not None:
            doc[k] = _iso(doc[k])
    for ev in doc.get("events", []):
        if "occurred_at" in ev and ev["occurred_at"] is not None:
            ev["occurred_at"] = _iso(ev["occurred_at"])
    if "_id" in doc:
        doc["_id"] = str(doc["_id"])
    return doc
