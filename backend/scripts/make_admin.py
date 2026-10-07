"""Make an existing, verified account an admin. Used once, for the first admin; after that,
admins promote others from the dashboard.

    uv run python scripts/make_admin.py warden@geu.ac.in

Reads DATABASE_URL like the API does (backend/.env locally, or the service's environment, e.g. a
Render shell). The person must have signed up and verified their email first.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text  # noqa: E402

from app.config import Settings  # noqa: E402


def make_admin(url: str, email: str) -> str:
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    "SELECT role, email_verified_at IS NOT NULL FROM users "
                    "WHERE email = :email FOR UPDATE"
                ),
                {"email": email},
            ).one_or_none()
            if row is None:
                return f"No account for {email}. Sign up in the app first."
            role, verified = row
            if not verified:
                return f"{email} hasn't verified their email yet."
            if role == "admin":
                return f"{email} is already an admin."
            conn.execute(
                text("UPDATE users SET role = 'admin' WHERE email = :email"), {"email": email}
            )
            return f"{email} is now an admin."
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("email")
    args = parser.parse_args()
    settings = Settings(_env_file=Path(__file__).resolve().parents[1] / ".env")  # type: ignore[call-arg]
    print(make_admin(settings.database_url.get_secret_value(), args.email.strip().lower()))


if __name__ == "__main__":
    main()
