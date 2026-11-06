"""A lost phone: the signed-in devices list, signing one device (or every other one) out, push
tokens that go with the sign-in, and a reset that can't miss a refresh happening at that moment."""

import asyncio
import threading
import time

import pytest
from sqlalchemy import text

from app.services import device_label, refresh_tokens
from tests.helpers import PASSWORD, auth_header, make_admin, register, signup

RIYA = "riya@geu.ac.in"
CHROME_WINDOWS = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/130.0.0.0 Safari/537.36"
)


def sign_in(client, email: str = RIYA, **extra) -> dict:
    r = client.post("/auth/login", json={"email": email, "password": PASSWORD, **extra})
    assert r.status_code == 200, r.text
    return r.json()


def phone_token(client, headers, token: str) -> None:
    r = client.post(
        "/devices/push-token", json={"token": token, "platform": "android"}, headers=headers
    )
    assert r.status_code == 204, r.text


def push_tokens(db) -> list[str]:
    return list(db.execute(text("SELECT token FROM push_tokens ORDER BY token")).scalars())


def live_tokens(db, email: str = RIYA) -> int:
    return db.execute(
        text(
            "SELECT count(*) FROM refresh_tokens t JOIN users u ON u.id = t.user_id "
            "WHERE u.email = :e AND t.revoked_at IS NULL"
        ),
        {"e": email},
    ).scalar()


@pytest.fixture
def riya(client):
    register(client, RIYA, "Riya")


def test_the_list_names_each_device_and_marks_this_one(client, riya):
    web = sign_in(client, user_agent=CHROME_WINDOWS)
    app = sign_in(client, device="Lumiback app on Android 14")
    listed = client.get("/auth/devices", headers=auth_header(app)).json()
    assert [(d["device"], d["current"]) for d in listed] == [
        ("Lumiback app on Android 14", True),
        ("Chrome on Windows", False),
    ]
    from_web = client.get("/auth/devices", headers=auth_header(web)).json()
    assert [d["current"] for d in from_web] == [False, True]


def test_signing_out_a_lost_phone_stops_it_at_once(client, db, riya):
    laptop = sign_in(client, user_agent=CHROME_WINDOWS)
    lost = sign_in(client, device="Lumiback app on Android 14")
    phone_token(client, auth_header(lost), "ExponentPushToken[lostPhone00001]")
    lost_id = next(
        d["id"]
        for d in client.get("/auth/devices", headers=auth_header(laptop)).json()
        if not d["current"]
    )

    r = client.delete(f"/auth/devices/{lost_id}", headers=auth_header(laptop))
    assert r.status_code == 204, r.text
    # Not in 15 minutes when the access token expires: now.
    assert client.get("/auth/me", headers=auth_header(lost)).status_code == 401
    assert (
        client.post("/auth/refresh", json={"refresh_token": lost["refresh_token"]}).status_code
        == 401
    )
    assert push_tokens(db) == []  # no more notifications to that phone
    assert client.get("/auth/me", headers=auth_header(laptop)).status_code == 200
    assert [
        d["device"] for d in client.get("/auth/devices", headers=auth_header(laptop)).json()
    ] == ["Chrome on Windows"]


def test_sign_out_every_other_device(client, db, riya):
    keep = sign_in(client, user_agent=CHROME_WINDOWS)
    others = [sign_in(client, device=f"Phone {i}") for i in range(2)]
    phone_token(client, auth_header(others[0]), "ExponentPushToken[otherPhone0001]")
    phone_token(client, auth_header(keep), "ExponentPushToken[keepPhone00001]")

    r = client.post("/auth/devices/sign-out-others", headers=auth_header(keep))
    assert r.status_code == 200 and r.json() == {"signed_out": 2}
    for other in others:
        assert client.get("/auth/me", headers=auth_header(other)).status_code == 401
    assert client.get("/auth/me", headers=auth_header(keep)).status_code == 200
    assert push_tokens(db) == ["ExponentPushToken[keepPhone00001]"]


