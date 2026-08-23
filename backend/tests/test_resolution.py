"""Unit tests for the identity resolution engine.

These run against the live dev database (no mocks), so every test uses a
uuid-scoped email/device_fp instead of a fixed literal. Reusing a fixed
value like "test_unique@example.com" makes a test's outcome depend on
whether a previous run already created that customer — pass on a clean DB,
fail on any rerun. A fresh uuid per test removes that dependency entirely.
"""
import uuid
import pytest
from datetime import datetime, timezone

from app.core.config import settings
from app.core.db import SessionLocal
from app.schemas.event import UnifiedEvent, IdentityHints, BehavioralSignals
from app.services.resolution import IdentityResolver


def unique_email() -> str:
    return f"test-{uuid.uuid4().hex}@example.com"


def unique_device() -> str:
    return f"d-test-{uuid.uuid4().hex}"


def unique_subnet() -> str:
    # A fixed literal like "8.8.8.0/24" reused across test runs pollutes the
    # signals table with residual rows from earlier runs — a randomized
    # subnet per test keeps probabilistic matching scoped to this run only.
    return f"10.{uuid.uuid4().int % 250}.{(uuid.uuid4().int >> 8) % 250}.0/24"


@pytest.mark.asyncio
async def test_deterministic_match_creates_customer():
    """A new event with email should create a customer and resolve back to it."""
    async with SessionLocal() as s:
        ev = UnifiedEvent(
            channel="web",
            event_type="page_view",
            occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(email=unique_email()),
            signals=BehavioralSignals(device_fp=unique_device()),
        )
        resolver = IdentityResolver(s)
        r = await resolver.resolve(ev)
        assert r.customer_id is not None
        assert r.method == "new_identity"
        assert r.confidence == 1.0
        assert r.match_status == "matched"


@pytest.mark.asyncio
async def test_deterministic_re_match_links_existing():
    """A second event with the same email should link to the first customer."""
    async with SessionLocal() as s:
        email = unique_email()
        device = unique_device()
        resolver = IdentityResolver(s)

        ev1 = UnifiedEvent(
            channel="web",
            event_type="page_view",
            occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(email=email),
            signals=BehavioralSignals(device_fp=device),
        )
        r1 = await resolver.resolve(ev1)
        cid = r1.customer_id

        # Second event — same email, same device, no conflict expected
        ev2 = UnifiedEvent(
            channel="mobile_app",
            event_type="app_open",
            occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(email=email),
            signals=BehavioralSignals(device_fp=device),
        )
        r2 = await resolver.resolve(ev2)
        assert r2.customer_id == cid
        assert r2.method == "deterministic"
        assert r2.confidence >= settings.DETERMINISTIC_THRESHOLD


@pytest.mark.asyncio
async def test_probabilistic_match_with_device_fp():
    """Anonymous event with device_fp should link via probabilistic path."""
    async with SessionLocal() as s:
        known_device = unique_device()
        ev1 = UnifiedEvent(
            channel="web",
            event_type="page_view",
            occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(email=unique_email()),
            signals=BehavioralSignals(device_fp=known_device),
        )
        resolver = IdentityResolver(s)
        r1 = await resolver.resolve(ev1)
        cid = r1.customer_id

        # Anonymous event from the same device (no email/phone/loyalty)
        ev2 = UnifiedEvent(
            channel="web",
            event_type="page_view",
            occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(),
            signals=BehavioralSignals(device_fp=known_device),
        )
        r2 = await resolver.resolve(ev2)
        assert r2.customer_id == cid
        assert r2.method in ("probabilistic", "hybrid")
        assert r2.confidence >= 0.3


@pytest.mark.asyncio
async def test_brand_new_device_with_no_identity_becomes_new_identity():
    """No identifiers and no prior signal history for this device: there's
    nothing to link to, so resolution creates a fresh identity outright."""
    async with SessionLocal() as s:
        ev = UnifiedEvent(
            channel="web",
            event_type="page_view",
            occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(),
            signals=BehavioralSignals(device_fp=unique_device()),
        )
        resolver = IdentityResolver(s)
        r = await resolver.resolve(ev)
        assert r.customer_id is not None
        assert r.method == "new_identity"
        assert r.match_status == "matched"


