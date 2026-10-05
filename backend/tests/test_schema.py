"""Database-level integrity rules. Each bad write must fail on the named constraint."""

from datetime import UTC, datetime

import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError

H32 = "decode(repeat('ab', 32), 'hex')"  # valid 32-byte hash
H16 = "decode(repeat('ab', 16), 'hex')"


@pytest.fixture
def ids(db):
    """Two users (a, b) and an active manual session shared by a."""

    def user(email):
        return db.execute(
            text(
                "INSERT INTO users (name, email, password_hash) VALUES ('U', :e, 'x') RETURNING id"
            ),
            {"e": email},
        ).scalar_one()

    a, b = user("a@example.com"), user("b@example.com")
    s = db.execute(
        text(
            "INSERT INTO share_sessions (sharer_id, source, ends_when, ends_at) "
            "VALUES (:a, 'manual', 'duration', now() + interval '1 hour') RETURNING id"
        ),
        {"a": a},
    ).scalar_one()
    return {"a": a, "b": b, "s": s}


def violates(db, sql: str, params: dict) -> str:
    """Run sql in a savepoint, expect an IntegrityError, return the violated constraint's name."""
    with pytest.raises(IntegrityError) as exc, db.begin_nested():
        db.execute(text(sql), params)
    return exc.value.orig.diag.constraint_name


BAD_WRITES = [
    # users
    (
        "INSERT INTO users (name, email, password_hash) VALUES ('U', 'A@Example.com', 'x')",
        "ck_users_email_lowercase",
    ),
    (
        "INSERT INTO users (name, email, password_hash) VALUES ('U', 'a@example.com', 'x')",
        "uq_users_email",
    ),
    # contacts
    (
        "INSERT INTO contacts (owner_id, contact_email, contact_user_id, status, accepted_at) "
        "VALUES (:a, 'a@example.com', :a, 'accepted', now())",
        "ck_contacts_not_self",
    ),
    (
        "INSERT INTO contacts (owner_id, contact_email, contact_user_id, status) "
        "VALUES (:a, 'b@example.com', :b, 'accepted')",
        "ck_contacts_accepted_at_matches_status",
    ),
    (
        "INSERT INTO contacts (owner_id, contact_email, status, accepted_at) "
        "VALUES (:a, 'b@example.com', 'accepted', now())",
        "ck_contacts_accepted_has_user",
    ),
    (
        "INSERT INTO contacts (owner_id, contact_email) VALUES (:a, 'B@example.com')",
        "ck_contacts_email_lowercase",
    ),
    (
        "INSERT INTO contacts (owner_id, contact_email, status) VALUES (:a, 'b@x.com', 'friend')",
        "ck_contacts_contact_status",
    ),
    # share_sessions
    (
        "INSERT INTO share_sessions (sharer_id, source, ends_when, ends_at) "
        "VALUES (:a, 'manual', 'duration', now() - interval '1 minute')",
        "ck_share_sessions_ends_after_start",
    ),
    (
        "INSERT INTO share_sessions (sharer_id, source, ends_when, ends_at) "
        "VALUES (:a, 'covert', 'duration', now() + interval '1 hour')",
        "ck_share_sessions_share_source",
    ),
    (
        "UPDATE share_sessions SET status = 'ended' WHERE id = :s",
        "ck_share_sessions_ended_at_matches_status",
    ),
    # share_viewers
    ("INSERT INTO share_viewers (session_id) VALUES (:s)", "ck_share_viewers_exactly_one_identity"),
    (
        f"INSERT INTO share_viewers (session_id, viewer_user_id, guest_label, guest_token_hash) "
        f"VALUES (:s, :b, 'G', {H32})",
        "ck_share_viewers_exactly_one_identity",
    ),
    (
        f"INSERT INTO share_viewers (session_id, guest_token_hash) VALUES (:s, {H32})",
        "ck_share_viewers_guest_has_label",
    ),
    (
        f"INSERT INTO share_viewers (session_id, guest_label, guest_token_hash) "
        f"VALUES (:s, 'G', {H16})",
        "ck_share_viewers_guest_token_hash_len",
    ),
    (
        "INSERT INTO share_viewers (session_id, viewer_user_id, status) VALUES (:s, :b, 'granted')",
        "ck_share_viewers_granted_has_timestamp",
    ),
    (
        "INSERT INTO share_viewers (session_id, viewer_user_id, status) VALUES (:s, :b, 'revoked')",
        "ck_share_viewers_revoked_has_timestamp",
    ),
    # locations
    ("INSERT INTO locations VALUES (:s, 91, 0, 5, now())", "ck_locations_lat_range"),
    ("INSERT INTO locations VALUES (:s, 0, -181, 5, now())", "ck_locations_lng_range"),
    ("INSERT INTO locations VALUES (:s, 0, 0, -1, now())", "ck_locations_accuracy_non_negative"),
    # share_codes / refresh_tokens
    (
        f"INSERT INTO share_codes (session_id, created_by, code_hash, expires_at) "
        f"VALUES (:s, :a, {H16}, now() + interval '10 minutes')",
        "ck_share_codes_code_hash_len",
    ),
    (
        f"INSERT INTO share_codes (session_id, created_by, code_hash, expires_at) "
        f"VALUES (:s, :a, {H32}, now() - interval '1 minute')",
        "ck_share_codes_expires_after_create",
    ),
    (
        f"INSERT INTO refresh_tokens (user_id, token_hash, family_id, expires_at) "
        f"VALUES (:a, {H16}, gen_random_uuid(), now())",
        "ck_refresh_tokens_token_hash_len",
    ),
]


