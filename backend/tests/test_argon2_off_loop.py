"""Argon2 is slow on purpose (tens of milliseconds of CPU). Run on the event loop, every
password check would stall every other request on that worker, so it runs in a thread."""

import asyncio

import pytest

from app.security import passwords
from tests.helpers import PASSWORD, auth_header, make_admin, signup
from tests.test_password_reset import forgot, reset, reset_code
from tests.test_student_import import link_token, set_password

NEW = "harbour-lantern-quietly-71"


class Recording:
    """The real hasher, noting each call made while an event loop is running in this thread."""

    def __init__(self, real) -> None:
        self.real = real
        self.calls: list[tuple[str, bool]] = []

    def _note(self, name: str) -> None:
        try:
            asyncio.get_running_loop()
            on_loop = True
        except RuntimeError:
            on_loop = False
        self.calls.append((name, on_loop))

    def hash(self, password):
        self._note("hash")
        return self.real.hash(password)

    def verify(self, password_hash, password):
        self._note("verify")
        return self.real.verify(password_hash, password)

    def check_needs_rehash(self, password_hash):
        return self.real.check_needs_rehash(password_hash)


@pytest.fixture
def hasher(monkeypatch) -> Recording:
    recording = Recording(passwords._hasher)
    monkeypatch.setattr(passwords, "_hasher", recording)
    return recording


def test_no_password_flow_runs_argon2_on_the_event_loop(client, db, hasher):
    riya, riya_headers = signup(client, "riya@geu.ac.in", "Riya")  # register: hash
    tokens = client.post("/auth/login", json={"email": "riya@geu.ac.in", "password": PASSWORD})
    assert tokens.status_code == 200  # login: verify
    wrong = client.post("/auth/login", json={"email": "nobody@geu.ac.in", "password": PASSWORD})
    assert wrong.status_code == 401  # unknown account: verify against the dummy
    changed = client.post(
        "/auth/change-password",
        json={"current_password": PASSWORD, "password": NEW},
        headers=auth_header(tokens.json()),
    )
    assert changed.status_code == 200, changed.text

    assert forgot(client, "riya@geu.ac.in").status_code == 202
    assert reset(client, "riya@geu.ac.in", reset_code(client, "riya@geu.ac.in")).status_code == 204

    _, admin = signup(client, "office@geu.ac.in", "Office")
    make_admin(db, "office@geu.ac.in")
    uid = client.get("/admin/users", params={"q": "riya"}, headers=admin).json()[0]["id"]
    assert client.post(f"/admin/users/{uid}/password-link", headers=admin).status_code == 200
    assert set_password(client, link_token(client, "riya@geu.ac.in")).status_code == 200

    _, anna = signup(client, "anna@geu.ac.in", "Anna")
    gone = client.post("/auth/delete-account", json={"password": PASSWORD}, headers=anna)
    assert gone.status_code == 204, gone.text

    kinds = {name for name, _ in hasher.calls}
    assert kinds == {"hash", "verify"}
    assert [c for c in hasher.calls if c[1]] == [], hasher.calls
