"""Reports (#16, wave 4): per-hostel numbers for a range of IST days, a weekly trend and a CSV.

Admins, head wardens and developers see every hostel; a warden only theirs. No student names
anywhere in a report. Aggregated in the database: the number of queries doesn't grow with the
number of outings."""

import csv
import io
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy import event, text

from tests.helpers import signup
from tests.test_office_data import admin, dev, head, hostels, warden  # noqa: F401 - fixtures
from tests.test_view_as import as_
from tests.test_wardens import student

IST = timedelta(hours=5, minutes=30)


def ist_today() -> date:
    return (datetime.now(UTC) + IST).date()


def ist_noon(day: date) -> datetime:
    """Midday IST on `day`, as a UTC instant: safely inside that IST date."""
    return datetime(day.year, day.month, day.day, 12, tzinfo=UTC) - IST


@pytest.fixture
def anna(client, hostels):  # noqa: F811
    return student(client, "anna@geu.ac.in", "Anna Rawat", hostels["A"])


@pytest.fixture
def bina(client, hostels):  # noqa: F811
    return student(client, "bina@geu.ac.in", "Bina Negi", hostels["B"])


def trip(
    db,
    email: str,
    hostel: str | None,
    *,
    day: date | None = None,
    late: int | None = 0,
    out_via: str = "self",
    in_via: str = "self",
    running_late: int | None = None,
) -> str:
    """An outing left at midday IST on `day` (default yesterday), due back 2 h later, back
    `late` minutes after that (negative: early; None: still out)."""
    left = ist_noon(day or ist_today() - timedelta(days=1))
    due = left + timedelta(hours=2)
    returned = None if late is None else due + timedelta(minutes=late)
    outing = db.execute(
        text(
            "INSERT INTO outings (student_id, hostel_id, left_at, expected_return_at, "
            "returned_at, out_via, in_via, original_return_at, running_late_minutes, "
            "running_late_at) "
            "SELECT id, :h, :left, :due, :back, :out_via, :in_via, "
            "CAST(:original AS timestamptz), :rl, CAST(:rl_at AS timestamptz) "
            "FROM users WHERE email = :e RETURNING id"
        ),
        {
            "e": email,
            "h": hostel,
            "left": left,
            "due": due,
            "back": returned,
            "out_via": out_via,
            "in_via": None if late is None else in_via,
            "original": due - timedelta(minutes=running_late) if running_late else None,
            "rl": running_late,
            "rl_at": left + timedelta(hours=1) if running_late else None,
        },
    ).scalar_one()
    db.commit()
    return str(outing)


def escalate(db, outing_id: str, day: date | None = None) -> None:
    at = ist_noon(day or ist_today() - timedelta(days=1)) + timedelta(hours=3)
    db.execute(
        text("INSERT INTO escalations (outing_id, created_at) VALUES (:o, :at)"),
        {"o": outing_id, "at": at},
    )
    db.commit()


def request(db, email: str, status: str, day: date) -> None:
    db.execute(
        text(
            "INSERT INTO outing_requests (student_id, day, purpose, phone, emergency_name, "
            "emergency_relation, emergency_phone, status) "
            "SELECT id, :d, 'Market', '9876543210', 'Parent', 'Mother', '9876543211', :s "
            "FROM users WHERE email = :e"
        ),
        {"e": email, "d": day, "s": status},
    )
    db.commit()


def cancel(db, outing_id: str) -> None:
    """The office cancelled a mistaken tap: closed at the time it left, with an approved
    cancel correction (services/corrections.py)."""
    db.execute(
        text("UPDATE outings SET returned_at = left_at, in_via = 'staff' WHERE id = :o"),
        {"o": outing_id},
    )
    db.execute(
        text(
            "INSERT INTO outing_corrections (outing_id, kind, status, reason, by_staff) "
            "VALUES (:o, 'cancel', 'approved', 'Tapped by mistake', true)"
        ),
        {"o": outing_id},
    )
    db.commit()


def report(client, headers, **params):
    return client.get("/admin/reports", params=params, headers=headers)


def by_hostel(body) -> dict[str, dict]:
    return {row["hostel"]: row for row in body["hostels"]}