@pytest.mark.parametrize(("sql", "constraint"), BAD_WRITES, ids=[c for _, c in BAD_WRITES])
def test_bad_write_is_rejected(db, ids, sql, constraint):
    assert violates(db, sql, ids) == constraint


def test_duplicate_contact_and_viewer_rejected(db, ids):
    invite = "INSERT INTO contacts (owner_id, contact_email) VALUES (:a, 'b@example.com')"
    db.execute(text(invite), ids)
    assert violates(db, invite, ids) == "uq_contacts_owner_id_contact_email"
    db.execute(text("INSERT INTO share_viewers (session_id, viewer_user_id) VALUES (:s, :b)"), ids)
    assert (
        violates(db, "INSERT INTO share_viewers (session_id, viewer_user_id) VALUES (:s, :b)", ids)
        == "uq_share_viewers_session_id_viewer_user_id"
    )


def test_only_one_latest_location_per_session(db, ids):
    db.execute(text("INSERT INTO locations VALUES (:s, 30.3, 78.0, 5, now())"), ids)
    assert violates(db, "INSERT INTO locations VALUES (:s, 30.4, 78.1, 5, now())", ids) == (
        "pk_locations"
    )


def test_valid_rows_are_accepted(db, ids):
    db.execute(
        text(
            "INSERT INTO contacts (owner_id, contact_email, contact_user_id, status, accepted_at) "
            "VALUES (:a, 'b@example.com', :b, 'accepted', now())"
        ),
        ids,
    )
    db.execute(
        text(
            "INSERT INTO share_viewers (session_id, viewer_user_id, status, granted_at) "
            "VALUES (:s, :b, 'granted', now())"
        ),
        ids,
    )
    db.execute(
        text(
            f"INSERT INTO share_viewers (session_id, guest_label, guest_token_hash) "
            f"VALUES (:s, 'Riya', {H32})"
        ),
        ids,
    )
    db.execute(text("UPDATE share_sessions SET status='ended', ended_at=now() WHERE id=:s"), ids)


def test_deleting_a_session_removes_its_location_viewers_and_codes(db, ids):
    db.execute(text("INSERT INTO locations VALUES (:s, 30.3, 78.0, 5, now())"), ids)
    db.execute(text("INSERT INTO share_viewers (session_id, viewer_user_id) VALUES (:s, :b)"), ids)
    db.execute(
        text(
            f"INSERT INTO share_codes (session_id, created_by, code_hash, expires_at) "
            f"VALUES (:s, :a, {H32}, now() + interval '10 minutes')"
        ),
        ids,
    )
    db.execute(text("DELETE FROM share_sessions WHERE id = :s"), ids)
    for table in ("locations", "share_viewers", "share_codes"):
        assert db.execute(text(f"SELECT count(*) FROM {table}")).scalar_one() == 0, table  # noqa: S608


def test_timestamps_are_timezone_aware(db, ids):
    # 10:00 IST is 04:30 UTC; the stored instant must not depend on the server's timezone.
    ist = db.execute(
        text(
            "UPDATE share_sessions SET ends_at = '2099-10-05 10:00:00+05:30' "
            "WHERE id = :s RETURNING ends_at"
        ),
        ids,
    ).scalar_one()
    assert ist.tzinfo is not None
    assert ist.astimezone(UTC) == datetime(2099, 10, 5, 4, 30, tzinfo=UTC)
