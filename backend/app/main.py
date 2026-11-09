"""App factory.

Run (dev):  uv run uvicorn --factory app.main:create_app --reload --loop asyncio:SelectorEventLoop
"""

import asyncio
import logging
import sys
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.api import (
    admin,
    admin_rules,
    auth,
    codes,
    contacts,
    devices,
    errors,
    gates,
    meta,
    outings,
    profile,
    records,
    sessions,
    ws,
)
from app.config import Settings, load_settings
from app.db import make_engine, make_sessionmaker
from app.email import make_mailer
from app.email_templates import set_logo, set_reply_to
from app.jobs import expiry
from app.push import make_push_sender
from app.realtime import Hub
from app.security.breached import make_breach_checker
from app.security.rate_limit import RateLimiter

HEALTH_CACHE_SECONDS = 5.0
HEALTH_DB_TIMEOUT_SECONDS = 3.0  # the longest /health waits for the database's answer


def configure_logging() -> None:
    """Send the app's own log lines (`app.*`, INFO and up) to stderr.

    uvicorn configures only its own loggers, so without this every `app.*` line went to
    Python's last-resort handler, which drops anything below WARNING. Idempotent: one
    handler however many apps are created (tests make many). Records still propagate, so
    pytest's caplog sees them.
    """
    log = logging.getLogger("app")
    log.setLevel(logging.INFO)
    if not any(getattr(h, "_lumiback", False) for h in log.handlers):
        handler = logging.StreamHandler(sys.stderr)
        handler.setFormatter(logging.Formatter("%(levelname)s %(name)s: %(message)s"))
        handler._lumiback = True  # type: ignore[attr-defined]
        log.addHandler(handler)


def create_app(settings: Settings | None = None, *, start_jobs: bool = True) -> FastAPI:
    """`start_jobs=False` lets tests run the expiry sweep deterministically themselves."""
    settings = settings or load_settings()
    configure_logging()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = make_engine(settings.database_url.get_secret_value())
        app.state.sessionmaker = make_sessionmaker(engine)
        app.state.limiter = RateLimiter(
            app.state.sessionmaker, settings.code_pepper.get_secret_value()
        )
        app.state.sweep_health = expiry.SweepHealth() if start_jobs else None
        sweeper = (
            asyncio.create_task(
                expiry.run_forever(
                    app.state.sessionmaker,
                    app.state.hub,
                    app.state.push,
                    app.state.mailer,
                    settings.web_url,
                    health=app.state.sweep_health,
                    pepper=settings.code_pepper.get_secret_value(),
                    digest_to=settings.error_digest_email,
                )
            )
            if start_jobs
            else None
        )
        app.state.sweeper = sweeper
        try:
            yield
        finally:
            if sweeper is not None:
                sweeper.cancel()
                with suppress(asyncio.CancelledError):
                    await sweeper
            await engine.dispose()

    app = FastAPI(
        title="Lumiback API",
        version="0.1.0",
        lifespan=lifespan,
        # Interactive docs only outside production.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.state.settings = settings
    app.state.hub = Hub()
    app.state.mailer = make_mailer(settings)
    set_reply_to(settings.email_reply_to)  # emails invite replies only when they can arrive
    set_logo(settings.web_url)  # the website serves the icon the emails show
    app.state.push = make_push_sender(settings)
    app.state.breaches = make_breach_checker(settings.breach_check)
    app.state.health_clock = time.monotonic  # tests swap in a hand-moved clock
    app.state.health_db = None  # (checked at, database answered) for GET /health
    app.state.health_lock = asyncio.Lock()
    app.state.health_db_timeout = HEALTH_DB_TIMEOUT_SECONDS

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        # X-Kiosk-Token: gate kiosks call /kiosk/qr straight from the browser. X-View-As-Role:
        # a developer's read-only view of another role's screens (api/deps.py).
        allow_headers=["Authorization", "Content-Type", "X-Kiosk-Token", "X-View-As-Role"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI's default 422 echoes the submitted values ("input"), which would send passwords
        # and tokens back into client logs. Return only where and why validation failed.
        errors = [{k: e[k] for k in ("type", "loc", "msg") if k in e} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.get("/health")
    async def health(request: Request) -> JSONResponse:
        """For the host's health check and an uptime pinger. Touches the database, so a ping
        also counts as activity there (free Postgres tiers pause idle projects).

        "sweep" says whether the background sweep (late alerts, escalations, expiry) has
        finished recently: "ok", "stale", or "off" when this process doesn't run it. A stale
        sweep still answers 200 on purpose. Render restarts a service whose health check
        fails, and a restart rarely fixes what stalls a sweep (a bad row, a slow query, an
        email or push outage); failing here would take sign-in and check-out down with it, in
        a loop. The keep-awake Worker reads this field and emails the owner instead.

        Anyone can call this, so the database answer is kept for HEALTH_CACHE_SECONDS: a flood
        of pings costs one query per interval, not one pooled connection each. The sweep field
        is always current (it reads only memory).
        """
        state = request.app.state
        # One check at a time: pings arriving while it runs wait for its answer instead of
        # each taking a connection.
        async with state.health_lock:
            now = state.health_clock()
            if state.health_db is None or now - state.health_db[0] >= HEALTH_CACHE_SECONDS:
                try:
                    # A hung database answers "unavailable" (and is cached like any failure)
                    # rather than holding this ping, and every one queued behind the lock.
                    async with asyncio.timeout(state.health_db_timeout):
                        async with state.sessionmaker() as db:
                            await db.execute(text("SELECT 1"))
                    db_ok = True
                except Exception:  # TimeoutError included
                    db_ok = False
                state.health_db = (now, db_ok)
        if not state.health_db[1]:
            return JSONResponse(status_code=503, content={"status": "database unavailable"})
        health = getattr(request.app.state, "sweep_health", None)
        sweep = health.status() if health is not None else "off"
        return JSONResponse(content={"status": "ok", "sweep": sweep})

    app.include_router(auth.router)
    app.include_router(contacts.router)
    app.include_router(sessions.router)
    app.include_router(codes.router)
    app.include_router(ws.router)
    app.include_router(outings.router)
    app.include_router(gates.router)
    app.include_router(admin.router)
    app.include_router(admin_rules.router)
    app.include_router(records.router)
    app.include_router(profile.router)
    app.include_router(devices.router)
    app.include_router(meta.router)
    app.include_router(errors.router)

    return app
