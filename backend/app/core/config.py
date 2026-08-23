"""Application settings — load from environment."""
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # Connections — host ports match docker-compose published ports
    DATABASE_URL: str = "postgresql+asyncpg://journeysync:journeysync@localhost:5434/journeysync"
    MONGO_URL: str = "mongodb://localhost:27018"
    MONGO_DB: str = "journeysync"
    REDIS_URL: str = "redis://localhost:6381"

    # Resolution
    RESOLVE_CONFIDENCE_THRESHOLD: float = 0.6
    DETERMINISTIC_THRESHOLD: float = 0.9

    # Probabilistic weights (sum to 1.0)
    W_DEVICE_FP: float = 0.45
    W_IP_SUBNET: float = 0.20
    W_TIME: float = 0.20
    W_GEO: float = 0.15

    # Time window for probabilistic match (minutes)
    PROB_TIME_WINDOW_MIN: int = 30
    # Max geo distance for full credit (km)
    PROB_GEO_MAX_KM: float = 50.0

    # Streams
    RAW_STREAM: str = "events.raw"
    RESOLVED_STREAM: str = "events.resolved"
    ALERTS_CHANNEL: str = "alerts.raised"
    RESOLVED_CHANNEL: str = "events.resolved"
    CONSUMER_GROUP: str = "resolvers"

    # Demo
    DEMO_BURST_SIZE: int = 10000
    DEMO_BURST_DURATION_SECONDS: int = 30

    # Ingestion: window a retried event_id is deduplicated within
    IDEMPOTENCY_TTL_SECONDS: int = 604800  # 7 days


settings = Settings()
