"""Small helpers shared by API tests."""

import re

from fastapi.testclient import TestClient
from sqlalchemy import text

PASSWORD = "correct-horse-battery"


def last_code(client: TestClient, email: str) -> str:
    """The most recent verification code emailed to this address."""
    sent = [m for m in client.app.state.mailer.outbox if m.to == email.lower()]
    assert sent, f"no email sent to {email}"
    match = re.search(r"code is (\d{6})", sent[-1].body)
    assert match, sent[-1].body
    return match.group(1)


def verify(client: TestClient, email: str) -> dict:
    r = client.post("/auth/verify-email", json={"email": email, "code": last_code(client, email)})
    assert r.status_code == 200, r.text
    return r.json()


def register(
    client: TestClient, email: str, name: str = "Test User", *, verified: bool = True
) -> dict:
    """Sign up and (by default) verify. The account exists only after verification."""
    r = client.post("/auth/register", json={"name": name, "email": email, "password": PASSWORD})
    assert r.status_code == 202, r.text
    return verify(client, email) if verified else r.json()


def login(client: TestClient, email: str, password: str = PASSWORD) -> dict:
    r = client.post("/auth/login", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def auth_header(tokens: dict) -> dict[str, str]:
    return {"Authorization": f"Bearer {tokens['access_token']}"}


def signup(client: TestClient, email: str, name: str = "Test User") -> tuple[dict, dict]:
    """Register + login. Returns (user, headers)."""
    user = register(client, email, name)
    return user, auth_header(login(client, email))


def befriend(client: TestClient, owner: dict, contact_email: str, contact: dict) -> None:
    """owner invites contact_email; the contact accepts."""
    invite = client.post("/contacts", json={"email": contact_email}, headers=owner).json()
    r = client.post(f"/contacts/{invite['id']}/accept", headers=contact)
    assert r.status_code == 200, r.text


def share_with(client: TestClient, sharer: dict, viewer_ids: list[str], minutes: int = 60) -> dict:
    r = client.post(
        "/sessions",
        json={"source": "manual", "duration_minutes": minutes, "viewer_user_ids": viewer_ids},
        headers=sharer,
    )
    assert r.status_code == 201, r.text
    return r.json()


def make_admin(db, email: str) -> None:
    """Promote directly in the database (the first admin comes from a script, not the API)."""
    db.execute(text("UPDATE users SET role = 'admin' WHERE email = :e"), {"e": email.lower()})
    db.commit()


GATE = {"name": "Main Gate", "lat": 30.2683, "lng": 77.9950, "radius_m": 75}


def create_gate(client: TestClient, admin: dict, **overrides) -> dict:
    """Returns {"gate": {...}, "kiosk_token": "..."}."""
    r = client.post("/admin/gates", json={**GATE, **overrides}, headers=admin)
    assert r.status_code == 201, r.text
    return r.json()


def kiosk_qr(client: TestClient, kiosk_token: str) -> str:
    r = client.get("/kiosk/qr", headers={"X-Kiosk-Token": kiosk_token})
    assert r.status_code == 200, r.text
    return r.json()["qr"]


# ---------- outing rules ----------

IST_OFFSET_MIN = 330


def ist_now_minutes() -> int:
    """Minutes since midnight on the campus clock, right now."""
    from datetime import UTC, datetime, timedelta

    t = datetime.now(UTC) + timedelta(minutes=IST_OFFSET_MIN)
    return t.hour * 60 + t.minute


def hhmm(minutes: int) -> str:
    return f"{minutes // 60:02d}:{minutes % 60:02d}"


def set_rules(
    db,
    state: str = "open",
    *,
    max_minutes: int | None = None,
    needs_form: bool = False,
    free: bool = False,
) -> dict[str, str]:
    """Today's rules for students on the default rule set, placed around the current IST time
    so they fit inside today at any hour the suite runs:
      "open"     opened before now; closes later today
      "closed"   closed a few minutes ago
      "not_yet"  opens in a few minutes
    Applies to every day type. `free` (with needs_form): no form needed from the opening time,
    like a no-form evening that has already started. Returns the chosen times ("HH:MM")."""
    import pytest

    now, last = ist_now_minutes(), 23 * 60 + 59
    if state == "open":
        if last - now < 10:
            pytest.skip("too close to midnight IST to fit an open window")
        opens = max(0, now - 60)
        return_by = last
    elif state == "closed":
        if now < 10:
            pytest.skip("too soon after midnight IST for a window that already closed")
        opens, return_by = 0, now - 5
    elif state == "not_yet":
        if last - now < 10:
            pytest.skip("too close to midnight IST for a window that opens later")
        opens, return_by = now + 5, last
    else:
        raise ValueError(state)
    times = {"opens": hhmm(opens), "return_by": hhmm(return_by)}
    db.execute(
        text(
            "UPDATE day_rules SET opens_at = CAST(:opens AS time), "
            "return_by = CAST(:return_by AS time), max_minutes = :m, needs_form = :f, "
            "no_form_from = CASE WHEN :free THEN CAST(:opens AS time) END"
        ),
        {**times, "m": max_minutes, "f": needs_form, "free": free},
    )
    db.commit()
    return times
