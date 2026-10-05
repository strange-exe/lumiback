"""A1 — the app refuses to start without valid secrets, and never echoes them."""

import pytest
from fastapi.testclient import TestClient

from app.config import ConfigError, load_settings
from app.main import create_app

STRONG = "t3st-only-" + "x7Kq9Zp2" * 5  # 50 chars, fake
VALID_ENV = {
    "DATABASE_URL": "postgresql+psycopg://u:p@localhost:5432/outing_test",
    "JWT_SECRET": STRONG,
    "CODE_PEPPER": STRONG[::-1],
    "CORS_ORIGINS": "http://localhost:3000, https://outing.example.com/",
    # A valid production setup must deliver real email.
    "EMAIL_BACKEND": "smtp",
    "SMTP_HOST": "smtp.example.com",
    "SMTP_USERNAME": "mailer",
    "SMTP_PASSWORD": "fake-smtp-password",
    "EMAIL_FROM": "Lumiback <no-reply@example.com>",
}
OPTIONAL = ["APP_ENV", "ALLOWED_EMAIL_DOMAINS", "SMTP_PORT"]


@pytest.fixture
def env(monkeypatch):
    """Isolated environment: wipe related vars, set valid ones, never read backend/.env."""
    for key in [*VALID_ENV, *OPTIONAL]:
        monkeypatch.delenv(key, raising=False)
    for key, value in VALID_ENV.items():
        monkeypatch.setenv(key, value)
    return monkeypatch


def load():
    return load_settings(env_file=None)


def test_valid_env_loads(env):
    s = load()
    assert s.cors_origins == ["http://localhost:3000", "https://outing.example.com"]


def test_cors_accepts_json_list(env):
    env.setenv("CORS_ORIGINS", '["http://localhost:3000", "https://outing.example.com/"]')
    assert load().cors_origins == ["http://localhost:3000", "https://outing.example.com"]


def test_defaults_to_production(env):
    assert load().is_production


@pytest.mark.parametrize("key", ["DATABASE_URL", "JWT_SECRET", "CODE_PEPPER", "CORS_ORIGINS"])
def test_missing_required_var_refuses_to_start(env, key):
    env.delenv(key)
    with pytest.raises(ConfigError) as exc:
        load()
    assert key in str(exc.value)


@pytest.mark.parametrize("key", ["JWT_SECRET", "CODE_PEPPER"])
@pytest.mark.parametrize(
    "weak", ["", "short-secret-123", "a" * 31, "a" * 40, "changeme" * 5, "é" * 20]
)
def test_weak_secret_refuses_to_start_without_echoing_it(env, key, weak):
    env.setenv(key, weak)
    with pytest.raises(ConfigError) as exc:
        load()
    msg = str(exc.value)
    assert key in msg
    if weak:
        assert weak not in msg


def test_generated_secrets_are_never_rejected(env):
    # A false rejection blocks a production deploy, so check many real ones.
    import secrets

    for _ in range(500):
        env.setenv("JWT_SECRET", secrets.token_urlsafe(48))
        load()


@pytest.mark.parametrize(
    "url", ["sqlite:///./dev.db", "mysql://u:p@h/db", "postgresql://u:p@h/db", "not a url"]
)
def test_non_postgres_database_refuses_to_start(env, url):
    env.setenv("DATABASE_URL", url)
    with pytest.raises(ConfigError) as exc:
        load()
    assert "DATABASE_URL" in str(exc.value)
    assert "u:p" not in str(exc.value)  # credentials never echoed


@pytest.mark.parametrize(
    "origins", ["*", "[not json", "", "localhost:3000", "https://ok.com,*", "https://a.com/path"]
)
def test_wildcard_or_malformed_cors_refuses_to_start(env, origins):
    env.setenv("CORS_ORIGINS", origins)
    with pytest.raises(ConfigError) as exc:
        load()
    assert "CORS_ORIGINS" in str(exc.value)


def test_cors_allows_only_listed_origins(env):
    client = TestClient(create_app(load()))
    ok = client.get("/health", headers={"Origin": "http://localhost:3000"})
    bad = client.get("/health", headers={"Origin": "https://evil.example"})
    assert ok.json() == {"status": "ok"}
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    assert "access-control-allow-origin" not in bad.headers


def test_docs_hidden_in_production(env):
    assert TestClient(create_app(load())).get("/docs").status_code == 404
    env.setenv("APP_ENV", "development")
    assert TestClient(create_app(load())).get("/docs").status_code == 200


# ---------- email delivery and allowed domains ----------


def test_console_email_is_refused_in_production(env):
    env.setenv("EMAIL_BACKEND", "console")
    with pytest.raises(ConfigError) as exc:
        load()
    assert "EMAIL_BACKEND=console" in str(exc.value)
    env.setenv("APP_ENV", "development")
    assert load().email_backend == "console"


@pytest.mark.parametrize("key", ["SMTP_HOST", "SMTP_USERNAME", "SMTP_PASSWORD", "EMAIL_FROM"])
def test_smtp_requires_all_settings(env, key):
    env.delenv(key)
    with pytest.raises(ConfigError) as exc:
        load()
    assert key in str(exc.value)
    assert "fake-smtp-password" not in str(exc.value)


def test_university_domain_is_the_default(env):
    assert load().allowed_email_domains == ["geu.ac.in"]


def test_allowed_domains_are_normalized(env):
    env.setenv("ALLOWED_EMAIL_DOMAINS", "@GEU.ac.in, example.com")
    assert load().allowed_email_domains == ["geu.ac.in", "example.com"]


@pytest.mark.parametrize("domains", ["", "geu", "someone@geu.ac.in", "geu.ac.in/x"])
def test_malformed_domains_refused(env, domains):
    env.setenv("ALLOWED_EMAIL_DOMAINS", domains)
    with pytest.raises(ConfigError) as exc:
        load()
    assert "ALLOWED_EMAIL_DOMAINS" in str(exc.value)
