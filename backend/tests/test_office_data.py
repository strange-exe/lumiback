"""The office's data, wave 1: scans search, register filters, the audit log viewer and a
student's record. Each read is scoped like the rest of the office's data: a warden of Hostel A
never sees Hostel B's students, even by naming them."""

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import text

from tests.helpers import make_admin, signup
from tests.test_view_as import as_, make_developer
from tests.test_wardens import set_role, student, user_id

AT_GATE = {"lat": 30.2683, "lng": 77.9950, "accuracy_m": 8}


def ist_today():
    return (datetime.now(UTC) + timedelta(hours=5, minutes=30)).date()


@pytest.fixture
def admin(client, db):
    headers = signup(client, "office@geu.ac.in", "Office Admin")[1]
    make_admin(db, "office@geu.ac.in")
    return headers


@pytest.fixture
def hostels(client, admin) -> dict[str, str]:
    default = next(
        r for r in client.get("/admin/rule-sets", headers=admin).json() if r["is_default"]
    )
    ids = {}
    for name in ("A", "B"):
        r = client.post(
            "/admin/hostels",
            json={"name": f"Hostel {name}", "rule_set_id": default["id"]},
            headers=admin,
        )
        assert r.status_code == 201, r.text
        ids[name] = next(h["id"] for h in r.json() if h["name"] == f"Hostel {name}")
    return ids


@pytest.fixture
def anna(client, db, hostels):
    headers = student(client, "anna@geu.ac.in", "Anna Rawat", hostels["A"])
    db.execute(text("UPDATE users SET roll_no = '22CS101' WHERE email = 'anna@geu.ac.in'"))
    db.commit()
    return headers


@pytest.fixture
def bina(client, hostels):
    return student(client, "bina@geu.ac.in", "Bina Negi", hostels["B"])


@pytest.fixture
def warden(client, admin, hostels):
    """Warden of Hostel A only."""
    headers = signup(client, "warden.a@geu.ac.in", "Warden A")[1]
    r = set_role(client, admin, "warden.a@geu.ac.in", "warden", [hostels["A"]])
    assert r.status_code == 200, r.text
    return headers


@pytest.fixture
def head(client, admin):
    headers = signup(client, "head@geu.ac.in", "Head Warden")[1]
    assert set_role(client, admin, "head@geu.ac.in", "head_warden").status_code == 200
    return headers


@pytest.fixture
def dev(client, db):
    headers = signup(client, "dev@geu.ac.in", "Dev Eloper")[1]
    make_developer(db, "dev@geu.ac.in")
    return headers


def go_out(client, headers, destination="Rajpur Road"):
    r = client.post("/outings", json={"destination": destination}, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()


def refused_scan(client, headers):
    r = client.post("/gates/scan", json={"qr": "garbage", **AT_GATE}, headers=headers)
    assert r.status_code == 422, r.text


def names(rows) -> list[str]:
    return sorted(r["name"] for r in rows)


# ---------- #11 scans search ----------


def test_scans_are_searched_by_name_or_roll_number(client, admin, anna, bina):
    refused_scan(client, anna)
    refused_scan(client, bina)
    by_name = client.get("/admin/scans", params={"q": "anna"}, headers=admin).json()
    assert names(by_name["items"]) == ["Anna Rawat"]
    by_roll = client.get("/admin/scans", params={"q": "22cs1"}, headers=admin).json()
    assert names(by_roll["items"]) == ["Anna Rawat"]
    # Each row links to the student's record.
    assert by_roll["items"][0]["student_id"] == user_id(client, admin, "anna@geu.ac.in")
    # LIKE wildcards are only themselves.
    assert client.get("/admin/scans", params={"q": "%%"}, headers=admin).json()["items"] == []


def test_scans_by_date_range(client, admin, anna):
    refused_scan(client, anna)
    today, yesterday = ist_today(), ist_today() - timedelta(days=1)
    on = client.get("/admin/scans", params={"from": today, "to": today}, headers=admin).json()
    assert len(on["items"]) == 1
    off = client.get(
        "/admin/scans", params={"from": yesterday, "to": yesterday}, headers=admin
    ).json()
    assert off["items"] == []
    since = client.get("/admin/scans", params={"from": yesterday}, headers=admin).json()
    assert len(since["items"]) == 1


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-11-08", "to": "2026-11-01"},  # backwards
        {"from": "0001-01-01"},
        {"to": "9999-12-31"},
        {"from": "yesterday"},
        {"q": "a"},  # too short to search
        {"q": "x" * 101},
    ],
)
def test_scans_filters_are_checked(client, admin, params):
    assert client.get("/admin/scans", params=params, headers=admin).status_code == 422


