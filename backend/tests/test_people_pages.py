"""People lists at scale (2026-11-10). The admins' people search (GET /admin/users) answers a
page of people in a fixed number of queries, however many people and wardens are on it; and
the office list (GET /admin/students) pages by name with an `after` cursor, `limit` at a time,
while a caller that doesn't page still gets the first 300 as before.
"""

import uuid

import pytest
from sqlalchemy import event, text

from tests import test_office_data as data
from tests.test_wardens import set_role

# The office data fixtures: an admin, Hostels A and B, Anna (A) and Bina (B), a warden of A.
admin, hostels, anna, bina, warden = data.admin, data.hostels, data.anna, data.bina, data.warden

USERS = "/admin/users"
STUDENTS = "/admin/students"


def add_people(db, prefix: str, first: int, last: int, *, role="student", hostel=None) -> None:
    """People named "<prefix> 001".. (numbers first..last), verified, in `hostel`."""
    db.execute(
        text(
            "INSERT INTO users (name, email, password_hash, role, hostel_id, email_verified_at) "
            "SELECT :p || ' ' || lpad(i::text, 3, '0'), lower(:p) || i || '@geu.ac.in', 'x', "
            ":r, CAST(:h AS uuid), now() FROM generate_series(CAST(:a AS int), CAST(:b AS int)) i"
        ),
        {"p": prefix, "r": role, "h": hostel, "a": first, "b": last},
    )
    db.commit()


def give_hostels(db, prefix: str, hostel_ids: list[str]) -> None:
    """Every warden named "<prefix> ..." without hostels yet looks after these."""
    db.execute(
        text(
            "INSERT INTO warden_hostels (user_id, hostel_id) "
            "SELECT u.id, CAST(h AS uuid) FROM users u, unnest(CAST(:hs AS text[])) h "
            "WHERE u.name LIKE :p AND u.role = 'warden' "
            "AND NOT EXISTS (SELECT 1 FROM warden_hostels w WHERE w.user_id = u.id)"
        ),
        {"hs": hostel_ids, "p": f"{prefix} %"},
    )
    db.commit()


@pytest.fixture
def more_hostels(client, admin, hostels) -> dict[str, str]:
    """Hostels A and B, plus C and D."""
    default = next(r for r in client.get("/admin/rule-sets", headers=admin).json())
    ids = dict(hostels)
    for name in ("C", "D"):
        r = client.post(
            "/admin/hostels",
            json={"name": f"Hostel {name}", "rule_set_id": default["id"]},
            headers=admin,
        )
        assert r.status_code == 201, r.text
        ids[name] = next(h["id"] for h in r.json() if h["name"] == f"Hostel {name}")
    return ids


@pytest.fixture
def statements(client):
    """GET a path; its JSON and how many SQL statements answering it took."""
    engine = client.app.state.sessionmaker.kw["bind"].sync_engine

    def run(path: str, params: dict, headers: dict) -> tuple[list[dict], int]:
        seen: list[str] = []

        def count(_conn, _cursor, statement, *_) -> None:
            seen.append(statement)

        event.listen(engine, "before_cursor_execute", count)
        try:
            r = client.get(path, params=params, headers=headers)
        finally:
            event.remove(engine, "before_cursor_execute", count)
        assert r.status_code == 200, r.text
        return r.json(), len(seen)

    return run


# ---------- the people search: no query per person ----------


@pytest.mark.parametrize(
    "params",
    [
        {"role": "student"},
        {"role": "warden"},
        {"role": ["student", "warden"]},
        {"q": "zed"},
        {"q": "zed", "role": "warden"},
    ],
)
def test_the_people_search_takes_the_same_queries_for_many_people(
    db, admin, more_hostels, statements, params
):
    h = more_hostels
    # Nobody listed: the request's own queries (sign-in, rate limit) and the search itself.
    _, alone = statements(USERS, {"role": "head_warden"}, admin)
    add_people(db, "Zed", 1, 2, hostel=h["A"])
    add_people(db, "Zed", 101, 102, role="warden")
    give_hostels(db, "Zed", [h["D"], h["B"]])
    few_rows, few = statements(USERS, params, admin)
    add_people(db, "Zed", 3, 40, hostel=h["C"])
    add_people(db, "Zed", 103, 140, role="warden")
    give_hostels(db, "Zed", [h["C"], h["A"], h["D"]])
    many_rows, many = statements(USERS, params, admin)

    assert len(many_rows) > len(few_rows) >= 2
    # Many more people (and wardens' hostels), no more queries. (Fewer is fine: a page with no
    # one in a hostel, or no warden, skips that query; the search's best 20 are all wardens.)
    assert many <= few
    assert many <= alone + 2  # at most: their homes' names and the wardens' hostels


