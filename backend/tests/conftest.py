"""Share one event loop across the whole test session.

The default per-test event loop doesn't match the lifetime of app.core.db's
module-level async engine (created once at import time): a connection opened
in test A's loop errors with "Event loop is closed" when the pool tries to
reuse or tear it down inside test B's loop. Session-scoping the loop keeps
it aligned with the engine's actual lifetime.
"""
import asyncio

import pytest


@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()
