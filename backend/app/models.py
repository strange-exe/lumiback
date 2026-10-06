"""Database schema (M0 core).

Integrity rules live in the database as CHECK / UNIQUE / FK constraints, not only in Python,
so no code path (or manual SQL) can create an inconsistent sharing state.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Identity,
    Index,
    LargeBinary,
    MetaData,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

HASH_BYTES = 32  # SHA-256 / HMAC-SHA256 digest size

# Deterministic constraint names so Alembic migrations are stable and reviewable.
NAMING_CONVENTION = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {datetime: DateTime(timezone=True)}


def str_enum(cls: type[enum.StrEnum], name: str) -> Enum:
    """VARCHAR + CHECK instead of a native Postgres ENUM: adding a value is a simple migration."""
    return Enum(
        cls,
        name=name,
        native_enum=False,
        create_constraint=True,
        length=16,
        values_callable=lambda e: [m.value for m in e],
    )


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(primary_key=True, server_default=text("gen_random_uuid()"))


def created_at() -> Mapped[datetime]:
    return mapped_column(server_default=func.now())


def hash_len_check(column: str) -> CheckConstraint:
    return CheckConstraint(f"octet_length({column}) = {HASH_BYTES}", name=f"{column}_len")


class ContactStatus(enum.StrEnum):
    PENDING = "pending"
    ACCEPTED = "accepted"


class ShareSource(enum.StrEnum):
    OUTING = "outing"
    TAB_LIVE = "tab_live"
    PAIRING = "pairing"
    MANUAL = "manual"


class EndsWhen(enum.StrEnum):
    UNTIL_RETURN = "until_return"
    TAB_CLOSED = "tab_closed"
    UNTIL_REVOKED = "until_revoked"
    DURATION = "duration"


class SessionStatus(enum.StrEnum):
    ACTIVE = "active"
    ENDED = "ended"
    REVOKED = "revoked"


class ViewerStatus(enum.StrEnum):
    PENDING = "pending"
    GRANTED = "granted"
    REVOKED = "revoked"


class AccessChannel(enum.StrEnum):
    HTTP = "http"
    WS = "ws"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # Stored normalized; the DB enforces it so uniqueness is case-insensitive by construction.
        CheckConstraint("email = lower(email)", name="email_lowercase"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    roll_no: Mapped[str | None] = mapped_column(String(32))
    hostel: Mapped[str | None] = mapped_column(String(64))
    email_verified_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()

    @property
    def email_verified(self) -> bool:
        return self.email_verified_at is not None


class Outing(Base):
    """A student's trip out of the hostel. Status (out / overdue / returned) is derived from
    the timestamps when read, never stored, so it cannot go stale."""

    __tablename__ = "outings"
    __table_args__ = (
        CheckConstraint("expected_return_at > left_at", name="expected_after_leaving"),
        CheckConstraint(
            "returned_at IS NULL OR returned_at >= left_at", name="returned_after_leaving"
        ),
        # At most one open outing per student, enforced by the database (no double check-out,
        # even with two simultaneous requests).
        Index(
            "uq_outings_one_open_per_student",
            "student_id",
            unique=True,
            postgresql_where=text("returned_at IS NULL"),
        ),
        Index("ix_outings_student_left", "student_id", "left_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    destination: Mapped[str | None] = mapped_column(String(100))
    purpose: Mapped[str | None] = mapped_column(String(200))
    left_at: Mapped[datetime] = mapped_column(server_default=func.now())
    expected_return_at: Mapped[datetime]
    returned_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()


class RateLimitHit(Base):
    """One rate-limited attempt. key_hash = HMAC(pepper, scope:key); no readable personal data."""

    __tablename__ = "rate_limit_hits"
    __table_args__ = (
        hash_len_check("key_hash"),
        Index("ix_rate_limit_hits_lookup", "scope", "key_hash", "hit_at"),
        Index("ix_rate_limit_hits_hit_at", "hit_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    scope: Mapped[str] = mapped_column(String(32))
    key_hash: Mapped[bytes] = mapped_column(LargeBinary)
    hit_at: Mapped[datetime]


class EmailVerification(Base):
    """A 6-digit code sent to the user's inbox. Only the newest one per user is kept.

    Six digits is a small space, so the code is stored as HMAC(CODE_PEPPER, user_id:code),
    expires quickly, and is destroyed after a few wrong attempts.
    """

    __tablename__ = "email_verifications"
    __table_args__ = (
        hash_len_check("code_hash"),
        CheckConstraint("attempts >= 0", name="attempts_non_negative"),
        CheckConstraint("expires_at > created_at", name="expires_after_create"),
    )

    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), primary_key=True
    )
    code_hash: Mapped[bytes] = mapped_column(LargeBinary)
    attempts: Mapped[int] = mapped_column(server_default=text("0"))
    expires_at: Mapped[datetime]
    created_at: Mapped[datetime] = created_at()


class RefreshToken(Base):
    __tablename__ = "refresh_tokens"
    __table_args__ = (hash_len_check("token_hash"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    family_id: Mapped[uuid.UUID] = mapped_column(index=True)
    expires_at: Mapped[datetime]
    revoked_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()


class Contact(Base):
    """owner_id invites an email; once that user accepts, owner may choose them as a viewer.

    Invitations are keyed by email, not user, so an invite looks identical whether or not the
    account exists (no account enumeration). contact_user_id is set only on acceptance.
    Only the owner can create a contact; nobody can add themselves to someone else's list.
    """

    __tablename__ = "contacts"
    __table_args__ = (
        UniqueConstraint("owner_id", "contact_email"),
        UniqueConstraint("owner_id", "contact_user_id"),
        CheckConstraint("owner_id <> contact_user_id", name="not_self"),
        CheckConstraint("contact_email = lower(contact_email)", name="email_lowercase"),
        CheckConstraint(
            "(status = 'accepted') = (accepted_at IS NOT NULL)", name="accepted_at_matches_status"
        ),
        CheckConstraint(
            "(status = 'accepted') = (contact_user_id IS NOT NULL)", name="accepted_has_user"
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    contact_email: Mapped[str] = mapped_column(String(254), index=True)
    contact_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    status: Mapped[ContactStatus] = mapped_column(
        str_enum(ContactStatus, "contact_status"), server_default=ContactStatus.PENDING.value
    )
    created_at: Mapped[datetime] = created_at()
    accepted_at: Mapped[datetime | None]


class ShareSession(Base):
    __tablename__ = "share_sessions"
    __table_args__ = (
        CheckConstraint("ends_at > created_at", name="ends_after_start"),
        CheckConstraint("(status = 'active') = (ended_at IS NULL)", name="ended_at_matches_status"),
        Index("ix_share_sessions_sharer_status", "sharer_id", "status"),
        # Expiry sweep only scans live sessions.
        Index(
            "ix_share_sessions_active_ends_at",
            "ends_at",
            postgresql_where=text("status = 'active'"),
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    sharer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    source: Mapped[ShareSource] = mapped_column(str_enum(ShareSource, "share_source"))
    ends_when: Mapped[EndsWhen] = mapped_column(str_enum(EndsWhen, "ends_when"))
    ends_at: Mapped[datetime]
    status: Mapped[SessionStatus] = mapped_column(
        str_enum(SessionStatus, "session_status"), server_default=SessionStatus.ACTIVE.value
    )
    ended_reason: Mapped[str | None] = mapped_column(String(32))
    created_at: Mapped[datetime] = created_at()
    ended_at: Mapped[datetime | None]
    # Last check-in from the sharer's device (server time); tab-live ends when it goes quiet.
    sharer_seen_at: Mapped[datetime | None]


class ShareViewer(Base):
    """A registered user OR a code-holding guest. Never both, never neither."""

    __tablename__ = "share_viewers"
    __table_args__ = (
        CheckConstraint(
            "(viewer_user_id IS NULL) <> (guest_token_hash IS NULL)", name="exactly_one_identity"
        ),
        CheckConstraint(
            "guest_token_hash IS NULL OR guest_label IS NOT NULL", name="guest_has_label"
        ),
        CheckConstraint(
            "status <> 'granted' OR granted_at IS NOT NULL", name="granted_has_timestamp"
        ),
        CheckConstraint(
            "status <> 'revoked' OR revoked_at IS NOT NULL", name="revoked_has_timestamp"
        ),
        hash_len_check("guest_token_hash"),
        UniqueConstraint("session_id", "viewer_user_id"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("share_sessions.id", ondelete="CASCADE")
    )
    viewer_user_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    guest_label: Mapped[str | None] = mapped_column(String(40))
    guest_token_hash: Mapped[bytes | None] = mapped_column(LargeBinary, unique=True)
    status: Mapped[ViewerStatus] = mapped_column(
        str_enum(ViewerStatus, "viewer_status"), server_default=ViewerStatus.PENDING.value
    )
    requested_at: Mapped[datetime] = created_at()
    granted_at: Mapped[datetime | None]
    revoked_at: Mapped[datetime | None]


class Location(Base):
    """Latest position only (one row per session, upserted). Deleted when the session ends."""

    __tablename__ = "locations"
    __table_args__ = (
        CheckConstraint("lat BETWEEN -90 AND 90", name="lat_range"),
        CheckConstraint("lng BETWEEN -180 AND 180", name="lng_range"),
        CheckConstraint("accuracy_m >= 0", name="accuracy_non_negative"),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("share_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float] = mapped_column(Float)
    recorded_at: Mapped[datetime]


class AccessLog(Base):
    __tablename__ = "access_log"
    __table_args__ = (Index("ix_access_log_session_viewed", "session_id", "viewed_at"),)

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("share_sessions.id", ondelete="CASCADE")
    )
    viewer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("share_viewers.id", ondelete="CASCADE"))
    channel: Mapped[AccessChannel] = mapped_column(str_enum(AccessChannel, "access_channel"))
    viewed_at: Mapped[datetime] = created_at()


class ShareCode(Base):
    """Single-use join code for a session. Only the HMAC of the code is stored."""

    __tablename__ = "share_codes"
    __table_args__ = (
        hash_len_check("code_hash"),
        CheckConstraint("expires_at > created_at", name="expires_after_create"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("share_sessions.id", ondelete="CASCADE"), index=True
    )
    created_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    code_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
    created_at: Mapped[datetime] = created_at()
