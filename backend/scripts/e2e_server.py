"""Run the API against the LOCAL test database, for browser end-to-end tests.

    uv run python scripts/e2e_server.py [--reset] [--seed [--demo]]

Uses TEST_DATABASE_URL (must be localhost and end in _test, see TestDbSettings) so end-to-end
tests never touch the real database. --reset empties every table; --seed then adds two verified
demo students (e2e@geu.ac.in, and e2e-delete@geu.ac.in for the account-deletion test) so
tests can sign in without reading an email. It also adds an admin (e2e-admin@geu.ac.in), one
gate, "North Gate", whose kiosk token is fixed so the kiosk page can be opened directly, and
"Hostel 3" with its warden (e2e-warden@geu.ac.in). --demo fills Hostel 3 with sample students
who are out, late, escalated or waiting on a request (for screenshots and demos).
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
WARDEN_EMAIL = "e2e-warden@geu.ac.in"  # warden of Hostel 3
KIOSK_TOKEN = "e2e-kiosk-token-north-gate-0000000000"  # noqa: S105 - test-only


def reset_and_seed(url: str, seed: bool, demo: bool = False) -> None:
    engine = create_engine(url)
    tables = ", ".join(t.name for t in Base.metadata.sorted_tables)
    with engine.begin() as conn:
        conn.execute(text(f"TRUNCATE {tables} RESTART IDENTITY CASCADE"))
        # Outings allowed all day as the default rules (TRUNCATE removed the migration's
        # seeds), so browser tests pass at any hour; rule behaviour is tested in pytest.
        rule_set = conn.execute(
            text("INSERT INTO rule_sets (name) VALUES ('E2E (always open)') RETURNING id")
        ).scalar_one()
        conn.execute(
            text(
                "INSERT INTO day_rules (rule_set_id, day_type, opens_at, return_by) "
                "SELECT :s, d, '00:00', '23:59' "
                "FROM unnest(ARRAY['weekday', 'saturday', 'sunday', 'holiday']) AS d"
            ),
            {"s": rule_set},
        )
        conn.execute(
            text("INSERT INTO campus_settings (id, default_rule_set_id) VALUES (1, :s)"),
            {"s": rule_set},
        )
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
            # A hostel with its warden. No seeded student lives there, so the warden's
            # register is empty unless --demo fills it.
            hostel = conn.execute(
                text(
                    "INSERT INTO hostels (name, rule_set_id, warden_name, warden_phone) "
                    "VALUES ('Hostel 3', :s, 'Meera Joshi', '+919876500003') RETURNING id"
                ),
                {"s": rule_set},
            ).scalar_one()
            warden = conn.execute(
                text(
                    "INSERT INTO users (name, email, password_hash, role, email_verified_at) "
                    "VALUES ('Meera Joshi', :email, :hash, 'warden', now()) RETURNING id"
                ),
                {"email": WARDEN_EMAIL, "hash": hash_password(E2E_PASSWORD)},
            ).scalar_one()
            conn.execute(
                text("INSERT INTO warden_hostels (user_id, hostel_id) VALUES (:u, :h)"),
                {"u": warden, "h": hostel},
            )
            if demo:
                seed_demo(conn, hostel, warden)
    engine.dispose()


# Sample students for screenshots and demos. Names and numbers are made up; this data only
# ever goes into the local *_test database.
DEMO = [
    # name, roll no., state, emergency contact
    ("Aarav Singh", "24011001", "out", "Neelam Singh"),
    ("Diya Patel", "24011002", "late", "Hetal Patel"),
    ("Ishaan Verma", "24011003", "escalated", "Sunita Verma"),
    ("Kavya Nair", "24011004", "pending", "Lakshmi Nair"),
    ("Rohan Gupta", "24011005", "approved", "Anil Gupta"),
    ("Sara Khan", "24011006", "back", "Rubina Khan"),
]


def seed_demo(conn, hostel, warden) -> None:
    """Hostel 3 on a busy evening: out, late, escalated, and today's requests."""
    gate = conn.execute(text("SELECT id FROM gates WHERE name = 'North Gate'")).scalar_one()
    for i, (name, roll, state, parent) in enumerate(DEMO, start=1):
        student = conn.execute(
            text(
                "INSERT INTO users (name, email, password_hash, roll_no, hostel_id, phone, "
                "emergency_name, emergency_relation, emergency_phone, email_verified_at) "
                "VALUES (:name, :email, :hash, :roll, :hostel, :phone, :parent, 'Parent', "
                ":ephone, now()) RETURNING id"
            ),
            {
                "name": name,
                "email": f"demo{i}@geu.ac.in",
                "hash": hash_password(E2E_PASSWORD),
                "roll": roll,
                "parent": parent,
                "hostel": hostel,
                "phone": f"+91900000000{i}",
                "ephone": f"+91900000010{i}",
            },
        ).scalar_one()
        params = {"s": student, "g": gate, "w": warden}
        if state in ("out", "late", "escalated", "back"):
            due = {"out": "1 hour", "late": "-25 minutes", "escalated": "-52 minutes"}.get(
                state, "-2 hours"
            )
            outing = conn.execute(
                text(
                    "INSERT INTO outings (student_id, destination, left_at, expected_return_at, "
                    "returned_at, out_via, out_gate_id, in_via, in_gate_id, overdue_notified_at) "
                    "VALUES (:s, 'Rajpur Road', now() - interval '3 hours', "
                    "now() + CAST(:due AS interval), "
                    "CASE WHEN :back THEN now() - interval '2 hours 10 minutes' END, "
                    "'gate', :g, CASE WHEN :back THEN 'gate' END, CASE WHEN :back THEN "
                    "CAST(:g AS uuid) END, "
                    "CASE WHEN :alerted THEN now() - interval '22 minutes' END) RETURNING id"
                ),
                {**params, "due": due, "back": state == "back", "alerted": state == "escalated"},
            ).scalar_one()
            conn.execute(
                text(
                    "INSERT INTO gate_scans (user_id, gate_id, direction, result, distance_m, "
                    "accuracy_m, outing_id, scanned_at) "
                    "VALUES (:s, :g, 'out', 'accepted', 18, 9, :o, now() - interval '3 hours')"
                ),
                {**params, "o": outing},
            )
            if state == "escalated":
                conn.execute(
                    text(
                        "INSERT INTO escalations (outing_id, created_at) "
                        "VALUES (:o, now() - interval '12 minutes')"
                    ),
                    {"o": outing},
                )
        if state in ("pending", "approved"):
            conn.execute(
                text(
                    "INSERT INTO outing_requests (student_id, day, purpose, phone, "
                    "emergency_name, emergency_relation, emergency_phone, requested_minutes, "
                    "status, decided_by, decided_at, created_at) "
                    "VALUES (:s, (now() AT TIME ZONE 'Asia/Kolkata')::date, "
                    "'Visiting family in Clement Town', :phone, :parent, 'Parent', :ephone, 120, "
                    ":status, "
                    "CASE WHEN :approved THEN CAST(:w AS uuid) END, "
                    "CASE WHEN :approved THEN now() - interval '1 hour' END, "
                    "now() - interval '2 hours')"
                ),
                {
                    **params,
                    "status": state,
                    "approved": state == "approved",
                    "parent": parent,
                    "phone": f"+91900000000{i}",
                    "ephone": f"+91900000010{i}",
                },
            )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--seed", action="store_true")
    parser.add_argument("--demo", action="store_true", help="with --seed: a busy Hostel 3")
    parser.add_argument("--port", type=int, default=8100)
    args = parser.parse_args()

    url = TestDbSettings().test_database_url.get_secret_value()  # refuses non-local URLs
    if args.reset or args.seed:
        reset_and_seed(url, args.seed, args.demo)

    os.environ["DATABASE_URL"] = url
    os.environ["APP_ENV"] = "development"
    os.environ["EMAIL_BACKEND"] = "console"
    loop = "asyncio:SelectorEventLoop" if sys.platform == "win32" else "auto"
    uvicorn.run("app.main:create_app", factory=True, host="127.0.0.1", port=args.port, loop=loop)


if __name__ == "__main__":
    main()
