-- JourneySync — Postgres schema
-- Identity graph: relational integrity for known identifiers

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS customers (
    customer_id   TEXT PRIMARY KEY,
    name          TEXT,
    email         TEXT,
    phone_e164    TEXT,
    loyalty_card  TEXT,
    home_geo_lat  DOUBLE PRECISION,
    home_geo_lon  DOUBLE PRECISION,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_customers_email        ON customers (email);
CREATE INDEX IF NOT EXISTS idx_customers_phone        ON customers (phone_e164);
CREATE INDEX IF NOT EXISTS idx_customers_loyalty_card ON customers (loyalty_card);

-- Identifier index: maps any strong identifier to a customer
CREATE TABLE IF NOT EXISTS identifiers (
    id          BIGSERIAL PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    id_type     TEXT NOT NULL,   -- 'user_id' | 'email' | 'phone_e164' | 'loyalty_card'
    id_value    TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (id_type, id_value)
);

CREATE INDEX IF NOT EXISTS idx_identifiers_value ON identifiers (id_value);

-- Behavioral signals (soft, time-bounded): device fingerprint, IP /24, etc.
CREATE TABLE IF NOT EXISTS signals (
    id          BIGSERIAL PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(customer_id) ON DELETE CASCADE,
    signal_type TEXT NOT NULL,   -- 'device_fp' | 'ip_subnet' | etc.
    signal_value TEXT NOT NULL,
    last_seen   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (customer_id, signal_type, signal_value)
);

CREATE INDEX IF NOT EXISTS idx_signals_value ON signals (signal_value);
CREATE INDEX IF NOT EXISTS idx_signals_last_seen ON signals (last_seen);

-- Match audit: every match decision is logged
CREATE TABLE IF NOT EXISTS match_audit (
    id              BIGSERIAL PRIMARY KEY,
    event_id        TEXT NOT NULL,
    customer_id     TEXT,
    confidence      DOUBLE PRECISION NOT NULL,
    method          TEXT NOT NULL,            -- 'deterministic' | 'probabilistic' | 'hybrid' | 'new_identity' | 'unresolved' | 'conflict_guard'
    signals_json    JSONB NOT NULL DEFAULT '{}'::jsonb,
    match_status    TEXT NOT NULL,            -- 'matched' | 'uncertain' | 'unresolved' | 'conflict'
    decided_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_match_audit_event    ON match_audit (event_id);
CREATE INDEX IF NOT EXISTS idx_match_audit_customer ON match_audit (customer_id);
CREATE INDEX IF NOT EXISTS idx_match_audit_status   ON match_audit (match_status);

-- Alerts
CREATE TABLE IF NOT EXISTS alerts (
    id              TEXT PRIMARY KEY,
    customer_id     TEXT NOT NULL,
    rule_id         TEXT NOT NULL,
    severity        TEXT NOT NULL,            -- 'low' | 'medium' | 'high' | 'critical'
    title           TEXT NOT NULL,
    body            TEXT,
    suggested_action TEXT,
    status          TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'acknowledged' | 'resolved'
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    resolved_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_alerts_customer ON alerts (customer_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status   ON alerts (status);
CREATE INDEX IF NOT EXISTS idx_alerts_created  ON alerts (created_at DESC);
-- One open alert per customer+rule (dedup under live traffic)
CREATE UNIQUE INDEX IF NOT EXISTS uq_alerts_open_rule
    ON alerts (customer_id, rule_id) WHERE status = 'open';

-- Latency tracking (simple ring buffer in DB for the demo)
CREATE TABLE IF NOT EXISTS ingest_latency (
    id         BIGSERIAL PRIMARY KEY,
    event_id   TEXT NOT NULL,
    latency_ms DOUBLE PRECISION NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ingest_latency_recorded ON ingest_latency (recorded_at);
