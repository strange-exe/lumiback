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
    """owner_id lets contact_user_id see them (once accepted). Only the owner can create it."""

    __tablename__ = "contacts"
    __table_args__ = (
        UniqueConstraint("owner_id", "contact_user_id"),
        CheckConstraint("owner_id <> contact_user_id", name="not_self"),
        CheckConstraint(
            "(status = 'accepted') = (accepted_at IS NOT NULL)", name="accepted_at_matches_status"
        ),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    contact_user_id: Mapped[uuid.UUID] = mapped_column(
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
