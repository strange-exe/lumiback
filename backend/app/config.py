"""Application settings.

Rules (PLAN.md §4.2):
- Required secrets have NO defaults. Missing or weak -> the process refuses to start.
- Error messages name the variable and the reason, never its value.
- APP_ENV defaults to production (fail closed).
"""

import json
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import SecretStr, ValidationError, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict

MIN_SECRET_BYTES = 32
# token_urlsafe(48) yields ~40 distinct chars; this only catches "changeme"*5 / "a"*40.
MIN_DISTINCT_CHARS = 10
ALLOWED_DB_SCHEMES = {"postgresql+psycopg"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    database_url: SecretStr
    jwt_secret: SecretStr
    code_pepper: SecretStr
    cors_origins: Annotated[list[str], NoDecode]
    app_env: Literal["development", "production"] = "production"

    @field_validator("jwt_secret", "code_pepper")
    @classmethod
    def _strong_secret(cls, v: SecretStr) -> SecretStr:
        # Messages describe the problem only; the value must never appear in them.
        raw = v.get_secret_value()
        if len(raw.encode("utf-8")) < MIN_SECRET_BYTES:
            raise ValueError(f"must be at least {MIN_SECRET_BYTES} bytes")
        if len(set(raw)) < MIN_DISTINCT_CHARS:
            raise ValueError("looks like a placeholder (too few distinct characters)")
        return v

    @field_validator("database_url")
    @classmethod
    def _postgres_only(cls, v: SecretStr) -> SecretStr:
        # No silent fallback to SQLite or another engine.
        scheme = urlsplit(v.get_secret_value()).scheme
        if scheme not in ALLOWED_DB_SCHEMES:
            raise ValueError(f"scheme must be one of {sorted(ALLOWED_DB_SCHEMES)}, got '{scheme}'")
        return v

    @field_validator("cors_origins", mode="before")
    @classmethod
    def _parse_origins(cls, v: object) -> list[str]:
        # Accept "a, b" or a JSON list '["a", "b"]'.
        raw = v.strip() if isinstance(v, str) else v
        if isinstance(raw, str) and raw.startswith("["):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                raise ValueError("looks like a JSON list but is not valid JSON") from None
        items = raw if isinstance(raw, list) else str(raw).split(",")
        origins = [str(o).strip().rstrip("/") for o in items if str(o).strip()]
        if not origins:
            raise ValueError("at least one origin is required")
        for o in origins:
            parts = urlsplit(o)
            if o == "*" or parts.scheme not in {"http", "https"} or not parts.netloc or parts.path:
                raise ValueError(f"'{o}' is not an explicit origin like https://example.com")
        return origins

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"


LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1"}


class TestDbSettings(BaseSettings):
    """TEST_DATABASE_URL for tests and `alembic -x db=test`. Tests DROP and recreate its schema,
    so it must point at a local database whose name ends in `_test` — never Supabase."""

    __test__ = False  # not a pytest test class
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    test_database_url: SecretStr

    @field_validator("test_database_url")
    @classmethod
    def _local_test_db_only(cls, v: SecretStr) -> SecretStr:
        parts = urlsplit(v.get_secret_value())
        if parts.scheme not in ALLOWED_DB_SCHEMES:
            raise ValueError(f"scheme must be one of {sorted(ALLOWED_DB_SCHEMES)}")
        if parts.hostname not in LOCAL_HOSTS:
            raise ValueError("must point at a local database (localhost)")
        if not parts.path.rstrip("/").endswith("_test"):
            raise ValueError("database name must end with '_test'")
        return v


class ConfigError(SystemExit):
    """Raised at startup when settings are invalid. Exits the process with a clear message."""


def load_settings(env_file: str | None = ".env") -> Settings:
    try:
        return Settings(_env_file=env_file)  # type: ignore[call-arg]
    except ValidationError as e:
        # Rebuild the message ourselves: pydantic's default text includes input values,
        # which would print secrets into logs.
        lines = [
            f"  - {'.'.join(str(p) for p in err['loc']).upper()}: {err['msg']}"
            for err in e.errors(include_input=False, include_url=False, include_context=False)
        ]
        raise ConfigError("Refusing to start: invalid configuration\n" + "\n".join(lines)) from None
