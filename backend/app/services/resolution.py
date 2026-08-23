"""Identity resolution — hybrid deterministic + probabilistic.

Run deterministic first (exact, free, falsifiable).
Fall back to probabilistic for anonymous traffic.
Final confidence is a weighted combo of both.

Every decision is auditable in Postgres `match_audit`.
"""
from __future__ import annotations
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from math import radians, sin, cos, asin, sqrt
from typing import Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.mongo import get_db
from app.schemas.event import UnifiedEvent


@dataclass
class ResolutionResult:
    customer_id: Optional[str]
    confidence: float
    method: str
    match_status: str
    signals: dict


def haversine_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    R = 6371.0
    lat1, lon1 = radians(a[0]), radians(a[1])
    lat2, lon2 = radians(b[0]), radians(b[1])
    dlat, dlon = lat2 - lat1, lon2 - lon1
    h = sin(dlat / 2) ** 2 + cos(lat1) * cos(lat2) * sin(dlon / 2) ** 2
    return 2 * R * asin(sqrt(h))


def _ip_subnet(ip: Optional[str]) -> Optional[str]:
    if not ip or "/" in ip:
        return ip
    parts = ip.split(".")
    if len(parts) != 4:
        return None
    return ".".join(parts[:3]) + ".0/24"


class IdentityResolver:
    def __init__(self, session: AsyncSession):
        self.session = session
        self.db_mongo = get_db()

    async def resolve(self, ev: UnifiedEvent) -> ResolutionResult:
        # 1) Deterministic
        det = await self._deterministic(ev.identity)
        if det and det.match_status == "conflict":
            await self._audit(ev, det)
            return det
        if det and det.confidence >= settings.DETERMINISTIC_THRESHOLD:
            # Guard: a strong identifier alone isn't enough if strong behavioral
            # evidence on this same event points at a *different* customer
            # (e.g. someone else's device used with a stolen/shared email).
            # Refuse to resolve rather than let the identifier silently win.
            conflict = await self._behavioral_conflict(det, ev)
            if conflict:
                await self._audit(ev, conflict)
                return conflict
            await self._audit(ev, det)
            return det

        # 2) Probabilistic
        prob = await self._probabilistic(ev)

        # 3) Hybrid combo
        if det and prob and det.customer_id == prob.customer_id:
            combo = ResolutionResult(
                customer_id=det.customer_id,
                confidence=min(1.0, det.confidence + 0.4 * prob.confidence),
                method="hybrid",
                match_status="matched" if (det.confidence + 0.4 * prob.confidence) >= settings.RESOLVE_CONFIDENCE_THRESHOLD else "uncertain",
                signals={"deterministic": det.signals, "probabilistic": prob.signals},
            )
            await self._audit(ev, combo)
            return combo

        if det:
            await self._audit(ev, det)
            return det
        if prob:
            await self._audit(ev, prob)
            return prob

        # 4) New identity
        new_id = await self._create_customer(ev)
        result = ResolutionResult(
            customer_id=new_id,
            confidence=1.0,
            method="new_identity",
            match_status="matched",
            signals={"new": True},
        )
        await self._audit(ev, result)
        return result

    # ---------- Deterministic ----------
    async def _deterministic(self, idh) -> Optional[ResolutionResult]:
        # Look up every strong identifier present on the event, not just the
        # first one that resolves — if two of them point at different
        # customers (e.g. an email swapped onto someone else's loyalty card),
        # that's a conflict to flag, not a coin flip to resolve silently.
        hits: dict[str, str] = {}
        for id_type, value in [
            ("user_id", idh.user_id),
            ("email", idh.email),
            ("loyalty_card", idh.loyalty_card),
            ("phone_e164", idh.phone_e164),
        ]:
            if not value:
                continue
            row = (
                await self.session.execute(
                    text("SELECT customer_id FROM identifiers WHERE id_type=:t AND id_value=:v LIMIT 1"),
                    {"t": id_type, "v": value},
                )
            ).first()
            if row:
                hits[id_type] = row[0]

        if not hits:
            return None

        distinct = set(hits.values())
        if len(distinct) > 1:
            return ResolutionResult(
                customer_id=None,
                confidence=0.0,
                method="conflict_guard",
                match_status="conflict",
                signals={"conflicting_identifiers": hits},
            )

        id_type, customer_id = next(iter(hits.items()))
        return ResolutionResult(
            customer_id=customer_id,
            confidence=1.0,
            method="deterministic",
            match_status="matched",
            signals={"matched_on": id_type},
        )

    async def _behavioral_conflict(self, det: ResolutionResult, ev: UnifiedEvent) -> Optional[ResolutionResult]:
        """Cross-check a deterministic identifier match against behavioral
        signals. Only refuses the match when the *other* customer's evidence
        is itself strong enough to stand on its own (>= RESOLVE_CONFIDENCE_
        THRESHOLD) — a weak coincidental overlap like a shared office IP
        subnet shouldn't be enough to block an otherwise-clean match.

        This runs on every deterministic match (the overwhelming majority of
        traffic), so it stays cheap in the common case: one indexed lookup
        for whether *any other* customer has recorded this device_fp/
        ip_subnet recently. Only when that finds something do we pay for the
        full probabilistic scoring pass to confirm it's strong enough to act
        on — under normal traffic that full pass almost never runs.
        """
        sig = ev.signals
        if not sig.device_fp and not sig.ip_subnet:
            return None

        since = datetime.now(timezone.utc) - timedelta(minutes=settings.PROB_TIME_WINDOW_MIN)
        ip_sub = _ip_subnet(sig.ip) or sig.ip_subnet
        other = (
            await self.session.execute(
                text("""
                    SELECT 1 FROM signals
                    WHERE last_seen >= :since
                      AND customer_id != :det_customer
                      AND (
                        (signal_type='device_fp' AND signal_value=:dev)
                        OR (signal_type='ip_subnet' AND signal_value=:ip)
                      )
                    LIMIT 1
                """),
                {"since": since, "det_customer": det.customer_id, "dev": sig.device_fp or "", "ip": ip_sub or ""},
            )
        ).first()
        if not other:
            return None

        prob = await self._probabilistic(ev)
        if not prob or prob.customer_id == det.customer_id:
            return None
        if prob.confidence < settings.RESOLVE_CONFIDENCE_THRESHOLD:
            return None
        return ResolutionResult(
            customer_id=None,
            confidence=0.0,
            method="conflict_guard",
            match_status="conflict",
            signals={
                "identifier_customer": det.customer_id,
                "identifier_signals": det.signals,
                "behavioral_customer": prob.customer_id,
                "behavioral_confidence": prob.confidence,
            },
        )

    # ---------- Probabilistic ----------
    async def _probabilistic(self, ev: UnifiedEvent) -> Optional[ResolutionResult]:
        sig = ev.signals
        if not sig.device_fp and not sig.ip_subnet:
            return None

        # Pull recent signals matching either device_fp or ip_subnet
        since = datetime.now(timezone.utc) - timedelta(minutes=settings.PROB_TIME_WINDOW_MIN)
        device = sig.device_fp
        ip_sub = _ip_subnet(sig.ip) or sig.ip_subnet

        rows = (
            await self.session.execute(
                text("""
                    SELECT customer_id, signal_type, signal_value, last_seen
                    FROM signals
                    WHERE last_seen >= :since
                      AND (
                        (signal_type='device_fp' AND signal_value=:dev)
                        OR (signal_type='ip_subnet' AND signal_value=:ip)
                      )
                    ORDER BY last_seen DESC
                    LIMIT 50
                """),
                {"since": since, "dev": device or "", "ip": ip_sub or ""},
            )
        ).all()
        if not rows:
            return None

        # Aggregate by customer
        by_cust: dict[str, dict] = {}
        for cid, stype, sval, last_seen in rows:
            d = by_cust.setdefault(cid, {"device_fp": False, "ip_subnet": False, "recency_min": 9999.0})
            if stype == "device_fp" and sval == device:
                d["device_fp"] = True
            if stype == "ip_subnet" and sval == ip_sub:
                d["ip_subnet"] = True
            if last_seen is not None:
                ls = last_seen
                if getattr(ls, "tzinfo", None) is None:
                    ls = ls.replace(tzinfo=timezone.utc)
                age_min = (datetime.now(timezone.utc) - ls).total_seconds() / 60.0
                d["recency_min"] = min(d["recency_min"], max(0.0, age_min))

        # Score each candidate
        best: tuple[float, str] = (0.0, "")
        for cid, d in by_cust.items():
            score = 0.0
            if d["device_fp"]:
                score += settings.W_DEVICE_FP
            if d["ip_subnet"]:
                score += settings.W_IP_SUBNET
            # Recency (time signal): full credit if seen in last 5 min, decays linearly
            time_score = max(0.0, 1.0 - d["recency_min"] / settings.PROB_TIME_WINDOW_MIN)
            score += settings.W_TIME * time_score
            # Geo: optional, only if we have a known customer geo
            geo_score = await self._geo_score(cid, sig.geo)
            score += settings.W_GEO * geo_score
            if score > best[0]:
                best = (score, cid)

        if not best[1] or best[0] <= 0:
            return None

        # Spec bands: ≥0.6 matched · 0.3–0.6 uncertain · <0.3 unresolved (review queue)
        if best[0] >= settings.RESOLVE_CONFIDENCE_THRESHOLD:
            status = "matched"
        elif best[0] >= 0.3:
            status = "uncertain"
        else:
            status = "unresolved"

        return ResolutionResult(
            customer_id=best[1],
            confidence=best[0],
            method="probabilistic",
            match_status=status,
            signals={"device_fp": device, "ip_subnet": ip_sub, "score": best[0]},
        )

    async def _geo_score(self, customer_id: str, ev_geo) -> float:
        if not ev_geo:
            return 0.0
        row = (
            await self.session.execute(
                text("SELECT home_geo_lat, home_geo_lon FROM customers WHERE customer_id=:c"),
                {"c": customer_id},
            )
        ).first()
        if not row or row[0] is None or row[1] is None:
            return 0.0
        d = haversine_km(ev_geo, (row[0], row[1]))
        if d <= settings.PROB_GEO_MAX_KM:
            return 1.0
        # Decay over 200 km
        return max(0.0, 1.0 - (d - settings.PROB_GEO_MAX_KM) / 150.0)

    # ---------- New identity ----------
    async def _create_customer(self, ev: UnifiedEvent) -> str:
        """Create a customer, or join an existing one if a strong ID was claimed concurrently.

        Race-safe: if another worker inserts the same email/phone first, we detect the
        unique conflict, discard the orphan row, and return the winner's customer_id.
        """
        import secrets, string

        # Fast path: another concurrent resolve may have already claimed a strong ID
        existing = await self._lookup_any_strong_id(ev.identity)
        if existing:
            await self._attach_identifiers(existing, ev.identity)
            await self._attach_signals(existing, ev)
            await self.session.commit()
            return existing

        for _ in range(3):
            suffix = "".join(secrets.choice(string.ascii_uppercase + string.digits) for _ in range(6))
            new_id = f"C{suffix}"
            idh = ev.identity
            try:
                await self.session.execute(
                    text("""
                        INSERT INTO customers (customer_id, name, email, phone_e164, loyalty_card,
                                               home_geo_lat, home_geo_lon)
                        VALUES (:cid, NULL, :email, :phone, :loyalty, :lat, :lon)
                    """),
                    {
                        "cid": new_id,
                        "email": idh.email,
                        "phone": idh.phone_e164,
                        "loyalty": idh.loyalty_card,
                        "lat": ev.signals.geo[0] if ev.signals.geo else None,
                        "lon": ev.signals.geo[1] if ev.signals.geo else None,
                    },
                )
            except Exception:
                await self.session.rollback()
                continue  # rare PK collision

            stolen = await self._try_claim_identifiers(new_id, idh)
            if stolen:
                # Another customer already owns one of these strong IDs — discard orphan.
                await self.session.execute(
                    text("DELETE FROM customers WHERE customer_id=:c"),
                    {"c": new_id},
                )
                await self._attach_identifiers(stolen, idh)
                await self._attach_signals(stolen, ev)
                await self.session.commit()
                return stolen

            await self._attach_signals(new_id, ev)
            await self.session.commit()
            return new_id

        # Exhausted retries — re-lookup and attach
        existing = await self._lookup_any_strong_id(ev.identity)
        if existing:
            await self._attach_identifiers(existing, ev.identity)
            await self._attach_signals(existing, ev)
            await self.session.commit()
            return existing
        raise RuntimeError("failed to allocate customer_id")

    async def _lookup_any_strong_id(self, idh) -> Optional[str]:
        for id_type, value in [
            ("user_id", idh.user_id),
            ("email", idh.email),
            ("loyalty_card", idh.loyalty_card),
            ("phone_e164", idh.phone_e164),
        ]:
            if not value:
                continue
            row = (
                await self.session.execute(
                    text("SELECT customer_id FROM identifiers WHERE id_type=:t AND id_value=:v LIMIT 1"),
                    {"t": id_type, "v": value},
                )
            ).first()
            if row:
                return row[0]
        return None

    async def _try_claim_identifiers(self, customer_id: str, idh) -> Optional[str]:
        """Insert strong IDs for customer_id. Returns the conflicting owner if any INSERT loses."""
        for t, v in [
            ("user_id", idh.user_id),
            ("email", idh.email),
            ("phone_e164", idh.phone_e164),
            ("loyalty_card", idh.loyalty_card),
        ]:
            if not v:
                continue
            result = await self.session.execute(
                text("""
                    INSERT INTO identifiers (customer_id, id_type, id_value)
                    VALUES (:c, :t, :v)
                    ON CONFLICT (id_type, id_value) DO NOTHING
                    RETURNING customer_id
                """),
                {"c": customer_id, "t": t, "v": v},
            )
            row = result.first()
            if row is None:
                existing = (
                    await self.session.execute(
                        text("SELECT customer_id FROM identifiers WHERE id_type=:t AND id_value=:v"),
                        {"t": t, "v": v},
                    )
                ).first()
                if existing and existing[0] != customer_id:
                    return existing[0]
        return None

    async def _attach_identifiers(self, customer_id: str, idh) -> None:
        """Enrich a matched customer with any new strong identifiers from this event."""
        for t, v in [
            ("user_id", idh.user_id),
            ("email", idh.email),
            ("phone_e164", idh.phone_e164),
            ("loyalty_card", idh.loyalty_card),
        ]:
            if not v:
                continue
            await self.session.execute(
                text("""
                    INSERT INTO identifiers (customer_id, id_type, id_value)
                    VALUES (:c, :t, :v) ON CONFLICT (id_type, id_value) DO NOTHING
                """),
                {"c": customer_id, "t": t, "v": v},
            )
            # Keep denormalized customer columns fresh when we own the id
            if t == "email":
                await self.session.execute(
                    text("UPDATE customers SET email=COALESCE(email, :v), updated_at=NOW() WHERE customer_id=:c"),
                    {"c": customer_id, "v": v},
                )
            elif t == "phone_e164":
                await self.session.execute(
                    text("UPDATE customers SET phone_e164=COALESCE(phone_e164, :v), updated_at=NOW() WHERE customer_id=:c"),
                    {"c": customer_id, "v": v},
                )
            elif t == "loyalty_card":
                await self.session.execute(
                    text("UPDATE customers SET loyalty_card=COALESCE(loyalty_card, :v), updated_at=NOW() WHERE customer_id=:c"),
                    {"c": customer_id, "v": v},
                )

    async def _attach_signals(self, customer_id: str, ev: UnifiedEvent) -> None:
        if ev.signals.device_fp:
            await self._upsert_signal(customer_id, "device_fp", ev.signals.device_fp)
        subnet = _ip_subnet(ev.signals.ip) or ev.signals.ip_subnet
        if subnet:
            await self._upsert_signal(customer_id, "ip_subnet", subnet)

    async def _upsert_signal(self, customer_id: str, signal_type: str, value: str) -> None:
        await self.session.execute(
            text("""
                INSERT INTO signals (customer_id, signal_type, signal_value, last_seen)
                VALUES (:c, :t, :v, NOW())
                ON CONFLICT (customer_id, signal_type, signal_value)
                DO UPDATE SET last_seen = NOW()
            """),
            {"c": customer_id, "t": signal_type, "v": value},
        )

    # ---------- Audit ----------
    async def _audit(self, ev: UnifiedEvent, result: ResolutionResult) -> None:
        import orjson
        await self.session.execute(
            text("""
                INSERT INTO match_audit (event_id, customer_id, confidence, method, signals_json, match_status)
                VALUES (:eid, :cid, :conf, :method, CAST(:sig AS JSONB), :status)
            """),
            {
                "eid": ev.event_id,
                "cid": result.customer_id,
                "conf": result.confidence,
                "method": result.method,
                "sig": orjson.dumps(result.signals).decode(),
                "status": result.match_status,
            },
        )
        # Enrich graph on confirmed matches: new strong IDs + behavioral signals
        if result.customer_id and result.match_status == "matched":
            await self._attach_identifiers(result.customer_id, ev.identity)
            await self._attach_signals(result.customer_id, ev)
        await self.session.commit()