@pytest.fixture
def busy(db, hostels, anna, bina):  # noqa: F811
    """A month in Hostel A and Hostel B (see each line), plus things a report leaves out."""
    yesterday = ist_today() - timedelta(days=1)
    trip(db, "anna@geu.ac.in", hostels["A"], late=-5, out_via="gate")  # on time, via a gate
    trip(db, "anna@geu.ac.in", hostels["A"], late=20)
    late40 = trip(db, "anna@geu.ac.in", hostels["A"], late=40, running_late=15)
    escalate(db, late40)
    # Closed by a later tap-out: when they came back isn't known, so no late numbers.
    trip(db, "anna@geu.ac.in", hostels["A"], late=600, in_via="unrecorded")
    trip(db, "anna@geu.ac.in", hostels["A"], day=ist_today(), late=None)  # still out
    cancel(db, trip(db, "anna@geu.ac.in", hostels["A"], late=0))  # never happened
    trip(db, "anna@geu.ac.in", hostels["A"], day=ist_today() - timedelta(days=40), late=90)
    request(db, "anna@geu.ac.in", "approved", yesterday)
    request(db, "anna@geu.ac.in", "declined", yesterday - timedelta(days=1))
    request(db, "anna@geu.ac.in", "pending", ist_today())

    trip(db, "bina@geu.ac.in", hostels["B"], late=10, out_via="gate")
    request(db, "bina@geu.ac.in", "approved", yesterday)


def test_a_report_counts_each_hostel_and_the_campus(client, admin, hostels, busy):  # noqa: F811
    r = report(client, admin)
    assert r.status_code == 200, r.text
    body = r.json()
    rows = by_hostel(body)
    assert list(rows) == ["Hostel A", "Hostel B"]
    assert rows["Hostel A"] == {
        "hostel_id": hostels["A"],
        "hostel": "Hostel A",
        "outings": 5,  # the cancelled one and the one 40 days ago are left out
        "gate_out": 1,
        "self_out": 4,
        "back": 3,  # recorded returns only: not the unrecorded one or the one still out
        "returned_late": 2,
        "late_rate": pytest.approx(2 / 3),
        "median_minutes_late": 30,
        "escalations": 1,
        "requests_approved": 1,
        "requests_declined": 1,
        "running_late": 1,
    }
    assert rows["Hostel B"]["outings"] == 1
    assert rows["Hostel B"]["gate_out"] == 1
    assert rows["Hostel B"]["returned_late"] == 1
    assert rows["Hostel B"]["median_minutes_late"] == 10
    assert rows["Hostel B"]["requests_approved"] == 1
    total = body["total"]
    assert total["outings"] == 6
    assert total["back"] == 4
    assert total["returned_late"] == 3
    assert total["late_rate"] == pytest.approx(3 / 4)
    assert total["median_minutes_late"] == 20
    assert total["requests_approved"] == 2
    assert total["requests_declined"] == 1
    assert total["escalations"] == 1
    assert total["running_late"] == 1


def test_a_report_never_names_a_student(client, admin, busy):  # noqa: F811
    for path in ("/admin/reports", "/admin/reports.csv"):
        r = client.get(path, headers=admin)
        assert r.status_code == 200, r.text
        for word in ("Anna", "Rawat", "Bina", "anna@", "9876543210"):
            assert word not in r.text, (path, word)


def test_every_hostel_is_listed_even_without_outings(client, admin, hostels):  # noqa: F811
    body = report(client, admin).json()
    rows = by_hostel(body)
    assert list(rows) == ["Hostel A", "Hostel B"]
    assert rows["Hostel A"]["outings"] == 0
    assert rows["Hostel A"]["late_rate"] is None
    assert rows["Hostel A"]["median_minutes_late"] is None
    assert body["total"]["outings"] == 0


def test_trips_without_a_hostel_are_their_own_row(client, db, admin, hostels):  # noqa: F811
    signup(client, "nohostel@geu.ac.in", "No Hostel Yet")
    trip(db, "nohostel@geu.ac.in", None, late=25)
    rows = by_hostel(report(client, admin).json())
    assert list(rows) == ["Hostel A", "Hostel B", "No hostel"]
    assert rows["No hostel"]["hostel_id"] is None
    assert rows["No hostel"]["returned_late"] == 1


def test_the_default_range_is_the_last_30_ist_days(client, db, admin, hostels, anna):  # noqa: F811
    today = ist_today()
    trip(db, "anna@geu.ac.in", hostels["A"], day=today - timedelta(days=29))
    trip(db, "anna@geu.ac.in", hostels["A"], day=today - timedelta(days=30))
    body = report(client, admin).json()
    assert body["start"] == str(today - timedelta(days=29))
    assert body["end"] == str(today)
    assert body["total"]["outings"] == 1
    wider = report(client, admin, **{"from": today - timedelta(days=30), "to": today}).json()
    assert wider["total"]["outings"] == 2


