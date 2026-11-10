"""Role-scoped search (wave 5). Owner, 2026-11-09 (D1 "Both"): role chips for admins and
developers on People, and every search scoped to what the searcher may see: a warden their
hostels' students, a head warden every hostel's students, admins and developers everyone. The
scope is decided on the server; no parameter, alone or combined, widens it. Every admin search
endpoint is rate limited per person.
"""

import pytest
from sqlalchemy import text

from app.security.rate_limit import Limit
from tests import test_alerts as alerts
from tests import test_office_data as data
from tests.helpers import signup
from tests.test_office_data import go_out, names, refused_scan
from tests.test_wardens import set_role

# The office data fixtures: an admin, Hostels A and B, Anna (A) and Bina (B), a warden of A, a
# head warden and a developer.
admin, hostels, anna, bina = data.admin, data.hostels, data.anna, data.bina
warden, head, dev = data.warden, data.head, data.dev
many_sign_ups = alerts.many_sign_ups  # more sign-ups than one IP may make in an hour

USERS = "/admin/users"
STUDENTS = "/admin/students"


@pytest.fixture
def warden_b(client, admin, hostels):
    headers = signup(client, "warden.b@geu.ac.in", "Warden B")[1]
    assert set_role(client, admin, "warden.b@geu.ac.in", "warden", [hostels["B"]]).is_success
    return headers


@pytest.fixture
def everyone(client, admin, warden, warden_b, head, dev, anna, bina):
    """Two students (one per hostel), out and with a refused scan each; every staff role."""
    for headers in (anna, bina):
        refused_scan(client, headers)
        go_out(client, headers)
    return {"admin": admin, "warden": warden, "head": head, "dev": dev}


def listed(r) -> list[str]:
    assert r.status_code == 200, r.text
    body = r.json()
    return names(body["items"] if isinstance(body, dict) else body)


# ---------- role chips (admins and developers) ----------


def test_admins_list_people_by_role_with_or_without_a_search(client, everyone):
    admin = everyone["admin"]
    assert listed(client.get(USERS, params={"role": "warden"}, headers=admin)) == [
        "Warden A",
        "Warden B",
    ]
    both = client.get(USERS, params={"role": ["warden", "head_warden"]}, headers=admin)
    assert listed(both) == ["Head Warden", "Warden A", "Warden B"]
    assert listed(client.get(USERS, params={"role": "student", "q": "ann"}, headers=admin)) == [
        "Anna Rawat"
    ]
    assert listed(client.get(USERS, params={"role": "developer"}, headers=admin)) == ["Dev Eloper"]
    # A developer has admin powers here too.
    dev = everyone["dev"]
    assert listed(client.get(USERS, params={"role": "admin"}, headers=dev)) == ["Office Admin"]
    # The search alone still works as before.
    assert listed(client.get(USERS, params={"q": "warden"}, headers=admin)) == [
        "Head Warden",
        "Warden A",
        "Warden B",
    ]


def test_a_search_lists_staff_first_most_powers_first(client, everyone):
    """Admins and developers, head wardens, wardens, then students; by name within each. (The
    role is stored as text: sorting it directly put wardens and students before admins.)"""
    # Everyone's email is @geu.ac.in, so this finds every role.
    r = client.get(USERS, params={"q": "geu.ac.in"}, headers=everyone["admin"])
    assert r.status_code == 200, r.text
    assert [p["name"] for p in r.json()] == [
        "Dev Eloper",
        "Office Admin",
        "Head Warden",
        "Warden A",
        "Warden B",
        "Anna Rawat",
        "Bina Negi",
    ]


@pytest.mark.parametrize(
    "params",
    [{}, {"role": "nobody"}, {"role": "student", "q": "a"}, {"q": "x" * 101}],
)
def test_the_people_search_needs_a_term_or_a_real_role(client, everyone, params):
    assert client.get(USERS, params=params, headers=everyone["admin"]).status_code == 422


def test_a_role_listing_pages_by_cursor(client, everyone, monkeypatch):
    monkeypatch.setattr("app.services.admin.ROLE_PAGE", 2)
    admin = everyone["admin"]
    params = {"role": ["warden", "head_warden"]}
    first = client.get(USERS, params=params, headers=admin).json()
    assert [p["name"] for p in first] == ["Head Warden", "Warden A"]
    rest = client.get(USERS, params={**params, "after": first[-1]["id"]}, headers=admin).json()
    assert [p["name"] for p in rest] == ["Warden B"]
    # An id that is no one's is an empty page, never the first page again.
    unknown = "00000000-0000-4000-8000-000000000000"
    assert client.get(USERS, params={**params, "after": unknown}, headers=admin).json() == []


def test_a_cursor_on_a_search_pages_it_staff_first(client, everyone):
    """`after` pages a search as well as a role listing (once refused: a search had no pages)."""
    admin = everyone["admin"]
    every = client.get(USERS, params={"q": "warden"}, headers=admin).json()
    assert [p["name"] for p in every] == ["Head Warden", "Warden A", "Warden B"]
    r = client.get(USERS, params={"q": "warden", "after": every[0]["id"]}, headers=admin)
    assert r.status_code == 200, r.text
    assert [p["name"] for p in r.json()] == ["Warden A", "Warden B"]


@pytest.mark.parametrize("path", [USERS, STUDENTS])
def test_a_role_list_is_deduplicated_and_no_longer_than_the_roles(client, everyone, path):
    admin = everyone["admin"]
    twice = client.get(path, params={"role": ["warden", "warden"]}, headers=admin)
    assert listed(twice) == ["Warden A", "Warden B"]
    every = ["student", "warden", "head_warden", "admin", "developer"]
    assert client.get(path, params={"role": every}, headers=admin).status_code == 200
    r = client.get(path, params={"role": [*every, "student"]}, headers=admin)
    assert r.status_code == 422, r.text