def test_a_warden_cant_find_another_hostels_scans(client, warden, anna, bina):
    refused_scan(client, anna)
    refused_scan(client, bina)
    assert client.get("/admin/scans", params={"q": "bina"}, headers=warden).json()["items"] == []
    assert names(client.get("/admin/scans", headers=warden).json()["items"]) == ["Anna Rawat"]


# ---------- #11 register filters ----------


def test_the_register_filters_by_hostel_and_search(client, admin, hostels, anna, bina):
    go_out(client, anna)
    go_out(client, bina)
    everyone = client.get("/admin/outings", headers=admin).json()
    assert names(everyone) == ["Anna Rawat", "Bina Negi"]
    in_b = client.get("/admin/outings", params={"hostel_id": hostels["B"]}, headers=admin).json()
    assert names(in_b) == ["Bina Negi"]
    by_roll = client.get("/admin/outings", params={"q": "22CS101"}, headers=admin).json()
    assert names(by_roll) == ["Anna Rawat"]
    both = client.get(
        "/admin/outings", params={"hostel_id": hostels["A"], "q": "bina"}, headers=admin
    ).json()
    assert both == []
    late = client.get("/admin/late-today", params={"hostel_id": hostels["A"]}, headers=admin)
    assert late.status_code == 200


def test_a_warden_cant_filter_by_another_hostel(client, warden, hostels, anna, bina):
    go_out(client, anna)
    go_out(client, bina)
    for path in ("/admin/outings", "/admin/late-today"):
        r = client.get(path, params={"hostel_id": hostels["B"]}, headers=warden)
        assert r.status_code == 404, path
    own = client.get("/admin/outings", params={"hostel_id": hostels["A"]}, headers=warden)
    assert names(own.json()) == ["Anna Rawat"]
    # A search never reaches past the warden's hostels either.
    assert client.get("/admin/outings", params={"q": "bina"}, headers=warden).json() == []


def test_unknown_hostel_filter_is_a_404(client, admin):
    r = client.get(
        "/admin/outings",
        params={"hostel_id": "00000000-0000-0000-0000-000000000000"},
        headers=admin,
    )
    # An admin covers every hostel, so an unknown id simply matches nothing.
    assert (r.status_code, r.json()) == (200, [])


# ---------- #4 audit log ----------


def test_admins_read_the_audit_log_newest_first(client, admin, hostels, anna):
    client.post(
        "/admin/gates", json={"name": "North Gate", "lat": 30.2, "lng": 77.9}, headers=admin
    )
    client.put("/admin/settings", json={"scan_retention_days": 90}, headers=admin)
    page = client.get("/admin/audit", headers=admin).json()
    actions = [e["action"] for e in page["items"]]
    assert actions[:2] == ["settings", "gate:create"]
    assert "hostel:create" in actions
    newest = page["items"][0]
    assert (newest["actor_name"], newest["actor_email"], newest["actor_role"]) == (
        "Office Admin",
        "office@geu.ac.in",
        "admin",
    )
    assert newest["target"] == "keep scans 90 d"
    assert newest["at"].endswith("+05:30")
    assert page["next_before"] is None


def test_the_audit_log_filters_and_pages(client, db, admin, hostels):
    for n in range(3):
        client.post(
            "/admin/gates", json={"name": f"Gate {n}", "lat": 30.2, "lng": 77.9}, headers=admin
        )
    gates = client.get("/admin/audit", params={"area": "gate"}, headers=admin).json()
    assert [e["target"] for e in gates["items"]] == ["Gate 2", "Gate 1", "Gate 0"]
    first = client.get("/admin/audit", params={"area": "gate", "limit": 2}, headers=admin).json()
    assert len(first["items"]) == 2
    rest = client.get(
        "/admin/audit",
        params={"area": "gate", "limit": 2, "before": first["next_before"]},
        headers=admin,
    ).json()
    assert [e["target"] for e in rest["items"]] == ["Gate 0"]
    assert rest["next_before"] is None
    # By what it was about, or who did it.
    assert [
        e["target"]
        for e in client.get("/admin/audit", params={"q": "gate 1"}, headers=admin).json()["items"]
    ] == ["Gate 1"]
    assert (
        len(client.get("/admin/audit", params={"q": "office@"}, headers=admin).json()["items"]) == 5
    )
    # By day (IST): today has them all, yesterday none.
    today, yesterday = ist_today(), ist_today() - timedelta(days=1)
    on = client.get("/admin/audit", params={"from": today, "to": today}, headers=admin).json()
    assert len(on["items"]) == 5
    off = client.get("/admin/audit", params={"to": yesterday}, headers=admin).json()
    assert off["items"] == []
    # A deleted actor's changes stay, without a name.
    db.execute(text("UPDATE admin_audit SET actor_id = NULL WHERE target = 'Gate 0'"))
    db.commit()
    [gone] = client.get("/admin/audit", params={"q": "gate 0"}, headers=admin).json()["items"]
    assert (gone["actor_name"], gone["actor_email"]) == (None, None)