def test_the_weekly_trend_covers_the_range_by_ist_week(client, db, admin, hostels, anna):  # noqa: F811
    start, end = date(2026, 10, 1), date(2026, 10, 20)  # a Thursday to a Tuesday
    trip(db, "anna@geu.ac.in", hostels["A"], day=date(2026, 10, 4), late=0)  # Sunday
    trip(db, "anna@geu.ac.in", hostels["A"], day=date(2026, 10, 5), late=15)  # Monday
    trip(db, "anna@geu.ac.in", hostels["A"], day=date(2026, 10, 6), late=None)
    # Just after midnight IST on Monday the 12th is still Sunday the 11th in UTC.
    db.execute(
        text(
            "INSERT INTO outings (student_id, hostel_id, left_at, expected_return_at, "
            "returned_at, in_via) "
            "SELECT id, :h, :left, :left + interval '2 hours', :left + interval '1 hour', 'self' "
            "FROM users WHERE email = :e"
        ),
        {"e": "anna@geu.ac.in", "h": hostels["A"], "left": datetime(2026, 10, 11, 19, tzinfo=UTC)},
    )
    db.commit()
    body = report(client, admin, **{"from": start, "to": end}).json()
    assert body["weeks"] == [
        {"week_start": "2026-09-28", "days": 4, "outings": 1, "returned_late": 0},
        {"week_start": "2026-10-05", "days": 7, "outings": 2, "returned_late": 1},
        {"week_start": "2026-10-12", "days": 7, "outings": 1, "returned_late": 0},
        {"week_start": "2026-10-19", "days": 2, "outings": 0, "returned_late": 0},
    ]


@pytest.mark.parametrize(
    "params",
    [
        {"from": "2026-11-08", "to": "2026-11-01"},  # backwards
        {"from": "2025-01-01", "to": "2026-01-02"},  # 367 days
        {"from": "1999-12-31", "to": "2000-01-01"},
        {"from": "2999-12-31", "to": "3000-01-01"},
        {"from": "yesterday", "to": "2026-11-01"},
        {"from": "2026-11-01"},  # one end alone
    ],
)
def test_the_range_is_checked(client, admin, params):  # noqa: F811
    assert report(client, admin, **params).status_code == 422
    assert client.get("/admin/reports.csv", params=params, headers=admin).status_code == 422


def test_a_full_year_is_allowed(client, admin):  # noqa: F811
    r = report(client, admin, **{"from": "2025-01-01", "to": "2026-01-01"})  # 366 days
    assert r.status_code == 200, r.text
    assert len(r.json()["weeks"]) == 53


def test_a_warden_sees_only_their_hostels(client, admin, warden, busy):  # noqa: F811
    body = report(client, warden).json()
    assert [row["hostel"] for row in body["hostels"]] == ["Hostel A"]
    assert body["total"]["outings"] == 5
    assert body["total"]["requests_approved"] == 1
    assert sum(w["outings"] for w in body["weeks"]) == 5
    lines = client.get("/admin/reports.csv", headers=warden).text
    assert "Hostel B" not in lines


def test_head_wardens_and_developers_see_every_hostel(client, head, dev, busy):  # noqa: F811
    for headers in (head, dev, as_(dev, "warden"), as_(dev, "student")):
        body = report(client, headers).json()
        assert [row["hostel"] for row in body["hostels"]] == ["Hostel A", "Hostel B"]
        assert body["total"]["outings"] == 6
        assert body["every_hostel"] is True


def test_a_wardens_total_says_your_hostels_not_all(client, admin, warden, busy):  # noqa: F811
    assert report(client, warden).json()["every_hostel"] is False
    assert report(client, admin).json()["every_hostel"] is True
    for headers, label in ((warden, "Your hostels"), (admin, "All hostels")):
        text_ = client.get("/admin/reports.csv", headers=headers).text
        rows = list(csv.reader(io.StringIO(text_.lstrip(chr(0xFEFF)))))
        assert rows[-1][0] == label
        assert sum(row[0] in ("All hostels", "Your hostels") for row in rows) == 1


def use_request(db, email: str, outing_id: str) -> None:
    """The outing left on the student's latest request."""
    db.execute(
        text(
            "UPDATE outings SET request_id = (SELECT r.id FROM outing_requests r "
            "JOIN users u ON u.id = r.student_id WHERE u.email = :e "
            "ORDER BY r.created_at DESC LIMIT 1) WHERE id = :o"
        ),
        {"e": email, "o": outing_id},
    )
    db.commit()