def test_admins_filter_the_student_list_by_role(client, everyone):
    admin = everyone["admin"]
    assert listed(client.get(STUDENTS, params={"role": "warden"}, headers=admin)) == [
        "Warden A",
        "Warden B",
    ]
    assert listed(client.get(STUDENTS, params={"role": "student"}, headers=admin)) == [
        "Anna Rawat",
        "Bina Negi",
    ]


def test_wardens_and_head_wardens_may_not_use_the_people_search(client, everyone):
    for who in ("warden", "head"):
        r = client.get(USERS, params={"role": "student"}, headers=everyone[who])
        assert r.status_code == 403, who


# ---------- nobody widens their scope ----------

# (params, whether the warden's own student, Anna, still matches them): where she does, she
# must be listed, so an empty answer can't pass for a scoped one.
WIDEN = [
    ({}, True),
    ({"role": "warden"}, True),  # ignored from a warden: students only
    ({"role": "admin"}, True),
    ({"role": ["student", "warden", "head_warden", "admin", "developer"]}, True),
    ({"q": "bina"}, False),
    ({"q": "warden"}, False),
    ({"q": "negi", "role": "student"}, False),
    ({"account": "off"}, False),
    ({"account": "invited"}, False),
    ({"role": "admin", "account": "invited", "q": "of"}, False),
]


@pytest.mark.parametrize(("params", "own"), WIDEN)
def test_a_warden_sees_only_their_hostels_students_whatever_they_send(
    client, everyone, params, own
):
    rows = listed(client.get(STUDENTS, params=params, headers=everyone["warden"]))
    assert rows == (["Anna Rawat"] if own else []), params


@pytest.mark.parametrize(("params", "_own"), WIDEN)
def test_a_head_warden_sees_every_hostels_students_and_no_staff(client, everyone, params, _own):
    rows = listed(client.get(STUDENTS, params=params, headers=everyone["head"]))
    assert set(rows) <= {"Anna Rawat", "Bina Negi"}, params


@pytest.mark.parametrize("path", ["/admin/outings", "/admin/late-today", "/admin/scans"])
@pytest.mark.parametrize(
    ("params", "own"),
    [({}, True), ({"q": "bina"}, False), ({"q": "negi"}, False), ({"role": "admin"}, True)],
)
def test_a_wardens_register_and_scans_stay_in_their_hostels(
    client, db, everyone, path, params, own
):
    # Both students just went past their return time, so they are on every list.
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '2 hours', "
            "expected_return_at = now() - interval '1 second'"
        )
    )
    db.commit()
    rows = listed(client.get(path, params=params, headers=everyone["warden"]))
    assert rows == (["Anna Rawat"] if own else []), (path, params)


@pytest.mark.parametrize("path", ["/admin/outings", "/admin/scans"])
def test_the_control_admin_does_see_both_hostels(client, everyone, path):
    """The scope tests above aren't vacuous: the other hostel's rows exist."""
    assert listed(client.get(path, headers=everyone["admin"])) == ["Anna Rawat", "Bina Negi"]
    assert listed(client.get(path, headers=everyone["head"])) == ["Anna Rawat", "Bina Negi"]


@pytest.mark.parametrize("path", [STUDENTS, "/admin/outings", "/admin/late-today", "/admin/scans"])
def test_another_hostel_is_not_found_for_a_warden(client, everyone, hostels, path):
    r = client.get(path, params={"hostel_id": hostels["B"]}, headers=everyone["warden"])
    assert r.status_code == 404, r.text


# ---------- the scans log's hostel filter ----------


def test_scans_filter_by_hostel(client, everyone, hostels):
    admin = everyone["admin"]
    for hostel, name in (("A", "Anna Rawat"), ("B", "Bina Negi")):
        r = client.get("/admin/scans", params={"hostel_id": hostels[hostel]}, headers=admin)
        assert listed(r) == [name]
    own = client.get("/admin/scans", params={"hostel_id": hostels["A"]}, headers=everyone["warden"])
    assert listed(own) == ["Anna Rawat"]


# ---------- rate limit ----------

SEARCH_PATHS = [
    (USERS, {"q": "anna"}),
    (STUDENTS, {}),
    ("/admin/outings", {}),
    ("/admin/late-today", {}),
    ("/admin/scans", {}),
    ("/admin/audit", {}),
]


def test_searches_are_limited_to_120_a_minute():
    from app.api import admin

    assert admin.SEARCHES == Limit(max_hits=120, window_seconds=60)


@pytest.mark.parametrize(("path", "params"), SEARCH_PATHS)
def test_every_admin_search_is_rate_limited_per_person(
    client, db, everyone, monkeypatch, path, params
):
    # The fixtures searched already (finding people to give roles): start the count at 0.
    db.execute(text("DELETE FROM rate_limit_hits WHERE true"))
    db.commit()
    monkeypatch.setattr("app.api.admin.SEARCHES", Limit(max_hits=3, window_seconds=60))
    admin, dev = everyone["admin"], everyone["dev"]
    for _ in range(3):
        assert client.get(path, params=params, headers=admin).status_code == 200
    r = client.get(path, params=params, headers=admin)
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1
    # Per person: someone else searching isn't held back.
    assert client.get(path, params=params, headers=dev).status_code == 200
