"""Join codes: single-use + hashed (A5), brute-force limits (A6), approval required (A7)."""

import hashlib
import hmac

import pytest
from sqlalchemy import text

from app.security.rate_limit import RateLimiter
from tests.conftest import FAKE_SECRET
from tests.helpers import befriend, share_with, signup

PEPPER = FAKE_SECRET[::-1]


class FakeClock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def riya(client):
    _, headers = signup(client, "riya@example.com", "Riya")
    return headers


@pytest.fixture
def live(client, riya):
    r = client.post("/sessions", json={"source": "tab_live", "duration_minutes": 60}, headers=riya)
    assert r.status_code == 201
    return r.json()


def new_code(client, riya, session_id) -> str:
    r = client.post(f"/sessions/{session_id}/codes", headers=riya)
    assert r.status_code == 201, r.text
    return r.json()["code"]


def redeem_as_guest(client, code, label="Mom"):
    return client.post("/codes/redeem", json={"code": code, "guest_label": label})


def guest_get(client, session_id, token):
    return client.get(f"/sessions/{session_id}", headers={"X-Guest-Token": token})


# ---------- A5: format, hashing, single use, expiry ----------


def test_code_format_and_only_hmac_is_stored(client, riya, live, db):
    code = new_code(client, riya, live["id"])
    assert len(code) == 11 and code[5] == "-"
    stored = db.execute(text("SELECT code_hash FROM share_codes")).scalar_one()
    plain = code.replace("-", "")
    assert stored == hmac.new(PEPPER.encode(), plain.encode(), hashlib.sha256).digest()
    assert plain.encode() not in stored


def test_code_works_once(client, riya, live):
    code = new_code(client, riya, live["id"])
    assert redeem_as_guest(client, code).status_code == 200
    assert redeem_as_guest(client, code).status_code == 400


def test_expired_code_rejected(client, riya, live, db):
    code = new_code(client, riya, live["id"])
    db.execute(
        text(
            "UPDATE share_codes SET created_at = now() - interval '20 minutes', "
            "expires_at = now() - interval '1 second'"
        )
    )
    db.commit()
    assert redeem_as_guest(client, code).status_code == 400


def test_code_for_a_stopped_session_rejected(client, riya, live):
    code = new_code(client, riya, live["id"])
    client.post(f"/sessions/{live['id']}/stop", headers=riya)
    assert redeem_as_guest(client, code).status_code == 400
    assert client.post(f"/sessions/{live['id']}/codes", headers=riya).status_code == 409


def test_codes_are_forgiving_of_formatting(client, riya, live):
    code = new_code(client, riya, live["id"])
    messy = f"  {code.lower().replace('-', ' ')} ".replace("0", "o").replace("1", "l")
    assert redeem_as_guest(client, messy).status_code == 200


def test_only_the_sharer_can_create_codes(client, riya, live):
    _, mallory = signup(client, "mallory@example.com")
    assert client.post(f"/sessions/{live['id']}/codes", headers=mallory).status_code == 404


def test_sharer_cannot_join_own_session_and_code_survives(client, riya, live):
    code = new_code(client, riya, live["id"])
    r = client.post("/codes/redeem", json={"code": code}, headers=riya)
    assert r.status_code == 422
    assert redeem_as_guest(client, code).status_code == 200  # still unused


def test_guest_must_give_a_label(client, riya, live):
    code = new_code(client, riya, live["id"])
    assert client.post("/codes/redeem", json={"code": code}).status_code == 422


# ---------- A6: brute force ----------


def test_failed_redeems_lock_out_the_ip_even_for_a_valid_code(client, riya, live):
    clock = FakeClock()
    client.app.state.limiter = RateLimiter(clock=clock)
    code = new_code(client, riya, live["id"])
    for _ in range(5):
        assert redeem_as_guest(client, "AAAAA-AAAAA").status_code == 400
    locked = redeem_as_guest(client, code)
    assert locked.status_code == 429
    assert int(locked.headers["Retry-After"]) > 0

    clock.t += 601
    assert redeem_as_guest(client, code).status_code == 200


