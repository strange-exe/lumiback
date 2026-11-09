"""Error reports (wave 4): the website and the app send what broke; the API scrubs it before
storing, groups it, keeps it 30 days and emails a daily digest when ERROR_DIGEST_EMAIL is set."""

import json
import time

import pytest
from pydantic import ValidationError
from sqlalchemy import text

from app.api import errors as errors_api
from app.config import Settings
from app.jobs.expiry import sweep
from app.security.rate_limit import Limit
from app.services import error_reports
from tests.conftest import FAKE_SECRET
from tests.helpers import signup
from tests.test_alerts import LATE_31, go_out
from tests.test_view_as import as_, make_developer

STACK = (
    "TypeError: Cannot read properties of undefined (reading 'name')\n"
    "    at OutView (https://lumiback.test/_next/static/chunks/app/page-1a2b3c4d5e6f7a8b.js:1:2345)\n"
    "    at renderWithHooks (https://lumiback.test/_next/static/chunks/react.js:9:100)"
)


def body(**overrides) -> dict:
    return {
        "message": "Cannot read properties of undefined (reading 'name')",
        "stack": STACK,
        "route": "/home",
        "app_version": "1.18.0",
        "platform": "web",
        **overrides,
    }


def post(client, headers=None, **overrides):
    return client.post("/errors", json=body(**overrides), headers=headers or {})


def groups(db) -> list[dict]:
    rows = db.execute(
        text(
            "SELECT message, top_frame, stack, route, platform, app_version, count, "
            "first_seen_at, last_seen_at, last_user_id FROM error_reports ORDER BY id"
        )
    ).mappings()
    return [dict(r) for r in rows]


@pytest.fixture
def dev(client, db):
    headers = signup(client, "dev@geu.ac.in", "Dev Eloper")[1]
    make_developer(db, "dev@geu.ac.in")
    return headers


def run_sweep(client, digest_to=None):
    state = client.app.state
    return client.portal.call(
        lambda: sweep(
            state.sessionmaker,
            state.hub,
            state.push,
            state.mailer,
            "https://lumiback.test",
            digest_to=digest_to,
        )
    )


# ---------- receiving ----------


def test_a_report_is_stored_without_signing_in(client, db):
    r = post(client)
    assert r.status_code == 204, r.text
    [group] = groups(db)
    assert group["message"] == "Cannot read properties of undefined (reading 'name')"
    assert group["top_frame"].startswith("at OutView (https://lumiback.test/_next/")
    assert group["route"] == "/home"
    assert group["platform"] == "web"
    assert group["app_version"] == "1.18.0"
    assert group["count"] == 1
    assert group["last_user_id"] is None


def test_the_same_error_is_one_group_with_a_count(client, db):
    assert post(client).status_code == 204
    assert post(client, route="/history").status_code == 204
    [group] = groups(db)
    assert group["count"] == 2
    assert group["first_seen_at"] <= group["last_seen_at"]
    assert group["route"] == "/history"  # the latest sample


def test_server_errors_with_different_digests_are_different_groups(client, db):
    """The website sends a Next.js server error's digest in letters (apps/web
    lib/error-report.ts): it must survive the scrub and split the groups."""
    generic = "Error: An error occurred in the Server Components render."
    for tag in ("dehhdggdch", "bacjdiehfg", "dehhdggdch"):
        post(client, message=f"{generic} [digest {tag}, a=0]")
    rows = sorted((g["message"], g["count"]) for g in groups(db))
    assert rows == [
        (f"{generic} [digest bacjdiehfg, a=0]", 1),
        (f"{generic} [digest dehhdggdch, a=0]", 2),
    ]


def test_numbers_dont_split_a_group_but_other_messages_do(client, db):
    post(client, message="Timed out after 3012 ms", stack=None)
    post(client, message="Timed out after 4100 ms", stack=None)
    post(client, message="Network request failed", stack=None)
    assert sorted(g["count"] for g in groups(db)) == [1, 2]