def test_the_people_search_shows_homes_and_each_wardens_hostels_by_name(
    client, db, admin, more_hostels, warden, anna, bina
):
    h = more_hostels
    # Given out of order: listed by hostel name.
    r = set_role(client, admin, "warden.a@geu.ac.in", "warden", [h["D"], h["A"], h["C"]])
    assert r.is_success, r.text
    add_people(db, "Zed", 101, 101, role="warden")  # a warden with no hostels yet
    add_people(db, "Zed", 1, 1)  # a student who hasn't chosen a hostel
    db.execute(text("UPDATE users SET email_verified_at = NULL WHERE email = 'zed1@geu.ac.in'"))
    db.commit()
    rows = client.get(USERS, params={"role": ["student", "warden"]}, headers=admin).json()
    shown = {
        p["name"]: (p["role"], p["hostels"], p["hostel_ids"], p["home_hostel"], p["account"])
        for p in rows
    }
    assert [p["name"] for p in rows] == [
        "Anna Rawat",
        "Bina Negi",
        "Warden A",
        "Zed 001",
        "Zed 101",
    ]
    assert shown == {
        "Anna Rawat": ("student", [], [], "Hostel A", "active"),
        "Bina Negi": ("student", [], [], "Hostel B", "active"),
        "Warden A": (
            "warden",
            ["Hostel A", "Hostel C", "Hostel D"],
            [h["A"], h["C"], h["D"]],
            None,
            "active",
        ),
        "Zed 001": ("student", [], [], None, "invited"),
        "Zed 101": ("warden", [], [], None, "active"),
    }
    home_ids = {p["name"]: p["home_hostel_id"] for p in rows}
    assert home_ids["Anna Rawat"] == h["A"] and home_ids["Zed 001"] is None
    # One person's answer (here: after correcting their name) is the same shape.
    one = client.patch(
        f"/admin/users/{next(p['id'] for p in rows if p['name'] == 'Warden A')}",
        json={"name": "Warden Aa"},
        headers=admin,
    )
    assert one.status_code == 200, one.text
    assert (one.json()["hostels"], one.json()["hostel_ids"]) == (
        ["Hostel A", "Hostel C", "Hostel D"],
        [h["A"], h["C"], h["D"]],
    )


# ---------- the office list: pages by name ----------


def page_through(client, headers, params: dict, limit: int) -> list[list[dict]]:
    pages, after = [], None
    while True:
        query = {**params, "limit": limit, **({"after": after} if after else {})}
        r = client.get(STUDENTS, params=query, headers=headers)
        assert r.status_code == 200, r.text
        page = r.json()
        if not page:
            return pages
        assert len(page) <= limit
        pages.append(page)
        after = page[-1]["id"]


@pytest.fixture
def pagers(db, hostels):
    """Five students in Hostel A (two of them invited) and three in B, two sharing a name."""
    add_people(db, "Pager", 1, 5, hostel=hostels["A"])
    add_people(db, "Pager", 6, 8, hostel=hostels["B"])
    db.execute(text("UPDATE users SET name = 'Pager 003' WHERE email = 'pager7@geu.ac.in'"))
    db.execute(
        text(
            "UPDATE users SET email_verified_at = NULL "
            "WHERE email IN ('pager2@geu.ac.in', 'pager4@geu.ac.in')"
        )
    )
    db.commit()


