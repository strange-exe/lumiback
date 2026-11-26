"""The hostel board (spec 2026-11-24): the hostel office posts timings, mess, laundry and
maintenance news for every student in its hostels to read.

Who posts (wardens for their hostels; head wardens and admins for any or all; never a
developer), what a post may hold, who reads it, the seen counts with their privacy floor, the
push to phones whose app has the "Hostel board" channel, and the rules draft."""

import dataclasses
import functools
import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from app.jobs.expiry import sweep
from app.push import DAY, MemoryPushSender, PushMessage
from app.security.rate_limit import Limit
from app.services import board as board_svc
from app.services.rules import IST
from tests.conftest import BACKEND
from tests.helpers import signup
from tests.test_push import PoolWatchingSender

DASH, DOT = chr(0x2013), chr(0xB7)
OPEN_LINE = f"12:00 AM{DASH}11:59 PM {DOT} no form needed"
MAX_ID = 2**63 - 1

NO_HOSTELS = "You don't look after a hostel yet. Ask an admin to assign one."
ALL_HOSTELS_ONLY = "Only head wardens and admins post to all hostels"
NOT_A_POSTER = "Only the hostel office posts to the hostel board"
WITHDRAW_REFUSED = "Only the person who posted it, a head warden or an admin can take it down"


# ---------- people and hostels ----------


@pytest.fixture(autouse=True)
def many_signups(monkeypatch):
    """A hostel needs more students than one address may sign up in an hour."""
    monkeypatch.setattr("app.api.auth.REGISTER_PER_IP", Limit(max_hits=100, window_seconds=3600))


def end_post(db, post_id: int) -> None:
    """Ended a second ago (created a day before: a post always ends after it starts)."""
    db.execute(
        text(
            "UPDATE board_posts SET created_at = now() - interval '1 day', "
            "expires_at = now() - interval '1 second' WHERE id = :i"
        ),
        {"i": post_id},
    )
    db.commit()


@pytest.fixture
def push(client) -> MemoryPushSender:
    sender = MemoryPushSender()
    client.app.state.push = sender
    return sender


def make_hostel(db, name: str, rule_set: str | None = None) -> str:
    rule_set = rule_set or db.execute(text("SELECT id FROM rule_sets LIMIT 1")).scalar_one()
    hostel = db.execute(
        text("INSERT INTO hostels (name, rule_set_id) VALUES (:n, :r) RETURNING id"),
        {"n": name, "r": rule_set},
    ).scalar_one()
    db.commit()
    return str(hostel)


@pytest.fixture
def campus(db) -> dict[str, str]:
    """Hostels A, B and C, all on the open default rules."""
    return {k: make_hostel(db, f"Hostel {k}") for k in "ABC"}


def person(client, db, email: str, role: str = "student", hostel=None, wards=()):
    """Signs up; returns (user id, headers)."""
    user, headers = signup(client, email, email.split("@")[0].title())
    db.execute(
        text("UPDATE users SET role = :r, hostel_id = :h WHERE id = :u"),
        {"r": role, "h": hostel, "u": user["id"]},
    )
    for ward in wards:
        db.execute(
            text("INSERT INTO warden_hostels (user_id, hostel_id) VALUES (:u, :h)"),
            {"u": user["id"], "h": ward},
        )
    db.commit()
    return user["id"], headers


def quiet_student(db, email: str, hostel, *, verified: bool = True, active: bool = True) -> str:
    """A student who never signs in here (no password needed): only counted."""
    sid = db.execute(
        text(
            "INSERT INTO users (name, email, password_hash, hostel_id, email_verified_at, "
            "deactivated_at) VALUES ('Quiet', :e, 'x', :h, "
            "CASE WHEN :v THEN now() END, CASE WHEN :a THEN NULL ELSE now() END) RETURNING id"
        ),
        {"e": email, "h": hostel, "v": verified, "a": active},
    ).scalar_one()
    db.commit()
    return str(sid)


@pytest.fixture
def warden(client, db, campus):
    return person(client, db, "warden@geu.ac.in", "warden", wards=[campus["A"]])


@pytest.fixture
def head(client, db, campus):
    return person(client, db, "head@geu.ac.in", "head_warden")


@pytest.fixture
def anna(client, db, campus):
    return person(client, db, "anna@geu.ac.in", hostel=campus["A"])


@pytest.fixture
def bina(client, db, campus):
    return person(client, db, "bina@geu.ac.in", hostel=campus["B"])


def post(
    client,
    headers,
    *,
    hostels=(),
    all_hostels=False,
    category="mess",
    title="Mess menu",
    body="Paneer tonight.",
    **extra,
):
    payload = {
        "category": category,
        "title": title,
        "body": body,
        "hostel_ids": list(hostels),
        "all_hostels": all_hostels,
        **extra,
    }
    return client.post("/admin/board", json=payload, headers=headers)


def posted(client, headers, **kwargs) -> dict:
    r = post(client, headers, **kwargs)
    assert r.status_code == 201, r.text
    return r.json()


