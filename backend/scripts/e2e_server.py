"""Run the API against the LOCAL test database, for browser end-to-end tests.

    uv run python scripts/e2e_server.py [--reset] [--seed]

Uses TEST_DATABASE_URL (must be localhost and end in _test, see TestDbSettings) so end-to-end
tests never touch the real database. --reset empties every table; --seed then adds two verified
demo students (e2e@geu.ac.in, and e2e-delete@geu.ac.in for the account-deletion test) so
tests can sign in without reading an email. It also adds an admin (e2e-admin@geu.ac.in) and one
gate, "North Gate", whose kiosk token is fixed so the kiosk page can be opened directly.
"""

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import uvicorn  # noqa: E402
from sqlalchemy import create_engine, text  # noqa: E402

from app.config import TestDbSettings  # noqa: E402
from app.models import Base  # noqa: E402
from app.security.gate_codes import hash_kiosk_token  # noqa: E402
from app.security.passwords import hash_password  # noqa: E402

E2E_EMAIL = "e2e@geu.ac.in"
DELETABLE_EMAIL = "e2e-delete@geu.ac.in"  # the account-deletion test may erase this one
E2E_PASSWORD = "lantern-at-dusk-2029"  # noqa: S105 - test-only, local *_test database
ADMIN_EMAIL = "e2e-admin@geu.ac.in"
KIOSK_TOKEN = "e2e-kiosk-token-north-gate-0000000000"  # noqa: S105 - test-only


def reset_and_seed(url: str, seed: bool) -> None:
    engine = create_engine(url)
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        if seed:
            conn.execute(
                text(
                    "INSERT INTO users (name, email, password_hash, hostel, email_verified_at) "
                    "VALUES ('Riya Sharma', :email, :hash, 'Hostel 3', now())"
                ),
                {"email": E2E_EMAIL, "hash": hash_password(E2E_PASSWORD)},
            )
            conn.execute(
                text(
                    "INSERT INTO users (name, email, password_hash, email_verified_at) "
                    "VALUES ('Kabir Mehta', :email, :hash, now())"
                ),
                {"email": DELETABLE_EMAIL, "hash": hash_password(E2E_PASSWORD)},
            )
            conn.execute(
                text(
                    "INSERT INTO users (name, email, password_hash, role, email_verified_at) "
                    "VALUES ('Asha Rawat', :email, :hash, 'admin', now())"
                ),
                {"email": ADMIN_EMAIL, "hash": hash_password(E2E_PASSWORD)},
            )
            conn.execute(
                text(
                    "INSERT INTO gates (name, lat, lng, radius_m, kiosk_token_hash) "
                    "VALUES ('North Gate', 30.2687, 77.9947, 75, :hash)"
                ),
                {"hash": hash_kiosk_token(KIOSK_TOKEN)},
            )
    engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--port", type=int, default=8100)
    args = parser.parse_args()

    url = TestDbSettings().test_database_url.get_secret_value()  # refuses non-local URLs
    if args.reset or args.seed:
        reset_and_seed(url, args.seed)

    os.environ["DATABASE_URL"] = url
    os.environ["APP_ENV"] = "development"
    os.environ["EMAIL_BACKEND"] = "console"
    loop = "asyncio:SelectorEventLoop" if sys.platform == "win32" else "auto"
    uvicorn.run("app.main:create_app", factory=True, host="127.0.0.1", port=args.port, loop=loop)


if __name__ == "__main__":
    main()