@pytest.mark.asyncio
async def test_weak_ip_only_signal_is_flagged_uncertain():
    """A shared-subnet-only signal (no device_fp) is real evidence but too
    weak to auto-match — it must land in the 'uncertain' review band, not be
    silently resolved."""
    async with SessionLocal() as s:
        resolver = IdentityResolver(s)
        subnet = unique_subnet()

        # Customer X is known only by a weak ip_subnet signal (no device_fp).
        ev1 = UnifiedEvent(
            channel="web",
            event_type="page_view",
            occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(email=unique_email()),
            signals=BehavioralSignals(ip_subnet=subnet),
        )
        r1 = await resolver.resolve(ev1)
        assert r1.customer_id is not None

        # A second, anonymous event on the same subnet — same weak evidence,
        # no device_fp, nothing else to go on.
        ev2 = UnifiedEvent(
            channel="web",
            event_type="page_view",
            occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(),
            signals=BehavioralSignals(ip_subnet=subnet),
        )
        r2 = await resolver.resolve(ev2)
        # "uncertain" still carries a tentative customer_id (the review queue
        # shows it as a candidate to confirm) but must not be treated as a
        # confirmed match.
        assert r2.customer_id == r1.customer_id
        assert r2.match_status == "uncertain"
        assert 0.3 <= r2.confidence < settings.RESOLVE_CONFIDENCE_THRESHOLD


@pytest.mark.asyncio
async def test_behavioral_conflict_is_quarantined_not_silently_merged():
    """A known email showing up on a *different* customer's established device
    must be refused, not silently resolved to the email owner."""
    async with SessionLocal() as s:
        resolver = IdentityResolver(s)
        device_a = unique_device()
        subnet_a = unique_subnet()

        # Establish customer A purely by behavioral signal (no identity yet).
        cust_a = None
        for _ in range(4):
            ev_a = UnifiedEvent(
                channel="web",
                event_type="page_view",
                occurred_at=datetime.now(timezone.utc),
                identity=IdentityHints(),
                signals=BehavioralSignals(device_fp=device_a, ip_subnet=subnet_a),
            )
            r = await resolver.resolve(ev_a)
            cust_a = r.customer_id
        assert cust_a is not None

        # Customer B is a real, separate identity with their own device.
        ev_b = UnifiedEvent(
            channel="web",
            event_type="page_view",
            occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(email=unique_email()),
            signals=BehavioralSignals(device_fp=unique_device()),
        )
        rb = await resolver.resolve(ev_b)
        cust_b = rb.customer_id
        assert cust_b is not None and cust_b != cust_a

        # Collision: B's email shows up on A's established device.
        ev_collide = UnifiedEvent(
            channel="web",
            event_type="page_view",
            occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(email=ev_b.identity.email),
            signals=BehavioralSignals(device_fp=device_a, ip_subnet=subnet_a),
        )
        rc = await resolver.resolve(ev_collide)
        assert rc.customer_id is None
        assert rc.match_status == "conflict"
        assert rc.method == "conflict_guard"


@pytest.mark.asyncio
async def test_conflicting_identifiers_on_one_event_are_quarantined():
    """Two strong identifiers on the same event pointing at different
    customers must be refused, not resolved to whichever is checked first."""
    async with SessionLocal() as s:
        resolver = IdentityResolver(s)
        email_a = unique_email()
        phone_b = f"+1{uuid.uuid4().int % 10**10:010d}"

        r1 = await resolver.resolve(UnifiedEvent(
            channel="web", event_type="page_view", occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(email=email_a), signals=BehavioralSignals(),
        ))
        r2 = await resolver.resolve(UnifiedEvent(
            channel="web", event_type="page_view", occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(phone_e164=phone_b), signals=BehavioralSignals(),
        ))
        assert r1.customer_id != r2.customer_id

        r3 = await resolver.resolve(UnifiedEvent(
            channel="web", event_type="page_view", occurred_at=datetime.now(timezone.utc),
            identity=IdentityHints(email=email_a, phone_e164=phone_b), signals=BehavioralSignals(),
        ))
        assert r3.customer_id is None
        assert r3.match_status == "conflict"
        assert r3.method == "conflict_guard"