def test_nobody_signs_out_someone_elses_device(client, riya):
    mine = sign_in(client)
    theirs_id = client.get("/auth/devices", headers=auth_header(mine)).json()[0]["id"]
    _, other = signup(client, "anna@geu.ac.in", "Anna")
    assert client.delete(f"/auth/devices/{theirs_id}", headers=other).status_code == 404
    assert client.get("/auth/me", headers=auth_header(mine)).status_code == 200


def test_a_refreshed_sign_in_keeps_its_name_and_start(client, riya):
    first = sign_in(client, device="Lumiback app on Android 14")
    before = client.get("/auth/devices", headers=auth_header(first)).json()[0]
    r = client.post("/auth/refresh", json={"refresh_token": first["refresh_token"]})
    assert r.status_code == 200, r.text
    after = client.get("/auth/devices", headers=auth_header(r.json())).json()
    assert len(after) == 1
    assert (after[0]["id"], after[0]["device"], after[0]["signed_in_at"]) == (
        before["id"],
        "Lumiback app on Android 14",
        before["signed_in_at"],
    )
    assert after[0]["current"] is True
    # The access token from before the refresh still works: same sign-in.
    assert client.get("/auth/me", headers=auth_header(first)).status_code == 200


def test_a_password_reset_signs_out_and_silences_every_phone(client, db, riya):
    _, admin = signup(client, "office@geu.ac.in", "Office")
    make_admin(db, "office@geu.ac.in")
    phone = sign_in(client, device="Lumiback app on Android 14")
    phone_token(client, auth_header(phone), "ExponentPushToken[riyaPhone00001]")
    riya_id = client.get("/admin/users", params={"q": "riya"}, headers=admin).json()[0]["id"]
    assert client.post(f"/admin/users/{riya_id}/password-link", headers=admin).status_code == 200
    assert client.get("/auth/me", headers=auth_header(phone)).status_code == 401
    assert "ExponentPushToken[riyaPhone00001]" not in push_tokens(db)