def test_successful_redeems_do_not_count_as_failures(client, riya, live):
    for _ in range(6):
        assert redeem_as_guest(client, new_code(client, riya, live["id"])).status_code == 200


def test_code_creation_is_rate_limited(client, riya, live):
    for _ in range(10):
        new_code(client, riya, live["id"])
    assert client.post(f"/sessions/{live['id']}/codes", headers=riya).status_code == 429


# ---------- A7: two-sided consent ----------


def test_guest_waits_for_approval_then_sees_session(client, riya, live):
    joined = redeem_as_guest(client, new_code(client, riya, live["id"]), label="Mom").json()
    assert joined["status"] == "pending"
    token = joined["guest_token"]

    assert guest_get(client, live["id"], token).status_code == 403  # not yet

    pending = client.get(f"/sessions/{live['id']}", headers=riya).json()["viewers"]
    assert [(v["name"], v["kind"], v["status"]) for v in pending] == [("Mom", "guest", "pending")]

    approved = client.post(
        f"/sessions/{live['id']}/viewers/{joined['viewer_id']}/approve", headers=riya
    )
    assert approved.status_code == 200
    seen = guest_get(client, live["id"], token)
    assert seen.status_code == 200
    assert seen.json()["sharer"]["name"] == "Riya"

    client.post(f"/sessions/{live['id']}/viewers/{joined['viewer_id']}/revoke", headers=riya)
    assert guest_get(client, live["id"], token).status_code == 403


def test_guest_tokens_are_stored_hashed(client, riya, live, db):
    joined = redeem_as_guest(client, new_code(client, riya, live["id"])).json()
    stored = db.execute(text("SELECT guest_token_hash FROM share_viewers")).scalar_one()
    assert stored == hashlib.sha256(joined["guest_token"].encode()).digest()


def test_unknown_guest_token_sees_nothing(client, riya, live):
    assert guest_get(client, live["id"], "made-up-token").status_code == 404


def test_logged_in_user_joins_pending_and_appears_in_watching_after_approval(client, riya, live):
    _, arjun = signup(client, "arjun@example.com", "Arjun")
    joined = client.post(
        "/codes/redeem", json={"code": new_code(client, riya, live["id"])}, headers=arjun
    ).json()
    assert joined["status"] == "pending" and joined["guest_token"] is None
    assert client.get("/sessions/watching", headers=arjun).json() == []

    client.post(f"/sessions/{live['id']}/viewers/{joined['viewer_id']}/approve", headers=riya)
    assert [w["id"] for w in client.get("/sessions/watching", headers=arjun).json()] == [live["id"]]


def test_revoked_viewer_rejoining_is_pending_again_not_granted(client, riya):
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    befriend(client, riya, "arjun@example.com", arjun)
    s = share_with(client, riya, [arjun_user["id"]])
    viewer_id = s["viewers"][0]["id"]
    client.post(f"/sessions/{s['id']}/viewers/{viewer_id}/revoke", headers=riya)

    rejoined = client.post(
        "/codes/redeem", json={"code": new_code(client, riya, s["id"])}, headers=arjun
    ).json()
    assert rejoined["viewer_id"] == viewer_id
    assert rejoined["status"] == "pending"
    assert client.get(f"/sessions/{s['id']}", headers=arjun).status_code == 403


def test_only_the_sharer_can_approve_and_only_pending_viewers(client, riya, live):
    joined = redeem_as_guest(client, new_code(client, riya, live["id"])).json()
    _, mallory = signup(client, "mallory@example.com")
    url = f"/sessions/{live['id']}/viewers/{joined['viewer_id']}/approve"
    assert client.post(url, headers=mallory).status_code == 404
    assert client.post(url, headers=riya).status_code == 200
    assert client.post(url, headers=riya).status_code == 404  # already granted