@pytest.mark.parametrize(
    "params",
    [
        {"q": "pager"},
        {"hostel_id": "A"},
        {"account": "invited"},
        {"role": "student"},
        {},
    ],
)
def test_the_office_list_pages_by_name_with_the_same_filters(
    client, admin, hostels, pagers, params
):
    if "hostel_id" in params:
        params = {"hostel_id": hostels[params["hostel_id"]]}
    every = client.get(STUDENTS, params=params, headers=admin).json()
    assert len(every) >= 2
    # By name; two people with the same name in a fixed order (their ids).
    assert [(p["name"], p["id"]) for p in every] == sorted((p["name"], p["id"]) for p in every)
    pages = page_through(client, admin, params, limit=2)
    assert len(pages) == (len(every) + 1) // 2
    assert [p["id"] for page in pages for p in page] == [p["id"] for p in every]


def test_two_people_with_one_name_are_both_listed_across_a_page_break(
    client, admin, hostels, pagers
):
    pages = page_through(client, admin, {"q": "pager 003"}, limit=1)
    assert [[p["name"] for p in page] for page in pages] == [["Pager 003"], ["Pager 003"]]
    assert pages[0][0]["id"] != pages[1][0]["id"]


def test_an_unknown_cursor_is_an_empty_page(client, admin, pagers):
    nobody = str(uuid.uuid4())
    assert client.get(STUDENTS, params={"after": nobody}, headers=admin).json() == []
    r = client.get(STUDENTS, params={"after": nobody, "limit": 2}, headers=admin)
    assert r.status_code == 200 and r.json() == []


def test_a_wardens_cursor_must_be_their_own_student(client, admin, warden, anna, bina, pagers):
    """Someone outside their hostels is no place to start from: an empty page, not a hint of
    where their name falls among the warden's students."""
    ids = {p["name"]: p["id"] for p in client.get(STUDENTS, headers=admin).json()}
    mine = client.get(STUDENTS, headers=warden).json()
    assert [p["name"] for p in mine] == ["Anna Rawat", *(f"Pager 00{i}" for i in range(1, 6))]
    # Control: from their own student, the rest of their list.
    after_anna = client.get(STUDENTS, params={"after": ids["Anna Rawat"]}, headers=warden)
    assert [p["name"] for p in after_anna.json()] == [p["name"] for p in mine[1:]]
    # Bina (Hostel B) sorts before the Pagers, but she isn't theirs: nothing.
    after_bina = client.get(STUDENTS, params={"after": ids["Bina Negi"]}, headers=warden)
    assert after_bina.status_code == 200 and after_bina.json() == []


def test_a_wardens_cursor_is_never_a_staff_member(client, db, admin, warden, hostels, pagers):
    """Staff living in the warden's hostel aren't on the warden's list, so they are no place to
    start from either: an empty page, not whether that id exists or where the name falls."""
    add_people(db, "Mentor", 1, 1, role="warden", hostel=hostels["A"])
    mentor = str(
        db.execute(text("SELECT id FROM users WHERE email = 'mentor1@geu.ac.in'")).scalar_one()
    )
    # Control: an admin's list has staff, so an admin pages on from them.
    from_admin = client.get(STUDENTS, params={"after": mentor, "q": "pager"}, headers=admin)
    assert from_admin.status_code == 200 and len(from_admin.json()) == 8
    r = client.get(STUDENTS, params={"after": mentor}, headers=warden)
    assert r.status_code == 200 and r.json() == []


@pytest.mark.parametrize("params", [{"limit": 0}, {"limit": 301}, {"after": "not-an-id"}])
def test_the_office_list_checks_its_page_parameters(client, admin, params):
    assert client.get(STUDENTS, params=params, headers=admin).status_code == 422


def test_a_caller_that_doesnt_page_still_gets_the_first_300(client, db, admin, hostels):
    """Apps released before paging ask without `limit`: they keep getting 300, never 50."""
    add_people(db, "Many", 1, 301, hostel=hostels["A"])
    every = client.get(STUDENTS, headers=admin).json()
    assert len(every) == 300
    assert every[-1]["name"] == "Many 300"
    first = client.get(STUDENTS, params={"limit": 50}, headers=admin).json()
    assert [p["id"] for p in first] == [p["id"] for p in every[:50]]
    rest = client.get(STUDENTS, params={"after": every[-1]["id"]}, headers=admin).json()
    assert [p["name"] for p in rest] == ["Many 301"]
