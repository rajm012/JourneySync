"""Canonical event schemas — the contracts between layers."""
from __future__ import annotations
from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field, field_validator
import uuid


Channel = Literal["web", "mobile_app", "call_center", "email", "sms", "branch"]


class IdentityHints(BaseModel):
    """Strong identifiers — any one is enough for deterministic match."""
    user_id: Optional[str] = None
    email: Optional[str] = None
    loyalty_card: Optional[str] = None
    phone_e164: Optional[str] = None

    @field_validator("user_id", "email", "loyalty_card", "phone_e164", mode="before")
    @classmethod
    def _trim(cls, value: Any) -> Any:
        if value is None:
            return None
        value = str(value).strip()
        return value or None

    @field_validator("email")
    @classmethod
    def _normalize_email(cls, value: Optional[str]) -> Optional[str]:
        # Deterministic matching does a literal lookup against `identifiers`,
        # so "A@x.com" and "a@x.com" must resolve to the same row.
        return value.lower() if value else value

    @field_validator("phone_e164")
    @classmethod
    def _normalize_phone(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return value
        digits = "".join(ch for ch in value if ch.isdigit() or ch == "+")
        if digits.startswith("00"):
            digits = "+" + digits[2:]
        return digits


class BehavioralSignals(BaseModel):
    """Soft signals — used for probabilistic match."""
    device_fp: Optional[str] = None
    ip: Optional[str] = None
    ip_subnet: Optional[str] = None      # /24
    geo: Optional[tuple[float, float]] = None  # (lat, lon)
    user_agent: Optional[str] = None


class ChannelEvent(BaseModel):
    """Raw event posted by a channel adapter."""
    event_id: str = Field(default_factory=lambda: str(uuid.uuid4()), min_length=1, max_length=200)
    channel: Channel
    event_type: str = Field(min_length=1, max_length=100)
    occurred_at: datetime
    identity: IdentityHints = Field(default_factory=IdentityHints)
    signals: BehavioralSignals = Field(default_factory=BehavioralSignals)
    payload: dict = Field(default_factory=dict)


class UnifiedEvent(ChannelEvent):
    """After resolution — adds customer linkage + confidence."""
    customer_id: Optional[str] = None
    confidence: float = 0.0
    match_method: Optional[Literal[
        "deterministic", "probabilistic", "hybrid", "new_identity", "unresolved", "conflict_guard"
    ]] = None
    match_status: Literal["matched", "uncertain", "unresolved", "conflict"] = "unresolved"
    resolved_at: Optional[datetime] = None