def board(client, headers) -> list[dict]:
    r = client.get("/board", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["posts"]


def staff_board(client, headers) -> list[dict]:
    r = client.get("/admin/board", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()["posts"]


def audit(db) -> list[tuple[str, str]]:
    rows = db.execute(text("SELECT action, target FROM admin_audit ORDER BY id")).all()
    return [tuple(r) for r in rows]


# ---------- who posts, and who reads ----------


def test_a_warden_posts_to_their_hostel_and_only_its_students_see_it(
    client, db, campus, warden, anna, bina
):
    _, nobody = person(client, db, "nobody@geu.ac.in")  # a student without a hostel
    sent = posted(client, warden[1], hostels=[campus["A"]], body="Paneer\ntonight.")
    assert set(sent) == {"id", "students", "devices"}
    assert sent["students"] == 1 and sent["devices"] == 0

    (seen_by_anna,) = board(client, anna[1])
    assert seen_by_anna == {
        "id": sent["id"],
        "category": "mess",
        "title": "Mess menu",
        "body": "Paneer\ntonight.",
        "from_label": "Hostel office, Hostel A",
        "created_at": seen_by_anna["created_at"],
        "expires_at": seen_by_anna["expires_at"],
        "seen": False,
    }
    assert seen_by_anna["created_at"].endswith("+05:30")
    assert seen_by_anna["expires_at"].endswith("+05:30")
    assert board(client, bina[1]) == []
    assert board(client, nobody) == []


def test_a_warden_cannot_reach_another_hostel_or_every_hostel(client, db, campus, warden):
    for hostels in ([campus["B"]], [campus["A"], campus["B"]], [str(uuid.uuid4())]):
        r = post(client, warden[1], hostels=hostels)
        assert r.status_code == 404, (hostels, r.text)  # as if it didn't exist
    r = post(client, warden[1], all_hostels=True)
    assert (r.status_code, r.json()["detail"]) == (403, ALL_HOSTELS_ONLY)
    for path in ("/admin/board/reach", "/admin/board/draft"):
        assert (
            client.get(path, params={"hostel_ids": campus["B"]}, headers=warden[1]).status_code
            == 404
        )
        assert client.get(path, params={"all_hostels": True}, headers=warden[1]).status_code == 403
    assert db.execute(text("SELECT count(*) FROM board_posts")).scalar_one() == 0


def test_a_warden_without_hostels_is_told_why(client, db, campus):
    _, lone = person(client, db, "lone@geu.ac.in", "warden")
    r = post(client, lone, hostels=[campus["A"]])
    assert (r.status_code, r.json()["detail"]) == (403, NO_HOSTELS)


def test_a_developer_never_posts_or_withdraws_and_reads_an_empty_board(
    client, db, campus, head, anna
):
    _, dev = person(client, db, "dev@geu.ac.in", "developer")
    r = post(client, dev, hostels=[campus["A"]])
    assert (r.status_code, r.json()["detail"]) == (403, NOT_A_POSTER)
    r = post(client, dev, all_hostels=True)
    assert (r.status_code, r.json()["detail"]) == (403, NOT_A_POSTER)
    sent = posted(client, head[1], all_hostels=True)
    r = client.post(f"/admin/board/{sent['id']}/withdraw", headers=dev)
    assert (r.status_code, r.json()["detail"]) == (403, NOT_A_POSTER)
    assert board(client, dev) == []  # not a student: the empty board state
    assert [p["id"] for p in staff_board(client, dev)] == [sent["id"]]
    assert [p["can_withdraw"] for p in staff_board(client, dev)] == [False]


def test_students_get_none_of_the_office_endpoints(client, campus, anna):
    assert post(client, anna[1], hostels=[campus["A"]]).status_code == 403
    assert client.get("/admin/board", headers=anna[1]).status_code == 403
    params = {"hostel_ids": campus["A"]}
    assert client.get("/admin/board/reach", params=params, headers=anna[1]).status_code == 403
    assert client.get("/admin/board/draft", params=params, headers=anna[1]).status_code == 403
    assert client.post("/admin/board/1/withdraw", headers=anna[1]).status_code == 403


def test_signed_out_callers_get_401(client):
    assert client.get("/board").status_code == 401
    assert client.post("/board/seen", json={"ids": [1]}).status_code == 401
    assert client.get("/admin/board").status_code == 401


def test_all_hostels_reaches_every_active_student_including_those_without_one(
    client, db, campus, head, anna, bina
):
    _, nobody = person(client, db, "nobody@geu.ac.in")
    quiet_student(db, "off@geu.ac.in", campus["A"], active=False)  # turned off
    quiet_student(db, "new@geu.ac.in", campus["A"], verified=False)  # never set up
    sent = posted(client, head[1], all_hostels=True)
    assert sent["students"] == 3  # Anna, Bina and the student without a hostel
    for headers in (anna[1], bina[1], nobody):
        assert [(p["id"], p["from_label"]) for p in board(client, headers)] == [
            (sent["id"], "Campus office")
        ]


def test_several_hostels_read_as_the_hostel_office(client, campus, head, anna, bina):
    sent = posted(client, head[1], hostels=[campus["A"], campus["B"]])
    assert sent["students"] == 2
    for headers in (anna[1], bina[1]):
        assert [(p["id"], p["from_label"]) for p in board(client, headers)] == [
            (sent["id"], "Hostel office")
        ]


def test_a_student_who_moves_hostel_reads_the_new_hostels_board(client, db, campus, warden, anna):
    posted(client, warden[1], hostels=[campus["A"]])
    db.execute(
        text("UPDATE users SET hostel_id = :h WHERE id = :u"), {"h": campus["B"], "u": anna[0]}
    )
    db.commit()
    assert board(client, anna[1]) == []


def test_the_board_shows_active_posts_newest_first_at_most_30(client, db, campus, head, anna):
    ids = [
        posted(client, head[1], hostels=[campus["A"]], title=f"Post {i}")["id"] for i in range(3)
    ]
    end_post(db, ids[0])
    assert [p["id"] for p in board(client, anna[1])] == [ids[2], ids[1]]
    db.execute(
        text(
            "INSERT INTO board_posts (author_role, category, title, body, all_hostels, students, "
            "devices, expires_at) SELECT 'admin', 'general', 'Old ' || g, 'x', true, 1, 0, "
            "now() + interval '1 day' FROM generate_series(1, 40) g"
        )
    )
    db.commit()
    assert len(board(client, anna[1])) == 30


# ---------- the office's list and withdrawing ----------


def test_a_warden_lists_their_hostels_posts_and_every_hostel_posts(
    client, db, campus, warden, head
):
    own = posted(client, warden[1], hostels=[campus["A"]], title="Laundry")
    shared = posted(client, head[1], hostels=[campus["A"], campus["B"]], title="Water")
    everyone = posted(client, head[1], all_hostels=True, title="Holiday")
    other = posted(client, head[1], hostels=[campus["B"]], title="B only")

    listed = staff_board(client, warden[1])
    assert [p["id"] for p in listed] == [everyone["id"], shared["id"], own["id"]]
    by_id = {p["id"]: p for p in listed}
    assert by_id[own["id"]]["author"] == "You"
    assert by_id[own["id"]]["can_withdraw"] is True
    assert by_id[shared["id"]]["author"] == "Head warden"
    assert by_id[shared["id"]]["can_withdraw"] is False
    assert by_id[shared["id"]]["hostels"] == [
        {"id": campus["A"], "name": "Hostel A"},
        {"id": campus["B"], "name": "Hostel B"},
    ]
    assert by_id[everyone["id"]]["all_hostels"] is True
    assert by_id[everyone["id"]]["hostels"] == []
    assert by_id[everyone["id"]]["from_label"] == "Campus office"
    assert set(by_id[own["id"]]) == {
        "id",
        "category",
        "title",
        "body",
        "from_label",
        "created_at",
        "expires_at",
        "status",
        "all_hostels",
        "hostels",
        "author",
        "students",
        "seen",
        "can_withdraw",
    }
    assert by_id[own["id"]]["status"] == "active"
    # Every-hostel staff see them all; their own read "You".
    all_ids = [p["id"] for p in staff_board(client, head[1])]
    assert all_ids == [other["id"], everyone["id"], shared["id"], own["id"]]
    assert [p["author"] for p in staff_board(client, head[1])][:3] == ["You", "You", "You"]
    assert staff_board(client, head[1])[3]["author"] == "Warden"


def test_withdrawing_scope_first_then_permission(client, db, campus, warden, head, anna):
    own = posted(client, warden[1], hostels=[campus["A"]])
    theirs = posted(client, head[1], hostels=[campus["A"]])
    elsewhere = posted(client, head[1], hostels=[campus["B"]])

    def withdraw(headers, post_id):
        return client.post(f"/admin/board/{post_id}/withdraw", headers=headers)

    assert withdraw(warden[1], elsewhere["id"]).status_code == 404  # not theirs to see
    assert withdraw(warden[1], 999_999).status_code == 404
    r = withdraw(warden[1], theirs["id"])
    assert (r.status_code, r.json()["detail"]) == (403, WITHDRAW_REFUSED)
    for bad in (0, -1, MAX_ID + 1, "x"):
        assert withdraw(warden[1], bad).status_code == 422, bad

    assert withdraw(warden[1], own["id"]).status_code == 204
    assert withdraw(warden[1], own["id"]).status_code == 204  # idempotent
    assert [p["id"] for p in board(client, anna[1])] == [theirs["id"]]
    statuses = {p["id"]: p["status"] for p in staff_board(client, warden[1])}
    assert statuses[own["id"]] == "withdrawn"
    assert withdraw(head[1], own["id"]).status_code == 204  # already down: nothing changes
    assert [a for a in audit(db) if a[0] == "notice:withdraw"] == [
        ("notice:withdraw", f"post {own['id']}, mess")
    ]
    # Every-hostel staff may take down a warden's post.
    other = posted(client, warden[1], hostels=[campus["A"]])
    assert withdraw(head[1], other["id"]).status_code == 204
    assert board(client, anna[1])[0]["id"] == theirs["id"]
    withdrawn_by = db.execute(
        text("SELECT withdrawn_by FROM board_posts WHERE id = :i"), {"i": other["id"]}
    ).scalar_one()
    assert str(withdrawn_by) == head[0]


def test_ended_posts_read_as_ended_and_cannot_be_withdrawn(client, db, campus, warden):
    sent = posted(client, warden[1], hostels=[campus["A"]])
    end_post(db, sent["id"])
    (listed,) = staff_board(client, warden[1])
    assert (listed["status"], listed["can_withdraw"]) == ("ended", False)
    # Withdrawing it changes nothing: still ended, no audit row.
    assert client.post(f"/admin/board/{sent['id']}/withdraw", headers=warden[1]).status_code == 204
    assert staff_board(client, warden[1])[0]["status"] == "ended"
    assert [a for a in audit(db) if a[0] == "notice:withdraw"] == []


# ---------- validation ----------


@pytest.mark.parametrize(
    "body",
    [
        "Tabs\tare not text",
        "Right-to-left " + chr(0x202E) + " override",
        "Line" + chr(0x2028) + "separator",
        "Para" + chr(0x2029) + "separator",
        "Nul\x00",
        "Zero" + chr(0x200B) + "width",
        "Three\n\n\nbreaks",
        "\n".join(["line"] * 21),
        "x" * 601,
        "",
        "   \n  ",
    ],
)
def test_a_body_with_anything_but_text_and_line_breaks_is_refused(client, campus, warden, body):
    assert post(client, warden[1], hostels=[campus["A"]], body=body).status_code == 422


@pytest.mark.parametrize(
    ("sent", "stored"),
    [
        ("Line one\r\nLine two", "Line one\nLine two"),
        ("Old Mac\rbreak", "Old Mac\nbreak"),
        ("One blank line\n\nis fine", "One blank line\n\nis fine"),
        ("  trimmed \n", "trimmed"),
        ("x" * 600, "x" * 600),
        ("\r\n".join(["l"] * 20), "\n".join(["l"] * 20)),
        ("Hindi " + chr(0x0915) + chr(0x094D) + chr(0x200D) + " joiner", None),
        ("<img src=x onerror=alert(1)>", None),
    ],
)
def test_a_body_keeps_its_line_breaks_as_plain_newlines(client, campus, warden, anna, sent, stored):
    posted(client, warden[1], hostels=[campus["A"]], body=sent)
    assert board(client, anna[1])[0]["body"] == (stored if stored is not None else sent)


@pytest.mark.parametrize(
    "title",
    ["Two\nlines", "x" * 61, "!!!", "", "   ", "Bidi " + chr(0x202E), "Tab\there"],
)
def test_a_title_is_one_short_line_with_a_letter_or_digit(client, campus, warden, title):
    assert post(client, warden[1], hostels=[campus["A"]], title=title).status_code == 422


def test_a_title_of_60_characters_is_fine(client, campus, warden):
    posted(client, warden[1], hostels=[campus["A"]], title="t" * 60)


@pytest.mark.parametrize(
    "change",
    [
        {"category": "parcels"},
        {"all_hostels": True},  # and hostels too
        {"hostel_ids": []},  # neither
        {"duplicate": True},
        {"too_many": True},
        {"expires_in_days": 2},
        {"expires_in_days": 0},
        {"hostel_ids": ["not-a-uuid"]},
        {"extra": "field"},
    ],
)
def test_bad_posts_are_422(client, db, campus, head, change):
    payload = {
        "category": "mess",
        "title": "T",
        "body": "B",
        "hostel_ids": [campus["A"]],
        "all_hostels": False,
    }
    if change.pop("duplicate", False):
        payload["hostel_ids"] = [campus["A"], campus["A"]]
    if change.pop("too_many", False):
        payload["hostel_ids"] = [str(uuid.uuid4()) for _ in range(51)]
    payload.update(change)
    r = client.post("/admin/board", json=payload, headers=head[1])
    assert r.status_code == 422, r.text
    assert db.execute(text("SELECT count(*) FROM board_posts")).scalar_one() == 0


def test_unknown_hostels_are_404_for_every_hostel_staff_too(client, campus, head):
    assert post(client, head[1], hostels=[str(uuid.uuid4())]).status_code == 404
    assert post(client, head[1], hostels=[campus["A"], str(uuid.uuid4())]).status_code == 404


def test_reach_and_draft_validate_their_targets_the_same_way(client, campus, head):
    for path in ("/admin/board/reach", "/admin/board/draft"):
        get = functools.partial(client.get, path, headers=head[1])
        assert get().status_code == 422  # neither
        assert get(params={"hostel_ids": campus["A"], "all_hostels": True}).status_code == 422
        assert get(params={"hostel_ids": [campus["A"], campus["A"]]}).status_code == 422
        many = [str(uuid.uuid4()) for _ in range(51)]
        assert get(params={"hostel_ids": many}).status_code == 422
        assert get(params={"hostel_ids": "nope"}).status_code == 422
        assert get(params={"hostel_ids": str(uuid.uuid4())}).status_code == 404


@pytest.mark.parametrize(
    ("category", "days", "expected"),
    [("timings", None, 30), ("mess", None, 7), ("mess", 60, 60), ("laundry", 1, 1)],
)
def test_the_server_sets_when_a_post_ends(client, db, campus, warden, category, days, expected):
    extra = {} if days is None else {"expires_in_days": days}
    sent = posted(client, warden[1], hostels=[campus["A"]], category=category, **extra)
    created, expires = db.execute(
        text("SELECT created_at, expires_at FROM board_posts WHERE id = :i"), {"i": sent["id"]}
    ).one()
    assert expires - created == timedelta(days=expected)


def test_a_client_clock_is_never_accepted(client, campus, warden):
    later = (datetime.now(UTC) + timedelta(days=400)).isoformat()
    r = post(client, warden[1], hostels=[campus["A"]], expires_at=later)
    assert r.status_code == 422


@pytest.mark.parametrize("ids", [[], list(range(1, 32)), [0], [MAX_ID + 1], ["x"], [-5]])
def test_seen_ids_are_bounded(client, anna, ids):
    assert client.post("/board/seen", json={"ids": ids}, headers=anna[1]).status_code == 422


def test_posting_is_rate_limited_before_anything_is_written(client, db, campus, warden):
    for _ in range(10):
        posted(client, warden[1], hostels=[campus["A"]])
    r = post(client, warden[1], hostels=[campus["A"]])
    assert r.status_code == 429
    assert "Retry-After" in r.headers
    assert db.execute(text("SELECT count(*) FROM board_posts")).scalar_one() == 10
    assert len([a for a in audit(db) if a[0] == "notice:post"]) == 10
    # Withdrawing has no limit.
    first = staff_board(client, warden[1])[-1]["id"]
    assert client.post(f"/admin/board/{first}/withdraw", headers=warden[1]).status_code == 204


# ---------- seen ----------


def test_seen_is_recorded_once_and_only_for_posts_the_student_can_see(
    client, db, campus, warden, head, anna
):
    mine = posted(client, warden[1], hostels=[campus["A"]])
    elsewhere = posted(client, head[1], hostels=[campus["B"]])
    gone = posted(client, head[1], hostels=[campus["A"]])
    client.post(f"/admin/board/{gone['id']}/withdraw", headers=head[1])
    ids = [mine["id"], elsewhere["id"], gone["id"], MAX_ID, mine["id"]]
    for _ in range(2):  # idempotent
        r = client.post("/board/seen", json={"ids": ids}, headers=anna[1])
        assert r.status_code == 204, r.text
    rows = db.execute(text("SELECT post_id, user_id FROM board_post_seen")).all()
    assert [(p, str(u)) for p, u in rows] == [(mine["id"], anna[0])]
    assert [(p["id"], p["seen"]) for p in board(client, anna[1])] == [(mine["id"], True)]


def test_seen_from_anyone_but_a_student_is_a_quiet_no_op(client, db, campus, warden, head):
    sent = posted(client, head[1], all_hostels=True)
    r = client.post("/board/seen", json={"ids": [sent["id"]]}, headers=warden[1])
    assert r.status_code == 204
    assert db.execute(text("SELECT count(*) FROM board_post_seen")).scalar_one() == 0


# ---------- counts ----------


def mark_seen(db, post_id: int, *students: str) -> None:
    for s in students:
        db.execute(
            text("INSERT INTO board_post_seen (post_id, user_id) VALUES (:p, :u)"),
            {"p": post_id, "u": s},
        )
    db.commit()


def seen_count(client, headers, post_id: int):
    return next(p for p in staff_board(client, headers) if p["id"] == post_id)["seen"]


@pytest.mark.parametrize(
    ("students", "seen", "shown"),
    [
        (20, 0, None),  # fewer than 5 opened it
        (20, 4, None),
        (20, 5, 5),  # 5 to 9
        (20, 9, 5),
        (20, 14, 10),
        (20, 15, 15),  # 5 left who haven't
        (20, 16, None),  # fewer than 5 haven't: says who opened it, nearly
        (20, 20, None),
        (4, 0, None),  # sent to fewer than 5
        (9, 5, None),  # 4 haven't
        (10, 5, 5),
        (312, 240, 240),
        (312, 244, 240),
    ],
)
def test_a_seen_count_is_shown_only_in_steps_of_five_away_from_either_edge(students, seen, shown):
    """Owner, 2026-11-26 (audit run-16): exact counts let staff difference two overlapping
    posts and learn whether one student opened one; a step of 5, hidden while fewer than 5
    did or didn't open it, never moves for one student alone."""
    assert board_svc.seen_band(students, seen) == shown


def test_seen_counts_the_audience_as_sent_whoever_moves_later(client, db, campus, warden):
    """Before: a count over the students the post was *still* for, so moving one student out
    (or turning them off) and reading the count again told whether they had opened it."""
    students = [quiet_student(db, f"s{i}@geu.ac.in", campus["A"]) for i in range(12)]
    sent = posted(client, warden[1], hostels=[campus["A"]])
    assert sent["students"] == 12
    assert seen_count(client, warden[1], sent["id"]) is None  # nobody yet: under 5
    mark_seen(db, sent["id"], *students[:6])
    assert seen_count(client, warden[1], sent["id"]) == 5  # 6 opened it: "5 to 9"

    # A reader moves out, another is turned off: the count is over the audience as sent, so
    # it doesn't move and says nothing about either.
    db.execute(
        text("UPDATE users SET hostel_id = :h WHERE id = :u"), {"h": campus["B"], "u": students[0]}
    )
    db.execute(text("UPDATE users SET deactivated_at = now() WHERE id = :u"), {"u": students[1]})
    db.commit()
    (listed,) = staff_board(client, warden[1])
    assert (listed["students"], listed["seen"]) == (12, 5)

    # A student moved in later who opens it isn't in the audience as sent: not counted.
    newcomer = quiet_student(db, "late@geu.ac.in", campus["A"])
    mark_seen(db, sent["id"], newcomer)
    assert seen_count(client, warden[1], sent["id"]) == 5
    # Four more of the first twelve: 10 opened it and 2 haven't, too few to show.
    mark_seen(db, sent["id"], *students[6:10])
    assert seen_count(client, warden[1], sent["id"]) is None


def test_the_audience_as_sent_is_kept_per_post_and_goes_with_the_post(client, db, campus, warden):
    students = [quiet_student(db, f"s{i}@geu.ac.in", campus["A"]) for i in range(6)]
    quiet_student(db, "off@geu.ac.in", campus["A"], active=False)
    quiet_student(db, "b@geu.ac.in", campus["B"])
    sent = posted(client, warden[1], hostels=[campus["A"]])
    rows = db.execute(
        text("SELECT user_id::text FROM board_post_audience WHERE post_id = :p"), {"p": sent["id"]}
    ).scalars()
    assert sorted(rows) == sorted(students)
    assert sent["students"] == 6
    db.execute(text("DELETE FROM board_posts WHERE id = :p"), {"p": sent["id"]})
    db.commit()
    assert db.execute(text("SELECT count(*) FROM board_post_audience")).scalar_one() == 0


def test_names_and_ids_of_readers_are_never_sent(client, db, campus, warden):
    students = [quiet_student(db, f"s{i}@geu.ac.in", campus["A"]) for i in range(6)]
    sent = posted(client, warden[1], hostels=[campus["A"]])
    mark_seen(db, sent["id"], *students)
    raw = client.get("/admin/board", headers=warden[1]).text
    assert "Quiet" not in raw
    assert not any(s in raw for s in students)


# ---------- the draft from the outing rules ----------


def campus_today() -> str:
    d = datetime.now(UTC).astimezone(IST)
    return f"{d:%a} {d.day} {d:%b}"


def draft(client, headers, **params) -> dict:
    r = client.get("/admin/board/draft", params=params, headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def add_rule_set(db, name: str, rules: list[tuple]) -> str:
    """rules: (day_type, opens, return_by, max_minutes, needs_form, no_form_from)."""
    rid = db.execute(
        text("INSERT INTO rule_sets (name) VALUES (:n) RETURNING id"), {"n": name}
    ).scalar_one()
    for day, opens, back, most, form, free in rules:
        db.execute(
            text(
                "INSERT INTO day_rules (rule_set_id, day_type, opens_at, return_by, max_minutes, "
                "needs_form, no_form_from) VALUES (:r, :d, CAST(:o AS time), CAST(:b AS time), "
                ":m, :f, CAST(:n AS time))"
            ),
            {"r": rid, "d": day, "o": opens, "b": back, "m": most, "f": form, "n": free},
        )
    db.commit()
    return str(rid)


BOYS = [
    ("weekday", "18:00", "20:00", None, False, None),
    ("saturday", "18:00", "20:00", None, False, None),
    ("sunday", "10:00", "20:00", 180, True, "18:00"),
    ("holiday", "10:00", "20:00", 180, True, "18:00"),
]
GIRLS = [
    ("weekday", "18:00", "20:00", None, False, None),
    ("saturday", "18:00", "20:00", None, False, None),
    ("sunday", "10:00", "20:00", 300, True, None),
    ("holiday", "10:00", "20:00", 300, True, None),
]
BOYS_LINES = (
    f"Weekdays and Saturday: 6:00 PM{DASH}8:00 PM {DOT} no form needed\n"
    f"Sunday and Holidays: 10:00 AM{DASH}8:00 PM {DOT} needs approval {DOT} up to 3 h "
    f"{DOT} no form needed from 6:00 PM"
)
GIRLS_LINES = (
    f"Weekdays and Saturday: 6:00 PM{DASH}8:00 PM {DOT} no form needed\n"
    f"Sunday and Holidays: 10:00 AM{DASH}8:00 PM {DOT} needs approval {DOT} up to 5 h"
)


def test_the_draft_for_one_rule_set_is_its_lines(client, db, campus, warden):
    assert draft(client, warden[1], hostel_ids=campus["A"]) == {
        "title": "Outing timings",
        "body": f"Outing timings from {campus_today()}:\n"
        f"Weekdays, Saturday, Sunday and Holidays: {OPEN_LINE}",
        "category": "timings",
        "too_long": False,
    }


def test_the_draft_for_several_rule_sets_has_a_block_each(client, db, campus, head):
    boys = add_rule_set(db, "Boys' hostels", BOYS)
    girls = add_rule_set(db, "Girls' hostels", GIRLS)
    b1, b2 = make_hostel(db, "Boys 1", boys), make_hostel(db, "Boys 2", boys)
    g1 = make_hostel(db, "Girls 1", girls)
    got = draft(client, head[1], hostel_ids=[g1, b2, b1])
    assert got["body"] == (
        f"Outing timings from {campus_today()}:\n\n"
        f"Boys 1, Boys 2:\n{BOYS_LINES}\n\n"
        f"Girls 1:\n{GIRLS_LINES}"
    )
    assert got["too_long"] is False
    # Sent as drafted, it is a valid post.
    posted(
        client,
        head[1],
        hostels=[g1, b2, b1],
        category="timings",
        title=got["title"],
        body=got["body"],
    )


def test_the_draft_for_all_hostels_tells_students_without_a_hostel_too(client, db, campus, head):
    scholars = add_rule_set(db, "Day scholars", GIRLS)
    db.execute(text("UPDATE campus_settings SET default_rule_set_id = :r"), {"r": scholars})
    db.commit()
    got = draft(client, head[1], all_hostels=True)
    assert got["body"] == (
        f"Outing timings from {campus_today()}:\n\n"
        f"Hostel A, Hostel B, Hostel C:\nWeekdays, Saturday, Sunday and Holidays: {OPEN_LINE}\n\n"
        f"Students without a hostel:\n{GIRLS_LINES}"
    )
    # When a hostel follows the default rules, no separate block.
    db.execute(
        text("UPDATE hostels SET rule_set_id = :r WHERE id = :h"), {"r": scholars, "h": campus["C"]}
    )
    db.commit()
    assert "Students without a hostel" not in draft(client, head[1], all_hostels=True)["body"]


def test_a_draft_too_long_to_send_says_so(client, db, head):
    for n in range(8):
        rules = [(d, "06:00", f"{12 + n}:00", None, False, None) for d in ("weekday", "sunday")]
        rid = add_rule_set(db, f"Set {n}", rules)
        for k in range(3):
            make_hostel(db, f"A rather long hostel name number {n}-{k}", rid)
    got = draft(client, head[1], all_hostels=True)
    assert got["too_long"] is True
    assert len(got["body"]) > 600 or got["body"].count("\n") >= 20


def test_a_holiday_draft(client, db, campus, warden):
    db.execute(text("INSERT INTO holidays (day, name) VALUES ('2026-12-25', 'Christmas')"))
    db.commit()
    got = draft(client, warden[1], hostel_ids=campus["A"], holiday="2026-12-25")
    assert got == {
        "title": "Christmas on Fri 25 Dec",
        "body": f"Holiday hours: {OPEN_LINE}",
        "category": "timings",
        "too_long": False,
    }
    params = {"hostel_ids": campus["A"], "holiday": "2026-12-26"}
    r = client.get("/admin/board/draft", params=params, headers=warden[1])
    assert r.status_code == 404  # no holiday that day
    params["holiday"] = "26/12/2026"
    assert client.get("/admin/board/draft", params=params, headers=warden[1]).status_code == 422


def test_a_holiday_draft_for_rule_sets_that_differ(client, db, head):
    boys = add_rule_set(db, "Boys' hostels", BOYS)
    girls = add_rule_set(db, "Girls' hostels", GIRLS)
    b1, g1 = make_hostel(db, "Boys 1", boys), make_hostel(db, "Girls 1", girls)
    db.execute(text("INSERT INTO holidays (day, name) VALUES ('2026-12-25', 'Christmas')"))
    db.commit()
    got = draft(client, head[1], hostel_ids=[b1, g1], holiday="2026-12-25")
    assert got["body"] == (
        "Holiday hours:\n"
        f"Boys 1: 10:00 AM{DASH}8:00 PM {DOT} needs approval {DOT} up to 3 h {DOT} "
        "no form needed from 6:00 PM\n"
        f"Girls 1: 10:00 AM{DASH}8:00 PM {DOT} needs approval {DOT} up to 5 h"
    )


# ---------- one transaction: audit, replace timings ----------


def test_a_post_is_audited_without_its_title_or_body(client, db, campus, warden, anna):
    sent = posted(
        client, warden[1], hostels=[campus["A"]], title="Secret title", body="Secret body"
    )
    assert audit(db) == [("notice:post", f"post {sent['id']}, mess, 1 students, Hostel A")]
    _, admin = person(client, db, "a@geu.ac.in", "admin")
    everyone = posted(client, admin, all_hostels=True)
    assert audit(db)[-1] == ("notice:post", f"post {everyone['id']}, mess, 1 students, all hostels")


def test_replacing_timings_takes_down_only_older_timings_the_sender_may_withdraw(
    client, db, campus, warden, head, anna
):
    old = posted(client, warden[1], hostels=[campus["A"]], category="timings")
    mess = posted(client, warden[1], hostels=[campus["A"]], category="mess")
    wider = posted(client, warden[1], hostels=[campus["A"]], category="timings")
    db.execute(
        text("INSERT INTO board_post_hostels (post_id, hostel_id) VALUES (:p, :h)"),
        {"p": wider["id"], "h": campus["B"]},
    )
    db.commit()
    heads = posted(client, head[1], hostels=[campus["A"]], category="timings")

    kept = posted(client, warden[1], hostels=[campus["A"]], category="timings")  # no replace
    new = posted(client, warden[1], hostels=[campus["A"]], category="timings", replace_timings=True)
    live = {p["id"] for p in board(client, anna[1])}
    # Its own older timings posts to a subset of the new targets go; the head warden's (not
    # the warden's to withdraw), the wider one (B too) and the mess post stay.
    assert old["id"] not in live and kept["id"] not in live
    assert {mess["id"], wider["id"], heads["id"], new["id"]} <= live
    withdrawn = [a for a in audit(db) if a[0] == "notice:withdraw"]
    assert sorted(withdrawn) == sorted(
        [
            ("notice:withdraw", f"post {old['id']}, timings"),
            ("notice:withdraw", f"post {kept['id']}, timings"),
        ]
    )

    # An all-hostels timings post from every-hostel staff replaces every older timings post.
    final = posted(client, head[1], all_hostels=True, category="timings", replace_timings=True)
    assert {p["id"] for p in board(client, anna[1])} == {mess["id"], final["id"]}


def test_replace_timings_is_ignored_for_other_categories(client, campus, warden, anna):
    old = posted(client, warden[1], hostels=[campus["A"]], category="timings")
    posted(client, warden[1], hostels=[campus["A"]], category="mess", replace_timings=True)
    assert old["id"] in {p["id"] for p in board(client, anna[1])}


# ---------- push ----------

BOARD = "hostel-board"


def register(client, headers, token: str, *, board=None, muted=()):
    body = {"token": token, "platform": "android", "muted": list(muted)}
    if board is not None:
        body["board"] = board
    r = client.post("/devices/push-token", json=body, headers=headers)
    assert r.status_code == 204, r.text


def board_flag(db, token: str) -> bool:
    return db.execute(
        text("SELECT board FROM push_tokens WHERE token = :t"), {"t": token}
    ).scalar_one()


def test_registration_says_whether_the_app_has_the_board_channel(client, db, anna):
    token = "ExponentPushToken[annaPhone0001]"
    register(client, anna[1], token)
    assert board_flag(db, token) is False
    register(client, anna[1], token, board=True)
    assert board_flag(db, token) is True
    register(client, anna[1], token)  # re-registered without it: older JS again
    assert board_flag(db, token) is False
    register(
        client,
        anna[1],
        token,
        board=True,
        muted=[BOARD, "follow-requests", "share-status", "return-reminders"],
    )
    muted = db.execute(text("SELECT muted FROM push_tokens WHERE token = :t"), {"t": token})
    assert sorted(muted.scalar_one()) == sorted(
        [BOARD, "follow-requests", "share-status", "return-reminders"]
    )
    body = {"token": token, "platform": "android", "board": "sometimes"}
    assert client.post("/devices/push-token", json=body, headers=anna[1]).status_code == 422


def test_reach_and_the_push_go_only_to_students_phones_with_the_channel(
    client, db, campus, warden, head, anna, push
):
    phones = {
        "anna": "ExponentPushToken[annaPhone0001]",
        "old_app": "ExponentPushToken[oldAppPhone02]",
        "muted": "ExponentPushToken[mutedPhone003]",
        "signed_out": "ExponentPushToken[outPhone00004]",
        "warden": "ExponentPushToken[wardenPhone05]",
        "bina": "ExponentPushToken[binaPhone0006]",
    }
    register(client, anna[1], phones["anna"], board=True)
    _, old_app = person(client, db, "old@geu.ac.in", hostel=campus["A"])
    register(client, old_app, phones["old_app"])  # no channel yet: board false
    _, muted = person(client, db, "mute@geu.ac.in", hostel=campus["A"])
    register(client, muted, phones["muted"], board=True, muted=[BOARD])
    out_id, out = person(client, db, "out@geu.ac.in", hostel=campus["A"])
    register(client, out, phones["signed_out"], board=True)
    db.execute(
        text("UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = :u"), {"u": out_id}
    )
    db.commit()
    register(client, warden[1], phones["warden"], board=True)  # staff: not a student
    _, bina = person(client, db, "bina@geu.ac.in", hostel=campus["B"])
    register(client, bina, phones["bina"], board=True)

    reach = client.get("/admin/board/reach", params={"hostel_ids": campus["A"]}, headers=warden[1])
    assert reach.status_code == 200, reach.text
    assert reach.json() == {"students": 4, "devices": 1}

    body = "A" * 150
    sent = posted(client, warden[1], hostels=[campus["A"]], title="Water off", body=body)
    assert (sent["students"], sent["devices"]) == (4, 1)
    ((tokens, message),) = push.outbox
    assert tokens == [phones["anna"]]
    assert message == PushMessage(
        title="Water off",
        body="A" * 140,
        url="/today/board",
        channel=BOARD,
        tag=f"board:{sent['id']}",
        ttl=DAY,
    )
    assert message.urgent is False and message.data_only is False

    everyone = client.get("/admin/board/reach", params={"all_hostels": True}, headers=head[1])
    assert everyone.json() == {"students": 5, "devices": 2}  # Bina's phone too


def test_a_post_stands_when_the_server_has_no_push(client, campus, warden, anna):
    client.app.state.push = None
    sent = posted(client, warden[1], hostels=[campus["A"]])
    assert [p["id"] for p in board(client, anna[1])] == [sent["id"]]


def test_withdrawing_sends_no_push(client, campus, warden, push):
    sent = posted(client, warden[1], hostels=[campus["A"]])
    before = len(push.outbox)
    client.post(f"/admin/board/{sent['id']}/withdraw", headers=warden[1])
    assert len(push.outbox) == before


def test_only_the_board_sends_board_posts():
    callers = sorted(
        p.relative_to(BACKEND).as_posix()
        for folder in ("app", "scripts", "migrations")
        for p in (BACKEND / folder).rglob("*.py")
        if "send_board_post" in p.read_text(encoding="utf-8")
    )
    assert callers == ["app/api/board.py", "app/push.py"]
    assert "push_everyone" not in (BACKEND / "app/api/board.py").read_text(encoding="utf-8")


def test_no_database_connection_is_held_while_expo_answers_a_board_post(client, db, campus, anna):
    from app.push import send_board_post

    register(client, anna[1], "ExponentPushToken[annaPhone0001]", board=True)
    maker = client.app.state.sessionmaker
    sender = PoolWatchingSender(pool=maker.kw["bind"].pool)
    message = PushMessage(title="Hi", body="There", channel=BOARD, tag="board:1", ttl=DAY)
    outcome = client.portal.call(send_board_post, maker, sender, message, [uuid.UUID(campus["A"])])
    assert sender.held == [0]
    assert (outcome.devices, outcome.accepted) == (1, 1)
    assert db.execute(text("SELECT count(*) FROM push_tickets")).scalar_one() == 1


def test_a_failing_board_push_never_raises(client, campus, anna):
    from app.push import send_board_post

    @dataclasses.dataclass
    class Broken(MemoryPushSender):
        async def send(self, tokens, message):
            raise RuntimeError("expo down")

    register(client, anna[1], "ExponentPushToken[annaPhone0001]", board=True)
    message = PushMessage(title="Hi", body="There", channel=BOARD, tag="board:1", ttl=DAY)
    outcome = client.portal.call(
        send_board_post, client.app.state.sessionmaker, Broken(), message, None
    )
    assert outcome.accepted == 0


# ---------- retention ----------


def test_the_sweep_deletes_posts_180_days_after_they_ended(client, db, campus, anna):
    def old_post(created: int, expires: int, withdrawn: int | None) -> int:
        pid = db.execute(
            text(
                "INSERT INTO board_posts (author_role, category, title, body, all_hostels, "
                "students, devices, created_at, expires_at, withdrawn_at) VALUES ('admin', "
                "'general', 'T', 'B', false, 1, 0, now() - make_interval(days => :c), "
                "now() - make_interval(days => :e), "
                "now() - make_interval(days => :w)) RETURNING id"
            ),
            {"c": created, "e": expires, "w": withdrawn},
        ).scalar_one()
        db.execute(
            text("INSERT INTO board_post_hostels (post_id, hostel_id) VALUES (:p, :h)"),
            {"p": pid, "h": campus["A"]},
        )
        db.execute(
            text("INSERT INTO board_post_seen (post_id, user_id) VALUES (:p, :u)"),
            {"p": pid, "u": anna[0]},
        )
        db.commit()
        return pid

    ended_long_ago = old_post(220, 190, None)
    withdrawn_long_ago = old_post(220, 170, 190)  # ended 170 days ago, but taken down at 190
    ended_recently = old_post(220, 170, None)
    withdrawn_recently = old_post(200, 100, 170)
    result = client.portal.call(sweep, client.app.state.sessionmaker, client.app.state.hub)
    assert result.deleted_board_posts == 2
    left = set(db.execute(text("SELECT id FROM board_posts")).scalars())
    assert left == {ended_recently, withdrawn_recently}
    for table in ("board_post_hostels", "board_post_seen"):
        ids = set(db.execute(text(f"SELECT post_id FROM {table}")).scalars())  # noqa: S608
        assert ids == left, table
    assert ended_long_ago not in left and withdrawn_long_ago not in left


def test_deleting_a_hostel_drops_its_targets_and_the_post_stays_for_the_office(
    client, db, campus, head
):
    sent = posted(client, head[1], hostels=[campus["A"]])
    db.execute(text("DELETE FROM hostels WHERE id = :h"), {"h": campus["A"]})
    db.commit()
    (listed,) = staff_board(client, head[1])
    assert (listed["id"], listed["hostels"], listed["from_label"]) == (
        sent["id"],
        [],
        "Hostel office",
    )
    # With no hostel left, no warden covers it: as if it didn't exist (never vacuously theirs).
    _, b_warden = person(client, db, "wb@geu.ac.in", "warden", wards=[campus["B"]])
    assert staff_board(client, b_warden) == []
    r = client.post(f"/admin/board/{sent['id']}/withdraw", headers=b_warden)
    assert r.status_code == 404


# ---------- the student's own data ----------


def test_the_export_lists_the_posts_the_student_saw_without_their_text(
    client, db, campus, warden, anna
):
    seen = posted(client, warden[1], hostels=[campus["A"]], title="Water off", body="Secret")
    posted(client, warden[1], hostels=[campus["A"]], title="Not opened")
    assert (
        client.post("/board/seen", json={"ids": [seen["id"]]}, headers=anna[1]).status_code == 204
    )
    r = client.get("/profile/export", headers=anna[1])
    assert r.status_code == 200, r.text
    assert r.json()["board_posts_seen"] == [{"title": "Water off", "category": "mess"}]
    # The audience record (seen counts are over it) is theirs too: every post sent to them.
    assert r.json()["board_posts_for_you"] == [
        {"title": "Water off", "category": "mess"},
        {"title": "Not opened", "category": "mess"},
    ]
    assert "Secret" not in r.text