def test_a_signed_in_report_keeps_who_only_with_a_valid_session(client, db):
    user, headers = signup(client, "riya@geu.ac.in", "Riya Sharma")
    assert post(client, headers).status_code == 204
    assert str(groups(db)[0]["last_user_id"]) == user["id"]
    # A bad or stale token is not refused (the report still matters); it just names nobody.
    assert post(client, {"Authorization": "Bearer not-a-token"}, message="Other").status_code == 204
    db.execute(text("UPDATE users SET deactivated_at = now() WHERE email = 'riya@geu.ac.in'"))
    db.commit()
    assert post(client, headers, message="Third").status_code == 204
    assert [g["last_user_id"] for g in groups(db)[1:]] == [None, None]


def test_a_persons_reports_are_in_their_data_download(client, db):
    _, headers = signup(client, "riya@geu.ac.in", "Riya Sharma")
    post(client, headers, message="Riya's page broke", route="/history?x=1")
    post(client, message="Someone else's", stack=None)
    mine = client.get("/profile/export", headers=headers).json()["error_reports"]
    assert [(e["message"], e["page"]) for e in mine] == [("[name]'s page broke", "/history")]
    # Deleting the account keeps the scrubbed report, but no longer says whose it was.
    db.execute(text("DELETE FROM users WHERE email = 'riya@geu.ac.in'"))
    db.commit()
    assert [g["last_user_id"] for g in groups(db)] == [None, None]


def test_a_browser_on_another_site_cannot_report(client, db):
    """CORS keeps another site from reading the answer, not from sending: refuse the request
    outright. The website's own origin passes, and so do the app and the web server (no Origin
    header at all, like any native client)."""
    r = post(client, {"Origin": "https://evil.example"})
    assert r.status_code == 403
    assert post(client, {"Origin": "null"}).status_code == 403
    assert groups(db) == []
    assert post(client, {"Origin": "http://localhost:3000"}).status_code == 204
    assert post(client, {"Origin": "http://localhost:3000/"}, message="Slash").status_code == 204
    assert post(client, message="No origin").status_code == 204
    assert len(groups(db)) == 3


@pytest.mark.parametrize(
    "content_type", [None, "text/plain", "application/x-www-form-urlencoded", "multipart/form-data"]
)
def test_a_report_must_be_sent_as_json(client, db, content_type):
    """A form or text/plain body is what a cross-site page can send without a preflight."""
    headers = {} if content_type is None else {"Content-Type": content_type}
    r = client.post("/errors", content=json.dumps(body()).encode(), headers=headers)
    assert r.status_code == 415
    assert groups(db) == []


def test_json_with_a_charset_is_json(client, db):
    r = client.post(
        "/errors",
        content=json.dumps(body()).encode(),
        headers={"Content-Type": "application/json; charset=utf-8"},
    )
    assert r.status_code == 204, r.text


def test_a_developer_viewing_as_a_role_can_still_report(client, db, dev):
    assert post(client, as_(dev, "student")).status_code == 204


# ---------- scrubbing ----------


