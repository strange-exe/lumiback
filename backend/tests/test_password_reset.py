"""Forgot password: emailed code, new password, everyone signed out, nothing leaked."""

import re

from sqlalchemy import text

from app.jobs.expiry import sweep
from tests.helpers import PASSWORD, login, register, signup

NEW_PASSWORD = "lantern-by-the-gate-42"


def mails_to(client, email: str) -> list:
    return [m for m in client.app.state.mailer.outbox if m.to == email]


def reset_code(client, email: str) -> str:
    sent = mails_to(client, email)
    assert sent, f"no email to {email}"
    match = re.search(r"reset code is (\d{6})", sent[-1].body)
    assert match, sent[-1].body
    return match.group(1)


def forgot(client, email: str):
    return client.post("/auth/forgot-password", json={"email": email})


def reset(client, email: str, code: str, password: str = NEW_PASSWORD):
    return client.post(
        "/auth/reset-password", json={"email": email, "code": code, "password": password}
    )


def test_reset_sets_a_new_password_and_signs_out_everywhere(client):
    register(client, "riya@example.com", "Riya Sharma")
    old_session = login(client, "riya@example.com")
    sent_before = len(client.app.state.mailer.outbox)

    assert forgot(client, "Riya@Example.com").status_code == 202
    assert len(client.app.state.mailer.outbox) == sent_before + 1
    mail = mails_to(client, "riya@example.com")[-1]
    assert "password reset code" in mail.body
    assert "Hi Riya," in mail.body

    assert (
        reset(client, "riya@example.com", reset_code(client, "riya@example.com")).status_code == 204
    )
    assert (
        client.post(
            "/auth/login", json={"email": "riya@example.com", "password": PASSWORD}
        ).status_code
        == 401
    )
    assert login(client, "riya@example.com", NEW_PASSWORD)["access_token"]
    refreshed = client.post("/auth/refresh", json={"refresh_token": old_session["refresh_token"]})
    assert refreshed.status_code == 401  # the old device was signed out


def test_unknown_and_unverified_emails_look_the_same_and_get_nothing(client):
    register(client, "pending@example.com", "Pending", verified=False)
    sent_before = len(client.app.state.mailer.outbox)
    for email in ("nobody@example.com", "pending@example.com"):
        assert forgot(client, email).status_code == 202
    assert len(client.app.state.mailer.outbox) == sent_before


def test_a_code_is_single_use(client):
    signup(client, "riya@example.com", "Riya")
    forgot(client, "riya@example.com")
    code = reset_code(client, "riya@example.com")
    assert reset(client, "riya@example.com", code).status_code == 204
    assert reset(client, "riya@example.com", code, "another-fine-passphrase").status_code == 400


def test_a_newer_request_replaces_the_older_code(client, db):
    signup(client, "riya@example.com", "Riya")
    forgot(client, "riya@example.com")
    first = reset_code(client, "riya@example.com")
    forgot(client, "riya@example.com")
    second = reset_code(client, "riya@example.com")
    if first != second:
        assert reset(client, "riya@example.com", first).status_code == 400
    assert reset(client, "riya@example.com", second).status_code == 204
    assert db.execute(text("SELECT count(*) FROM password_resets")).scalar_one() == 0


def test_five_wrong_tries_kill_the_code(client):
    signup(client, "riya@example.com", "Riya")
    forgot(client, "riya@example.com")
    code = reset_code(client, "riya@example.com")
    wrong = "000000" if code != "000000" else "111111"
    for _ in range(5):
        assert reset(client, "riya@example.com", wrong).status_code == 400
    assert reset(client, "riya@example.com", code).status_code == 400


def test_an_expired_code_fails(client, db):
    signup(client, "riya@example.com", "Riya")
    forgot(client, "riya@example.com")
    code = reset_code(client, "riya@example.com")
    db.execute(
        text(
            "UPDATE password_resets SET created_at = now() - interval '1 hour', "
            "expires_at = now() - interval '1 minute'"
        )
    )
    db.commit()
    assert reset(client, "riya@example.com", code).status_code == 400


def test_a_weak_password_is_refused_without_using_up_the_code(client):
    signup(client, "riya@example.com", "Riya Sharma")
    forgot(client, "riya@example.com")
    code = reset_code(client, "riya@example.com")
    weak = reset(client, "riya@example.com", code, "password123")
    assert weak.status_code == 422
    assert weak.json()["detail"].startswith("Password ")
    assert reset(client, "riya@example.com", code, "riya-sharma-rocks").status_code == 422
    assert reset(client, "riya@example.com", code).status_code == 204


def test_reset_lifts_a_login_lockout(client):
    signup(client, "riya@example.com", "Riya")
    for _ in range(5):
        client.post(
            "/auth/login", json={"email": "riya@example.com", "password": "wrong-guess-here"}
        )
    assert (
        client.post(
            "/auth/login", json={"email": "riya@example.com", "password": PASSWORD}
        ).status_code
        == 429
    )
    forgot(client, "riya@example.com")
    assert (
        reset(client, "riya@example.com", reset_code(client, "riya@example.com")).status_code == 204
    )
    assert login(client, "riya@example.com", NEW_PASSWORD)["access_token"]


def test_requests_are_rate_limited_per_email(client):
    signup(client, "riya@example.com", "Riya")
    for _ in range(3):
        assert forgot(client, "riya@example.com").status_code == 202
    assert forgot(client, "riya@example.com").status_code == 429


def test_the_sweep_deletes_expired_codes(client, db):
    signup(client, "riya@example.com", "Riya")
    forgot(client, "riya@example.com")
    db.execute(
        text(
            "UPDATE password_resets SET created_at = now() - interval '1 hour', "
            "expires_at = now() - interval '1 minute'"
        )
    )
    db.commit()
    result = client.portal.call(sweep, client.app.state.sessionmaker, client.app.state.hub)
    assert result.deleted_password_resets == 1
    assert db.execute(text("SELECT count(*) FROM password_resets")).scalar_one() == 0