@pytest.mark.parametrize(
    "params", [{"area": "everything"}, {"area": "gate:create"}, {"limit": 0}, {"q": "a"}]
)
def test_the_audit_log_filters_are_checked(client, admin, params):
    assert client.get("/admin/audit", params=params, headers=admin).status_code == 422


def test_only_admins_and_developers_read_the_audit_log(client, admin, warden, head, anna, dev):
    assert client.get("/admin/audit", headers=anna).status_code == 403
    assert client.get("/admin/audit", headers=warden).status_code == 403
    assert client.get("/admin/audit", headers=head).status_code == 403
    assert client.get("/admin/audit").status_code == 401
    assert client.get("/admin/audit", headers=dev).status_code == 200
    # A read, so a developer viewing the admin screens may read it too.
    assert client.get("/admin/audit", headers=as_(dev, "admin")).status_code == 200


# ---------- #1 a student's record ----------

RECORD_PATHS = ["", "/outings", "/requests", "/scans"]


def record(client, headers, student_id: str, part: str = ""):
    return client.get(f"/admin/students/{student_id}{part}", headers=headers)


def add_request(db, email: str, day, status: str = "approved") -> None:
    db.execute(
        text(
            "INSERT INTO outing_requests (student_id, day, purpose, phone, emergency_name, "
            "emergency_relation, emergency_phone, status) "
            "SELECT id, :day, 'Shopping', '+919876543210', 'Sunita', 'Mother', '+919123456789', "
            ":status FROM users WHERE email = :e"
        ),
        {"day": day, "status": status, "e": email},
    )
    db.commit()


def test_a_students_record_has_everything_newest_first(client, db, admin, anna):
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    first = go_out(client, anna, "Paltan Bazaar")
    db.execute(
        text(
            "UPDATE outings SET left_at = now() - interval '1 day 3 hours', "
            "expected_return_at = now() - interval '1 day 1 hour'"
        )
    )
    db.commit()
    # The office records the return, and the trip was escalated (and resolved) on the way.
    r = client.post(
        f"/admin/outings/{first['id']}/correction",
        json={
            "kind": "return",
            "returned_at": (datetime.now(UTC) - timedelta(hours=23)).isoformat(),
            "reason": "Hostel register",
        },
        headers=admin,
    )
    assert r.status_code == 200, r.text
    db.execute(
        text(
            "INSERT INTO escalations (outing_id, resolved_at, resolved_by, note) "
            "SELECT :o, now(), id, 'Called, on the way' FROM users WHERE email = 'office@geu.ac.in'"
        ),
        {"o": first["id"]},
    )
    db.commit()
    go_out(client, anna, "Clock Tower")  # out now
    add_request(db, "anna@geu.ac.in", ist_today() - timedelta(days=3), "declined")
    add_request(db, "anna@geu.ac.in", ist_today())
    refused_scan(client, anna)

    top = record(client, admin, anna_id).json()
    assert top["student"]["name"] == "Anna Rawat"
    assert top["student"]["hostel"] == "Hostel A"
    assert top["student"]["status"] == "out"
    assert (top["outings"], top["late"], top["open_escalations"], top["requests"]) == (2, 1, 0, 2)

    outings = record(client, admin, anna_id, "/outings").json()
    assert [o["destination"] for o in outings["items"]] == ["Clock Tower", "Paltan Bazaar"]
    older = outings["items"][1]
    assert older["in_via"] == "staff" and older["status"] == "returned"
    assert [c["kind"] for c in older["corrections"]] == ["return"]
    assert older["corrections"][0]["by_staff"] is True
    assert older["escalation"]["resolved_by"] == "Office Admin"
    assert older["escalation"]["note"] == "Called, on the way"
    assert outings["items"][0]["escalation"] is None

    requests = record(client, admin, anna_id, "/requests").json()
    assert [r["status"] for r in requests["items"]] == ["approved", "declined"]
    assert requests["items"][0]["name"] == "Anna Rawat"

    scans = record(client, admin, anna_id, "/scans").json()
    assert [s["result"] for s in scans["items"]] == ["bad_code"]