def test_personal_data_and_secrets_are_scrubbed_before_storing(client, db):
    _, headers = signup(client, "riya.sharma@geu.ac.in", "Riya Sharma")
    db.execute(
        text(
            "UPDATE users SET roll_no = 'GEU7781', phone = '9811122233' "
            "WHERE email = 'riya.sharma@geu.ac.in'"
        )
    )
    db.commit()
    secrets = {
        "riya.sharma@geu.ac.in": "[email]",
        "other.person@gmail.com": "[email]",
        "Riya": "[name]",
        "Sharma": "[name]",
        "GEU7781": "[roll]",
        "22BTCS0042": "[roll]",
        "2510370192": "[number]",
        "+91 98765 43210": "[phone]",
        "9811122233": "[phone]",
        "30.268312, 77.995041": "[location]",
        "lat=30.2683": "lat=[location]",
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJlLXZhbHVl": "[token]",
        "Bearer abc.DEF-123_xyz": "Bearer [token]",
        "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b": "[secret]",
        "dGhpcyBpcyBhIHNlY3JldCB0b2tlbiB2YWx1ZTE": "[secret]",
        "3f2a9c1e-7b4d-4e8a-9c2f-1d3e5f7a9b0c": "[id]",
        "?code=123456&next=/home": "?[query]",
    }
    message = " | ".join(secrets)
    stack = f"Error: {message}\n    at f (https://lumiback.test/watch/x?token=abcd1234:1:2)"
    r = post(client, headers, message=message, stack=stack, route="/watch/abc?code=99#k=v")
    assert r.status_code == 204, r.text
    [group] = groups(db)
    stored = json.dumps(
        {k: group[k] for k in ("message", "top_frame", "stack", "route")}, default=str
    )
    for secret, placeholder in secrets.items():
        assert secret not in stored, secret
        assert placeholder in group["message"], (secret, group["message"])
    assert "abcd1234" not in stored
    assert group["route"] == "/watch/abc"


def test_names_are_scrubbed_as_whole_words_only(client, db):
    _, headers = signup(client, "ram@geu.ac.in", "Ram Kumar")
    post(client, headers, message="Ram ran a Program", stack=None)
    assert groups(db)[0]["message"] == "[name] ran a Program"


def test_control_characters_are_stripped(client, db):
    bidi = chr(0x202E)
    r = post(client, message=f"boom\x00{bidi} done\nnext", stack="line one\n\tat x\x07")
    assert r.status_code == 204, r.text
    [group] = groups(db)
    assert group["message"] == "boom done next"
    assert group["stack"] == "line one\n\tat x"


# ---------- limits ----------


def test_an_oversized_body_is_refused_before_it_is_read(client, db):
    padding = "x" * (errors_api.MAX_BODY_BYTES + 1)
    r = client.post(
        "/errors",
        content=json.dumps(body(stack=padding)),
        headers={"Content-Type": "application/json"},
    )
    assert r.status_code == 413
    assert groups(db) == []


@pytest.mark.parametrize(
    "overrides",
    [
        {"message": ""},
        {"message": "x" * 501},
        {"stack": "x" * 8001},
        {"route": "/" + "x" * 300},
        {"app_version": "1.0 beta"},
        {"app_version": "x" * 33},
        {"platform": "windows"},
        {"extra": "field"},
    ],
)
def test_each_field_is_capped(client, db, overrides):
    assert post(client, **overrides).status_code == 422
    assert groups(db) == []


def test_bad_json_is_refused(client):
    r = client.post("/errors", content=b"{not json", headers={"Content-Type": "application/json"})
    assert r.status_code == 422


def test_reports_are_rate_limited_per_ip(client, monkeypatch):
    monkeypatch.setattr(errors_api, "PER_IP", Limit(max_hits=3, window_seconds=3600))
    for _ in range(3):
        assert post(client).status_code == 204
    r = post(client)
    assert r.status_code == 429
    assert "Retry-After" in r.headers


def test_reports_are_rate_limited_per_user(client, monkeypatch):
    monkeypatch.setattr(errors_api, "PER_USER", Limit(max_hits=2, window_seconds=3600))
    _, headers = signup(client, "riya@geu.ac.in", "Riya")
    assert post(client, headers).status_code == 204
    assert post(client, headers).status_code == 204
    assert post(client, headers).status_code == 429
    assert post(client).status_code == 204  # the same IP, signed out: its own limit


def test_new_groups_stop_at_the_cap_but_known_ones_still_count(client, db, monkeypatch):
    monkeypatch.setattr(error_reports, "MAX_GROUPS", 2)
    post(client, message="one", stack=None)
    post(client, message="two", stack=None)
    assert post(client, message="three", stack=None).status_code == 204
    post(client, message="one", stack=None)
    assert sorted((g["message"], g["count"]) for g in groups(db)) == [("one", 2), ("two", 1)]


# ---------- the developer's list ----------


