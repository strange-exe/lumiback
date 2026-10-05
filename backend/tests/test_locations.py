"""Latest location: sharer writes, viewers read via can_view, every read logged (A11),
expiry/stop enforced (A4, A9), and stop cannot race with a concurrent update."""

import threading
import time
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.realtime import LocationUpdated
from tests.helpers import befriend, share_with, signup


def fix(lat=30.3165, lng=78.0322, ago=timedelta(0), **extra):
    return {
        "lat": lat,
        "lng": lng,
        "accuracy_m": 12.5,
        "recorded_at": (datetime.now(UTC) - ago).isoformat(),
        **extra,
    }


@pytest.fixture
def shared(client):
    """riya shares with arjun; mallory is a stranger."""
    _, riya = signup(client, "riya@example.com", "Riya")
    arjun_user, arjun = signup(client, "arjun@example.com", "Arjun")
    _, mallory = signup(client, "mallory@example.com", "Mallory")
    befriend(client, riya, "arjun@example.com", arjun)
    s = share_with(client, riya, [arjun_user["id"]])
    return {"riya": riya, "arjun": arjun, "mallory": mallory, "s": s, "id": s["id"]}


def put(client, x, body):
    return client.put(f"/sessions/{x['id']}/location", json=body, headers=x["riya"])


def get(client, x, who):
    return client.get(f"/sessions/{x['id']}/location", headers=x[who])


def test_viewer_reads_the_latest_location(client, shared):
    assert get(client, shared, "arjun").json()["location"] is None  # before first update
    assert put(client, shared, fix(lat=30.1)).status_code == 204
    assert put(client, shared, fix(lat=30.2)).status_code == 204
    loc = get(client, shared, "arjun").json()["location"]
    assert loc["lat"] == 30.2 and loc["stale"] is False


def test_only_one_row_is_kept(client, shared, db):
    for i in range(5):
        put(client, shared, fix(lat=30 + i / 10))
    assert db.execute(text("SELECT count(*) FROM locations")).scalar_one() == 1


def test_out_of_order_update_does_not_overwrite_newer(client, shared):
    put(client, shared, fix(lat=31.0))
    put(client, shared, fix(lat=29.0, ago=timedelta(seconds=30)))  # arrives late
    assert get(client, shared, "arjun").json()["location"]["lat"] == 31.0


def test_old_fix_is_marked_stale(client, shared):
    put(client, shared, fix(ago=timedelta(minutes=2)))
    assert get(client, shared, "arjun").json()["location"]["stale"] is True


@pytest.mark.parametrize(
    "body",
    [
        fix(lat=91),
        fix(lng=-181),
        fix(accuracy_m=-1),
        {**fix(), "recorded_at": "2026-10-05T10:00:00"},  # naive: no timezone
        fix(ago=timedelta(minutes=-10)),  # 10 minutes in the future
        {**fix(), "speed": 3},  # unknown field
    ],
)
def test_bad_location_updates_rejected(client, shared, body):
    assert put(client, shared, body).status_code == 422


def test_only_the_sharer_can_write(client, shared):
    for who in ("arjun", "mallory"):
        r = client.put(f"/sessions/{shared['id']}/location", json=fix(), headers=shared[who])
        assert r.status_code == 404, who


def test_strangers_and_unknown_sessions_get_404(client, shared):
    assert get(client, shared, "mallory").status_code == 404
    r = client.get(f"/sessions/{uuid.uuid4()}/location", headers=shared["arjun"])
    assert r.status_code == 404


def test_stop_cuts_reads_and_writes(client, shared, db):
    put(client, shared, fix())
    client.post(f"/sessions/{shared['id']}/stop", headers=shared["riya"])
    assert get(client, shared, "arjun").status_code == 403
    assert put(client, shared, fix()).status_code == 409
    assert db.execute(text("SELECT count(*) FROM locations")).scalar_one() == 0


def test_expired_session_cuts_reads_and_writes_without_the_job(client, shared, db):
    """A4 (HTTP)."""
    put(client, shared, fix())
    db.execute(
        text(
            "UPDATE share_sessions SET created_at = now() - interval '2 hours', "
            "ends_at = now() - interval '1 second'"
        )
    )
    db.commit()
    assert get(client, shared, "arjun").status_code == 403
    assert put(client, shared, fix()).status_code == 409


def test_every_viewer_read_is_logged_for_the_sharer(client, shared):
    """A11 (HTTP)."""
    put(client, shared, fix())
    get(client, shared, "arjun")
    get(client, shared, "arjun")
    get(client, shared, "riya")  # the sharer's own reads are not logged

    log = client.get(f"/sessions/{shared['id']}/access-log", headers=shared["riya"])
    assert log.status_code == 200
    assert [(e["viewer_name"], e["kind"], e["channel"]) for e in log.json()] == [
        ("Arjun", "user", "http"),
        ("Arjun", "user", "http"),
    ]
    times = [e["viewed_at"] for e in log.json()]
    assert times == sorted(times, reverse=True)


def test_access_log_is_private_to_the_sharer(client, shared):
    for who in ("arjun", "mallory"):
        r = client.get(f"/sessions/{shared['id']}/access-log", headers=shared[who])
        assert r.status_code == 404, who


def test_guest_reads_only_after_approval_and_is_logged_by_label(client):
    _, riya = signup(client, "riya@example.com", "Riya")
    s = client.post("/sessions", json={"source": "tab_live"}, headers=riya).json()
    code = client.post(f"/sessions/{s['id']}/codes", headers=riya).json()["code"]
    joined = client.post("/codes/redeem", json={"code": code, "guest_label": "Mom"}).json()
    guest = {"X-Guest-Token": joined["guest_token"]}
    client.put(f"/sessions/{s['id']}/location", json=fix(), headers=riya)

    assert client.get(f"/sessions/{s['id']}/location", headers=guest).status_code == 403
    client.post(f"/sessions/{s['id']}/viewers/{joined['viewer_id']}/approve", headers=riya)
    assert client.get(f"/sessions/{s['id']}/location", headers=guest).status_code == 200

    log = client.get(f"/sessions/{s['id']}/access-log", headers=riya).json()
    assert [(e["viewer_name"], e["kind"]) for e in log] == [("Mom", "guest")]


def test_update_notifies_subscribers(client, shared):
    seen: list = []

    async def spy(event):
        seen.append(event)

    client.app.state.hub.subscribe(uuid.UUID(shared["id"]), spy)
    put(client, shared, fix())
    assert seen == [LocationUpdated(uuid.UUID(shared["id"]))]


def test_update_racing_a_stop_never_leaves_a_location_behind(client, shared, db):
    """Hold stop's row lock open, send an update (it must wait), then finish the stop."""
    db.execute(
        text(
            "UPDATE share_sessions SET status = 'revoked', ended_at = now(), "
            "ended_reason = 'stopped_by_sharer' WHERE id = :s"
        ),
        {"s": shared["id"]},
    )  # transaction stays open: the row is locked

    result: dict = {}
    worker = threading.Thread(target=lambda: result.update(r=put(client, shared, fix())))
    worker.start()
    time.sleep(0.5)
    assert worker.is_alive(), "update should be blocked on the session row lock"

    db.execute(text("DELETE FROM locations WHERE session_id = :s"), {"s": shared["id"]})
    db.commit()  # stop completes
    worker.join(timeout=10)

    assert result["r"].status_code == 409
    assert db.execute(text("SELECT count(*) FROM locations")).scalar_one() == 0