def test_a_record_pages_back(client, db, admin, anna):
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    for n in range(3):
        o = go_out(client, anna, f"Trip {n}")
        db.execute(
            text(
                "UPDATE outings SET left_at = now() - make_interval(hours => :h), "
                "expected_return_at = now() - make_interval(hours => :h) + interval '1 hour', "
                "returned_at = now() - make_interval(hours => :h) + interval '30 minutes' "
                "WHERE id = :o"
            ),
            {"h": 10 - n, "o": o["id"]},
        )
        db.commit()
    first = record(client, admin, anna_id, "/outings?limit=2").json()
    assert [o["destination"] for o in first["items"]] == ["Trip 2", "Trip 1"]
    rest = client.get(
        f"/admin/students/{anna_id}/outings",
        params={"limit": 2, "before": first["next_before"]},
        headers=admin,
    ).json()
    assert [o["destination"] for o in rest["items"]] == ["Trip 0"]
    assert rest["next_before"] is None


def test_paging_never_skips_outings_that_left_at_the_same_time(client, db, admin, anna):
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    for n in range(4):
        o = go_out(client, anna, f"Trip {n}")
        # Trips 1 and 2 share one left_at, and limit=2 puts the page edge between them.
        hours = {0: 12, 1: 10, 2: 10, 3: 8}[n]
        db.execute(
            text(
                "UPDATE outings SET "
                "left_at = date_trunc('minute', now()) - make_interval(hours => :h), "
                "expected_return_at = now() - make_interval(hours => :h) + interval '1 hour', "
                "returned_at = now() - make_interval(hours => :h) + interval '30 minutes' "
                "WHERE id = :o"
            ),
            {"h": hours, "o": o["id"]},
        )
        db.commit()
    seen, before = [], None
    for _ in range(4):
        params = {"limit": 2, **({"before": before} if before else {})}
        page = client.get(f"/admin/students/{anna_id}/outings", params=params, headers=admin).json()
        seen += [o["destination"] for o in page["items"]]
        before = page["next_before"]
        if before is None:
            break
    assert sorted(seen) == ["Trip 0", "Trip 1", "Trip 2", "Trip 3"]
    assert len(seen) == 4, "nothing shown twice"


@pytest.mark.parametrize("path", ["/admin/scans", "/admin/audit", "/admin/students/{id}/scans"])
def test_an_oversized_row_cursor_is_refused_not_a_server_error(client, admin, anna, path):
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    response = client.get(
        path.format(id=anna_id), params={"before": "99999999999999999999"}, headers=admin
    )
    assert response.status_code == 422


@pytest.mark.parametrize("part", RECORD_PATHS)
def test_a_warden_reads_only_their_hostels_students(client, admin, warden, anna, bina, part):
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    bina_id = user_id(client, admin, "bina@geu.ac.in")
    assert record(client, warden, anna_id, part).status_code == 200
    r = record(client, warden, bina_id, part)
    assert (r.status_code, r.json()["detail"]) == (404, "No such student")


@pytest.mark.parametrize("part", RECORD_PATHS)
def test_records_are_for_the_office_and_students_only(client, admin, head, anna, part):
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    assert record(client, anna, anna_id, part).status_code == 403  # not even their own
    assert client.get(f"/admin/students/{anna_id}{part}").status_code == 401
    assert record(client, head, anna_id, part).status_code == 200
    # Staff have no record here, and an unknown id is the same 404.
    head_id = user_id(client, admin, "head@geu.ac.in")
    assert record(client, admin, head_id, part).status_code == 404
    unknown = "00000000-0000-0000-0000-000000000000"
    assert record(client, admin, unknown, part).status_code == 404


def test_a_warden_sees_only_trips_made_from_their_hostels(client, db, admin, warden, hostels, anna):
    """Records stay with the hostel a trip happened in, as on the register."""
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    o = go_out(client, anna, "Before moving")
    db.execute(
        text(
            "UPDATE outings SET hostel_id = :b, returned_at = now(), "
            "left_at = now() - interval '2 hours', expected_return_at = now() + interval '1 hour' "
            "WHERE id = :o"
        ),
        {"b": hostels["B"], "o": o["id"]},
    )
    db.commit()
    go_out(client, anna, "After moving")
    mine = record(client, warden, anna_id, "/outings").json()["items"]
    assert [x["destination"] for x in mine] == ["After moving"]
    assert record(client, warden, anna_id).json()["outings"] == 1
    every = record(client, admin, anna_id, "/outings").json()["items"]
    assert [x["destination"] for x in every] == ["After moving", "Before moving"]


def test_a_developer_viewing_as_a_warden_reads_records(client, admin, dev, anna):
    anna_id = user_id(client, admin, "anna@geu.ac.in")
    for part in RECORD_PATHS:
        assert record(client, as_(dev, "warden"), anna_id, part).status_code == 200, part