def test_a_request_counts_where_the_student_was_when_they_used_it(
    client,
    db,
    admin,  # noqa: F811
    hostels,  # noqa: F811
    anna,
):
    yesterday = ist_today() - timedelta(days=1)
    # Used from Hostel A, then Anna moved to B: still Hostel A's request.
    request(db, "anna@geu.ac.in", "approved", yesterday)
    use_request(db, "anna@geu.ac.in", trip(db, "anna@geu.ac.in", hostels["A"]))
    # Used while she had no hostel: "No hostel", not wherever she is now.
    request(db, "anna@geu.ac.in", "approved", yesterday - timedelta(days=1))
    use_request(
        db,
        "anna@geu.ac.in",
        trip(db, "anna@geu.ac.in", None, day=yesterday - timedelta(days=1)),
    )
    # Never used: counted under her hostel now (there is nothing else to go by).
    request(db, "anna@geu.ac.in", "declined", yesterday - timedelta(days=2))
    db.execute(
        text("UPDATE users SET hostel_id = :h WHERE email = 'anna@geu.ac.in'"), {"h": hostels["B"]}
    )
    db.commit()
    rows = by_hostel(report(client, admin).json())
    assert rows["Hostel A"]["requests_approved"] == 1
    assert rows["No hostel"]["requests_approved"] == 1
    assert (rows["Hostel B"]["requests_approved"], rows["Hostel B"]["requests_declined"]) == (0, 1)


def test_reports_and_exports_are_never_cached(client, admin, busy):  # noqa: F811
    today = ist_today()
    for path, params in (
        ("/admin/reports", {}),
        ("/admin/reports.csv", {}),
        ("/admin/outings.csv", {"from": today - timedelta(days=7), "to": today}),
    ):
        r = client.get(path, params=params, headers=admin)
        assert r.status_code == 200, (path, r.text)
        assert r.headers["cache-control"] == "private, no-store", path


def test_reports_are_for_the_office_only(client, anna):
    assert report(client, anna).status_code == 403
    assert client.get("/admin/reports.csv", headers=anna).status_code == 403
    assert client.get("/admin/reports").status_code == 401


def test_the_csv_has_a_row_per_hostel_and_a_total(client, db, admin, hostels, busy):  # noqa: F811
    today = ist_today()
    r = client.get(
        "/admin/reports.csv",
        params={"from": today - timedelta(days=29), "to": today},
        headers=admin,
    )
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith("text/csv")
    assert (
        f'filename="report-{today - timedelta(days=29)}-to-{today}.csv"'
        in (r.headers["content-disposition"])
    )
    rows = list(csv.reader(io.StringIO(r.text.lstrip(chr(0xFEFF)))))
    assert rows[0] == [
        "Hostel",
        "Outings",
        "Left through a gate",
        "Logged in the app",
        "Back",
        "Back late",
        "Back late (%)",
        "Median minutes late",
        "Escalations",
        "Requests approved",
        "Requests declined",
        "Running late used",
    ]
    assert rows[1] == ["Hostel A", "5", "1", "4", "3", "2", "67", "30", "1", "1", "1", "1"]
    assert rows[2][0] == "Hostel B"
    assert rows[-1][:2] == ["All hostels", "6"]


def test_the_csv_neutralises_formulas_in_hostel_names(client, db, admin, hostels):  # noqa: F811
    db.execute(
        text("UPDATE hostels SET name = '=HYPERLINK(\"x\")' WHERE id = :h"), {"h": hostels["B"]}
    )
    db.commit()
    rows = list(csv.reader(io.StringIO(client.get("/admin/reports.csv", headers=admin).text)))
    assert any(row[0] == '\'=HYPERLINK("x")' for row in rows)


def test_a_report_takes_the_same_queries_for_many_outings(client, db, admin, hostels, anna):  # noqa: F811
    """Aggregated in the database: no query per outing, hostel or week."""
    engine = client.app.state.sessionmaker.kw["bind"].sync_engine
    statements: list[str] = []

    def count(*args) -> None:
        statements.append(args[2])

    def queries() -> int:
        statements.clear()
        event.listen(engine, "before_cursor_execute", count)
        try:
            assert report(client, admin).status_code == 200
        finally:
            event.remove(engine, "before_cursor_execute", count)
        return len(statements)

    trip(db, "anna@geu.ac.in", hostels["A"], late=5)
    few = queries()
    for days in range(1, 25):
        trip(db, "anna@geu.ac.in", hostels["A"], day=ist_today() - timedelta(days=days), late=days)
    assert queries() == few