def test_a_reset_cant_miss_a_refresh_at_the_same_moment(client, db, riya, monkeypatch):
    """The audit lead: a refresh that claimed its token but hasn't saved the successor yet,
    while an admin resets the account. The successor must not survive the reset."""
    _, admin = signup(client, "office@geu.ac.in", "Office")
    make_admin(db, "office@geu.ac.in")
    riya_id = client.get("/admin/users", params={"q": "riya"}, headers=admin).json()[0]["id"]
    tokens = sign_in(client)
    real_issue = refresh_tokens.issue

    async def slow_issue(*args, **kwargs):
        if kwargs.get("signed_in_at") is not None:  # only the successor in a rotation
            await asyncio.sleep(1.0)  # the reset arrives here
        return await real_issue(*args, **kwargs)

    monkeypatch.setattr(refresh_tokens, "issue", slow_issue)
    result: dict = {}
    refreshing = threading.Thread(
        target=lambda: result.update(
            r=client.post("/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
        )
    )
    refreshing.start()
    time.sleep(0.4)
    reset = client.post(f"/admin/users/{riya_id}/password-link", headers=admin)
    refreshing.join(timeout=20)
    assert reset.status_code == 200, reset.text
    assert result["r"].status_code == 200  # the refresh finished first...
    assert live_tokens(db) == 0  # ...and the reset still revoked its successor
    assert (
        client.post(
            "/auth/refresh", json={"refresh_token": result["r"].json()["refresh_token"]}
        ).status_code
        == 401
    )


def test_signing_a_device_out_cant_miss_its_refresh_at_the_same_moment(
    client, db, riya, monkeypatch
):
    """The lost phone refreshes just as it's signed out from the laptop: the refresh has
    claimed its token but not saved the successor yet. The successor must not survive."""
    laptop = sign_in(client, user_agent=CHROME_WINDOWS)
    lost = sign_in(client, device="Lumiback app on Android 14")
    lost_id = next(
        d["id"]
        for d in client.get("/auth/devices", headers=auth_header(laptop)).json()
        if not d["current"]
    )
    real_issue = refresh_tokens.issue

    async def slow_issue(*args, **kwargs):
        if kwargs.get("signed_in_at") is not None:  # only the successor in a rotation
            await asyncio.sleep(1.0)  # the sign-out arrives here
        return await real_issue(*args, **kwargs)

    monkeypatch.setattr(refresh_tokens, "issue", slow_issue)
    result: dict = {}
    refreshing = threading.Thread(
        target=lambda: result.update(
            r=client.post("/auth/refresh", json={"refresh_token": lost["refresh_token"]})
        )
    )
    refreshing.start()
    time.sleep(0.4)
    gone = client.delete(f"/auth/devices/{lost_id}", headers=auth_header(laptop))
    refreshing.join(timeout=20)
    assert gone.status_code == 204, gone.text
    assert result["r"].status_code == 200  # the refresh finished first...
    successor = result["r"].json()
    # ...and the sign-out still stopped it: neither its new tokens nor a list entry survive.
    assert client.get("/auth/me", headers=auth_header(successor)).status_code == 401
    assert (
        client.post("/auth/refresh", json={"refresh_token": successor["refresh_token"]}).status_code
        == 401
    )
    assert live_tokens(db) == 1  # the laptop's


# ---------- changing the password while signed in ----------

NEW_PASSWORD = "harbour-lantern-quietly-71"


def change(client, tokens, current=PASSWORD, new=NEW_PASSWORD):
    return client.post(
        "/auth/change-password",
        json={"current_password": current, "password": new},
        headers=auth_header(tokens),
    )


def test_changing_the_password_signs_out_every_other_device(client, db, riya):
    here = sign_in(client, user_agent=CHROME_WINDOWS)
    lost = sign_in(client, device="Lumiback app on Android 14")
    phone_token(client, auth_header(lost), "ExponentPushToken[lostPhone00002]")

    r = change(client, here)
    assert r.status_code == 200, r.text
    assert r.json() == {"signed_out": 1, "still_signed_in": True}
    assert client.get("/auth/me", headers=auth_header(lost)).status_code == 401
    assert push_tokens(db) == []
    assert client.get("/auth/me", headers=auth_header(here)).status_code == 200
    again = client.post("/auth/refresh", json={"refresh_token": here["refresh_token"]})
    assert again.status_code == 200  # this device keeps going

    old = client.post("/auth/login", json={"email": RIYA, "password": PASSWORD})
    assert old.status_code == 401
    assert sign_in(client, password=NEW_PASSWORD)["access_token"]


def test_the_current_password_must_be_right_and_guessing_stops(client, riya):
    here = sign_in(client)
    for _ in range(5):
        r = change(client, here, current="not-my-password-at-all")
        assert r.status_code == 403
        assert r.json()["detail"] == "Your current password isn't right"
    assert change(client, here).status_code == 429  # even the right one, for now
    assert client.get("/auth/me", headers=auth_header(here)).status_code == 200


@pytest.mark.parametrize(
    ("new", "problem"),
    [
        ("short", "at least"),
        (PASSWORD, "different from your current one"),
    ],
)
def test_a_weak_or_unchanged_password_is_refused(client, riya, new, problem):
    here = sign_in(client)
    r = change(client, here, new=new)
    assert r.status_code == 422
    assert problem in r.json()["detail"]
    other = sign_in(client)
    assert client.get("/auth/me", headers=auth_header(other)).status_code == 200  # nobody out


def test_a_change_needs_a_sign_in(client, riya):
    r = client.post(
        "/auth/change-password", json={"current_password": PASSWORD, "password": NEW_PASSWORD}
    )
    assert r.status_code == 401


@pytest.mark.parametrize(
    ("device", "ua", "expected"),
    [
        (None, CHROME_WINDOWS, "Chrome on Windows"),
        (
            None,
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like "
            "Gecko) Version/18.0 Safari/605.1.15",
            "Safari on Mac",
        ),
        (
            None,
            "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/130.0 Mobile Safari/537.36 EdgA/130.0",
            "Edge on Android",
        ),
        (
            None,
            "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 "
            "(KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
            "Safari on iPhone",
        ),
        (
            None,
            "Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0",
            "Firefox on Linux",
        ),
        (None, "okhttp/4.12.0", "Lumiback app on Android"),
        (None, "node", None),
        (None, None, None),
        ("Lumiback app on Android 14", CHROME_WINDOWS, "Lumiback app on Android 14"),
    ],
)
def test_device_labels(device, ua, expected):
    assert device_label.label(device, ua) == expected