def test_developers_list_recent_groups_newest_first(client, db, dev):
    post(client, message="older", stack=None)
    post(client, message="newer", stack=None, platform="android", app_version="1.18.0")
    db.execute(
        text(
            "UPDATE error_reports SET last_seen_at = now() - interval '1 hour' "
            "WHERE message = 'older'"
        )
    )
    db.commit()
    for headers in (dev, as_(dev, "admin")):
        r = client.get("/errors", headers=headers)
        assert r.status_code == 200, r.text
        items = r.json()["items"]
        assert [i["message"] for i in items] == ["newer", "older"]
        assert items[0]["platform"] == "android"
        assert items[0]["count"] == 1
        assert items[0]["signed_in"] is False
        assert "last_user_id" not in items[0]


def test_only_developers_list_errors(client, db):
    _, admin = signup(client, "admin@geu.ac.in", "Admin")
    db.execute(text("UPDATE users SET role = 'admin' WHERE email = 'admin@geu.ac.in'"))
    db.commit()
    _, student = signup(client, "s@geu.ac.in", "Student")
    assert client.get("/errors", headers=admin).status_code == 403
    assert client.get("/errors", headers=student).status_code == 403
    assert client.get("/errors").status_code == 401


# ---------- the sweep: 30 days, and the daily digest ----------


def test_groups_are_deleted_30_days_after_they_were_last_seen(client, db):
    post(client, message="old", stack=None)
    post(client, message="recent", stack=None)
    db.execute(
        text(
            "UPDATE error_reports SET first_seen_at = now() - interval '40 days', "
            "last_seen_at = CASE message WHEN 'old' THEN now() - interval '31 days' "
            "ELSE now() - interval '29 days' END"
        )
    )
    db.commit()
    run_sweep(client)
    assert [g["message"] for g in groups(db)] == ["recent"]


def digests(client) -> list:
    return [m for m in client.app.state.mailer.outbox if m.to == "owner@example.com"]


def test_the_digest_goes_once_a_day_to_the_configured_address(client, db):
    _, headers = signup(client, "riya@geu.ac.in", "Riya Sharma")
    post(client, headers, message="Failed for riya@geu.ac.in", stack=None)
    post(client, message="Network request failed", stack=None)
    post(client, message="Network request failed", stack=None)
    run_sweep(client, digest_to="owner@example.com")
    [mail] = digests(client)
    assert "2 errors" in mail.subject
    assert "Network request failed" in mail.body
    assert "Seen 2 times" in mail.body
    assert "Failed for [email]" in mail.body
    assert "riya@" not in mail.body and "Riya" not in mail.body
    assert "https://lumiback.test/admin/errors" in mail.body
    assert mail.html is None  # plain text only
    # Once a day: another sweep (with a new error) sends nothing more today.
    post(client, message="A new one", stack=None)
    run_sweep(client, digest_to="owner@example.com")
    assert len(digests(client)) == 1
    keys = db.execute(text("SELECT key FROM alert_outbox WHERE kind = 'error_digest'")).scalars()
    assert len(list(keys)) == 1


def test_no_digest_without_an_address_or_without_errors(client, db):
    run_sweep(client, digest_to="owner@example.com")
    assert digests(client) == []
    post(client)
    run_sweep(client)
    assert digests(client) == []
    assert db.execute(text("SELECT count(*) FROM alert_outbox")).scalar_one() == 0


def test_a_digest_after_a_long_gap_still_lists_the_older_errors(client, db):
    """Digests more than a day apart (the API asleep, or a day without errors): the next one
    starts from the last digest, not from a day ago, so nothing in between is skipped."""
    db.execute(
        text(
            "INSERT INTO alert_outbox (key, kind, mode, created_at, sent_at) VALUES "
            "('error_digest:2000-01-01', 'error_digest', 'email', now() - interval '3 days', "
            "now() - interval '3 days')"
        )
    )
    db.commit()
    post(client, message="Two days old", stack=None)
    post(client, message="Four days old", stack=None)
    db.execute(
        text(
            "UPDATE error_reports SET last_seen_at = now() - CASE message "
            "WHEN 'Two days old' THEN interval '2 days' ELSE interval '4 days' END"
        )
    )
    db.commit()
    run_sweep(client, digest_to="owner@example.com")
    [mail] = digests(client)
    assert "Two days old" in mail.body
    # Seen before the last digest went out: that one listed it already.
    assert "Four days old" not in mail.body
    assert "1 error was" in mail.body


