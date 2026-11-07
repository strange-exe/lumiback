"""Make an existing, verified account a developer: every admin power, plus a read-only "view as"
any other account. This script is the only way to grant it; the dashboard can't give, change
or remove the role.

    uv run python scripts/make_developer.py dev@geu.ac.in

Reads DATABASE_URL like the API does (backend/.env locally, or the service's environment, e.g. a
Render shell). The person must have signed up and verified their email first. The grant is
recorded in admin_audit (action "developer.grant", no actor: it came from the server).
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine, text  # noqa: E402

from app.config import Settings  # noqa: E402


def make_developer(url: str, email: str) -> str:
    engine = create_engine(url)
    try:
        with engine.begin() as conn:
            row = conn.execute(
                text(
                    "SELECT role, email_verified_at IS NOT NULL, deactivated_at IS NULL "
                    "FROM users WHERE email = :email FOR UPDATE"
                ),
                {"email": email},
            ).one_or_none()
            if row is None:
                return f"No account for {email}. Sign up in the app first."
            role, verified, active = row
            if not verified:
                return f"{email} hasn't verified their email yet."
            if not active:
                return f"{email} is turned off. Turn it back on first."
            if role == "developer":
                return f"{email} is already a developer."
            if role == "admin":
                # A developer isn't campus staff: an admin who can sign in must be left.
                others = conn.execute(
                    text(
                        "SELECT count(*) FROM users WHERE role = 'admin' AND email <> :email "
                        "AND email_verified_at IS NOT NULL AND deactivated_at IS NULL"
                    ),
                    {"email": email},
                ).scalar_one()
                if not others:
                    return f"{email} is the only admin. Make someone else an admin first."
            conn.execute(
                text("UPDATE users SET role = 'developer' WHERE email = :email"), {"email": email}
            )
            # A developer has no hostels of their own (as with an admin).
            conn.execute(
                text(
                    "DELETE FROM warden_hostels WHERE user_id = "
                    "(SELECT id FROM users WHERE email = :email)"
                ),
                {"email": email},
            )
            conn.execute(
                text(
                    "INSERT INTO admin_audit (actor_id, action, target) "
                    "VALUES (NULL, 'developer.grant', :target)"
                ),
                {"target": f"{email} (was {role})"[:160]},
            )
            return f"{email} is now a developer."
    finally:
        engine.dispose()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("email")
    args = parser.parse_args()
    settings = Settings(_env_file=Path(__file__).resolve().parents[1] / ".env")  # type: ignore[call-arg]
    print(make_developer(settings.database_url.get_secret_value(), args.email.strip().lower()))


if __name__ == "__main__":
    main()
