"""App factory.

Run (dev):  uv run uvicorn --factory app.main:create_app --reload --loop asyncio:SelectorEventLoop
"""

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api import auth, codes, contacts, sessions, ws
from app.config import Settings, load_settings
from app.db import make_engine, make_sessionmaker
from app.jobs import expiry
from app.realtime import Hub
from app.security.rate_limit import RateLimiter


def create_app(settings: Settings | None = None, *, start_jobs: bool = True) -> FastAPI:
    """`start_jobs=False` lets tests run the expiry sweep deterministically themselves."""
    settings = settings or load_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = make_engine(settings.database_url.get_secret_value())
        app.state.sessionmaker = make_sessionmaker(engine)
        sweeper = (
            asyncio.create_task(expiry.run_forever(app.state.sessionmaker, app.state.hub))
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
        title="Outing API",
        version="0.1.0",
        lifespan=lifespan,
        # Interactive docs only outside production.
        docs_url=None if settings.is_production else "/docs",
        redoc_url=None,
        openapi_url=None if settings.is_production else "/openapi.json",
    )
    app.state.settings = settings
    app.state.limiter = RateLimiter()
    app.state.hub = Hub()

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        # FastAPI's default 422 echoes the submitted values ("input"), which would send passwords
        # and tokens back into client logs. Return only where and why validation failed.
        errors = [{k: e[k] for k in ("type", "loc", "msg") if k in e} for e in exc.errors()]
        return JSONResponse(status_code=422, content={"detail": errors})

    @app.get("/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    app.include_router(auth.router)
    app.include_router(contacts.router)
    app.include_router(sessions.router)
    app.include_router(codes.router)
    app.include_router(ws.router)

    return app