def test_the_digest_disables_links_and_calls_entries_unverified(client, db):
    post(
        client,
        message="Failed to load https://evil.example.com/login and www.phish.example.org",
        stack=None,
        route="/home",
    )
    run_sweep(client, digest_to="owner@example.com")
    [mail] = digests(client)
    assert "hxxps://evil[.]example[.]com/login" in mail.body
    assert "www[.]phish[.]example[.]org" in mail.body
    assert "https://evil" not in mail.body and "www.phish" not in mail.body
    assert "unverified" in mail.body
    # The digest's own link to the Errors page still works.
    assert "https://lumiback.test/admin/errors" in mail.body


def test_defang_leaves_ordinary_text_alone():
    assert error_reports.defang("x.y is not a function") == "x.y is not a function"
    assert error_reports.defang("HTTP://A.B/c") == "hxxp://A[.]B/c"


# ---------- the sweep goes on when error upkeep fails ----------


def test_a_failing_digest_never_rolls_back_the_sweeps_late_alerts(client, db, monkeypatch):
    _, anna = signup(client, "anna@geu.ac.in", "Anna")
    go_out(client, anna)
    db.execute(text(LATE_31))
    db.commit()
    post(client, message="Something broke", stack=None)

    async def broken(*args, **kwargs):
        raise RuntimeError("digest blew up")

    monkeypatch.setattr(error_reports, "queue_digest", broken)
    result = run_sweep(client, digest_to="owner@example.com")
    assert result.overdue_notified == 1
    assert result.error_digest_queued is False
    kinds = db.execute(text("SELECT kind FROM alert_outbox")).scalars().all()
    assert "late_alert" in kinds
    assert db.execute(text("SELECT overdue_notified_at FROM outings")).scalar_one() is not None


# ---------- scrubbing stays fast on hostile input ----------


def _slowest(value: str) -> float:
    best = float("inf")
    for _ in range(3):
        started = time.perf_counter()
        error_reports.scrub(value)
        best = min(best, time.perf_counter() - started)
    return best


@pytest.mark.parametrize(
    "hostile",
    [
        "a" * 8000,  # no @ anywhere: the email rule must not rescan from every letter
        "a." * 4000,
        "eyJ-" * 2000,  # the token rule: a fresh start after every dash
        "eyJa" * 2000,
        "x@" + "a" * 8000,
    ],
    ids=["letters", "dotted", "jwt-dashes", "jwt-run", "email-domain"],
)
def test_scrub_is_linear_on_long_runs_without_separators(hostile):
    control = _slowest(("a " * 4000)[: len(hostile)])
    took = _slowest(hostile)
    assert took < 0.05 + 10 * control, (took, control)


def make_settings(**extra) -> Settings:
    return Settings(
        _env_file=None,  # type: ignore[call-arg]
        database_url="postgresql+psycopg://u:p@localhost/x_test",
        jwt_secret=FAKE_SECRET,
        code_pepper=FAKE_SECRET[::-1],
        cors_origins="http://localhost:3000",
        app_env="development",
        breach_check="off",
        **extra,
    )


def test_the_digest_setting_is_an_address_or_unset():
    assert make_settings().error_digest_email is None
    assert make_settings(error_digest_email=" ").error_digest_email is None
    ok = make_settings(error_digest_email="owner@example.com")
    assert ok.error_digest_email == "owner@example.com"
    with pytest.raises(ValidationError):
        make_settings(error_digest_email="not an address")
