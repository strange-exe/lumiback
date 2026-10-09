"""Database schema (M0 core).

Integrity rules live in the database as CHECK / UNIQUE / FK constraints, not only in Python,
so no code path (or manual SQL) can create an inconsistent sharing state.
"""

import enum
import uuid
from datetime import date, datetime, time

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Date,
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
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY
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
    APP = "app"  # started in the mobile app; runs in the background until it ends


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
    ADMIN = "admin"  # an admin following up a late student's escalation (no viewer row)


class UserRole(enum.StrEnum):
    STUDENT = "student"
    ADMIN = "admin"  # wardens / security: see gate scans and who is out, manage gates


class Via(enum.StrEnum):
    """How an outing was opened or closed: logged in the app, or scanned at a gate."""

    SELF = "self"
    GATE = "gate"


class LateReply(enum.StrEnum):
    """A late student's answer to the "are you OK?" alert."""

    ON_MY_WAY = "on_my_way"
    SAFE = "safe"


class ScanDirection(enum.StrEnum):
    OUT = "out"
    IN = "in"


class ScanResult(enum.StrEnum):
    ACCEPTED = "accepted"
    BAD_CODE = "bad_code"  # unknown gate, wrong or expired rotating code
    GATE_OFF = "gate_off"  # gate deactivated by an admin
    TOO_FAR = "too_far"  # GPS says the phone is not at the gate
    WEAK_GPS = "weak_gps"  # accuracy too poor to tell
    MOCK_GPS = "mock_gps"  # Android reports a mock-location provider
    NOT_ALLOWED = "not_allowed"  # at the gate, but the outing rules don't allow it now


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        # Stored normalized; the DB enforces it so uniqueness is case-insensitive by construction.
        CheckConstraint("email = lower(email)", name="email_lowercase"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    role: Mapped[UserRole] = mapped_column(
        str_enum(UserRole, "user_role"), server_default=UserRole.STUDENT.value
    )
    name: Mapped[str] = mapped_column(String(100))
    email: Mapped[str] = mapped_column(String(254), unique=True)
    password_hash: Mapped[str] = mapped_column(Text)
    roll_no: Mapped[str | None] = mapped_column(String(32))
    hostel: Mapped[str | None] = mapped_column(String(64))  # free text from sign-up (legacy)
    # The hostel decides the outing rules (via its rule set). Until a student picks one, the
    # campus default rule set applies.
    hostel_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("hostels.id", ondelete="SET NULL")
    )
    # Contacts for escalations and the weekend form (entered once, prefilled on forms).
    phone: Mapped[str | None] = mapped_column(String(16))
    emergency_name: Mapped[str | None] = mapped_column(String(80))
    emergency_relation: Mapped[str | None] = mapped_column(String(40))
    emergency_phone: Mapped[str | None] = mapped_column(String(16))
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
    out_via: Mapped[Via] = mapped_column(str_enum(Via, "outing_via"), server_default=Via.SELF.value)
    in_via: Mapped[Via | None] = mapped_column(str_enum(Via, "outing_in_via"))
    out_gate_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gates.id", ondelete="SET NULL")
    )
    in_gate_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("gates.id", ondelete="SET NULL")
    )
    # When the "you're late, are you OK?" alert went out (once per outing).
    overdue_notified_at: Mapped[datetime | None]
    # The approved weekend/holiday request this outing was allowed by.
    request_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("outing_requests.id", ondelete="SET NULL")
    )
    # Late follow-up: the "are you OK?" alert goes out at 30 min late (overdue_notified_at);
    # the student's answer, if any. No answer within minutes and it's escalated.
    late_reply: Mapped[LateReply | None] = mapped_column(str_enum(LateReply, "late_reply"))
    late_replied_at: Mapped[datetime | None]


class DayType(enum.StrEnum):
    WEEKDAY = "weekday"
    SATURDAY = "saturday"
    SUNDAY = "sunday"
    HOLIDAY = "holiday"


class RuleSet(Base):
    """A named set of outing rules ("Boys' hostels"), shared by the hostels that follow it."""

    __tablename__ = "rule_sets"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(60), unique=True)
    created_at: Mapped[datetime] = created_at()


class DayRule(Base):
    """One day type's rules in a rule set. Times are on the campus clock (IST)."""

    __tablename__ = "day_rules"
    __table_args__ = (
        CheckConstraint("return_by > opens_at", name="window_order"),
        CheckConstraint("max_minutes IS NULL OR max_minutes BETWEEN 30 AND 720", name="max_range"),
    )

    rule_set_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("rule_sets.id", ondelete="CASCADE"), primary_key=True
    )
    day_type: Mapped[DayType] = mapped_column(str_enum(DayType, "day_type"), primary_key=True)
    opens_at: Mapped[time] = mapped_column(Time)  # earliest tap-out
    return_by: Mapped[time] = mapped_column(Time)  # latest normal return
    max_minutes: Mapped[int | None]  # longest outing; None: the window is the limit
    needs_form: Mapped[bool] = mapped_column(server_default=text("false"))


class Hostel(Base):
    """A hostel, the rule set it follows, and who to call about its students."""

    __tablename__ = "hostels"

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(60), unique=True)
    rule_set_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("rule_sets.id", ondelete="RESTRICT"))
    warden_name: Mapped[str | None] = mapped_column(String(80))
    warden_phone: Mapped[str | None] = mapped_column(String(16))
    created_at: Mapped[datetime] = created_at()


class Holiday(Base):
    """A date with holiday rules (form + weekend-style window), whatever weekday it falls on."""

    __tablename__ = "holidays"

    day: Mapped[date] = mapped_column(Date, primary_key=True)
    name: Mapped[str] = mapped_column(String(60))


class RequestStatus(enum.StrEnum):
    PENDING = "pending"
    APPROVED = "approved"
    DECLINED = "declined"
    CANCELLED = "cancelled"


class OutingRequest(Base):
    """The weekend/holiday outing form: sent on the day, approved by an admin before tap-out.
    Contacts are a snapshot (what the student gave for this outing)."""

    __tablename__ = "outing_requests"
    __table_args__ = (
        CheckConstraint(
            "requested_minutes IS NULL OR requested_minutes BETWEEN 30 AND 720",
            name="requested_range",
        ),
        # One live request per student per day: a declined or cancelled one can be replaced.
        Index(
            "uq_outing_requests_one_live_per_day",
            "student_id",
            "day",
            unique=True,
            postgresql_where=text("status IN ('pending', 'approved')"),
        ),
        Index("ix_outing_requests_status_created", "status", "created_at"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    student_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    day: Mapped[date] = mapped_column(Date)  # the IST date it is for (always the day it's sent)
    purpose: Mapped[str] = mapped_column(String(200))
    phone: Mapped[str] = mapped_column(String(16))
    emergency_name: Mapped[str] = mapped_column(String(80))
    emergency_relation: Mapped[str] = mapped_column(String(40))
    emergency_phone: Mapped[str] = mapped_column(String(16))
    requested_minutes: Mapped[int | None]  # shorter than the day's max, if the student wants
    status: Mapped[RequestStatus] = mapped_column(
        str_enum(RequestStatus, "request_status"), server_default=RequestStatus.PENDING.value
    )
    decided_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    decided_at: Mapped[datetime | None]
    note: Mapped[str | None] = mapped_column(String(200))  # e.g. why it was declined
    created_at: Mapped[datetime] = created_at()


class Escalation(Base):
    """A late student who didn't answer the "are you OK?" alert: for an admin to follow up."""

    __tablename__ = "escalations"

    id: Mapped[uuid.UUID] = uuid_pk()
    outing_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("outings.id", ondelete="CASCADE"), unique=True
    )
    created_at: Mapped[datetime] = created_at()
    resolved_by: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL")
    )
    resolved_at: Mapped[datetime | None]
    note: Mapped[str | None] = mapped_column(String(200))


class CampusSettings(Base):
    """One row of campus-wide settings, edited by admins."""

    __tablename__ = "campus_settings"
    __table_args__ = (
        CheckConstraint("id = 1", name="single_row"),
        CheckConstraint("scan_retention_days BETWEEN 7 AND 730", name="retention_range"),
    )

    id: Mapped[int] = mapped_column(primary_key=True, server_default=text("1"))
    # Superseded by rule sets (kept one release for app versions that still read /campus.curfew).
    curfew: Mapped[time] = mapped_column(Time, server_default=text("'21:30'"))
    # Rules for students who haven't picked a hostel yet.
    default_rule_set_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("rule_sets.id", ondelete="SET NULL")
    )
    scan_retention_days: Mapped[int] = mapped_column(server_default=text("180"))
    updated_at: Mapped[datetime] = created_at()


class Gate(Base):
    """A campus gate with a kiosk showing a rotating QR code. Keeps only the kiosk token hash."""

    __tablename__ = "gates"
    __table_args__ = (
        hash_len_check("kiosk_token_hash"),
        CheckConstraint("radius_m BETWEEN 10 AND 500", name="radius_range"),
        CheckConstraint("lat BETWEEN -90 AND 90 AND lng BETWEEN -180 AND 180", name="coordinates"),
    )

    id: Mapped[uuid.UUID] = uuid_pk()
    name: Mapped[str] = mapped_column(String(80), unique=True)
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    radius_m: Mapped[int] = mapped_column(server_default=text("75"))
    kiosk_token_hash: Mapped[bytes] = mapped_column(LargeBinary, unique=True)
    active: Mapped[bool] = mapped_column(server_default=text("true"))
    created_at: Mapped[datetime] = created_at()


class GateScan(Base):
    """Every scan attempt, accepted or not. Stores the distance from the gate, never the
    phone's coordinates (data minimisation: admins need "was at the gate", not a location)."""

    __tablename__ = "gate_scans"
    __table_args__ = (
        Index("ix_gate_scans_scanned", "scanned_at"),
        Index("ix_gate_scans_user_scanned", "user_id", "scanned_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    gate_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("gates.id", ondelete="SET NULL"))
    direction: Mapped[ScanDirection] = mapped_column(str_enum(ScanDirection, "scan_direction"))
    result: Mapped[ScanResult] = mapped_column(str_enum(ScanResult, "scan_result"))
    distance_m: Mapped[float | None] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float)
    outing_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("outings.id", ondelete="SET NULL")
    )
    scanned_at: Mapped[datetime] = created_at()


class PushToken(Base):
    """An Expo push token for one installed app. A token moves to whoever signed in last."""

    __tablename__ = "push_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), index=True
    )
    token: Mapped[str] = mapped_column(String(255), unique=True)
    platform: Mapped[str] = mapped_column(String(16))
    # Notification channels the student switched off in the app (e.g. "follow-requests").
    muted: Mapped[list[str]] = mapped_column(ARRAY(String(32)), server_default=text("'{}'"))
    created_at: Mapped[datetime] = created_at()
    last_seen_at: Mapped[datetime] = mapped_column(server_default=func.now())


class AdminAudit(Base):
    """Who changed what in the admin area (roles, gates, kiosk tokens, settings)."""

    __tablename__ = "admin_audit"

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(40))
    target: Mapped[str] = mapped_column(String(160))
    at: Mapped[datetime] = created_at()


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


class PendingRegistration(Base):
    """A sign-up waiting for its email code. No user exists until the code is entered.

    Kept only while pending: deleted when the code is verified, and by the sweep once expired.
    Registering again with the same email replaces it, so an unverified sign-up can never
    lock an address. The password is stored only as its Argon2 hash; the 6-digit code only as
    HMAC(CODE_PEPPER, email:code), and it is useless after a few wrong attempts.
    """

    __tablename__ = "pending_registrations"
    __table_args__ = (
        CheckConstraint("email = lower(email)", name="email_lowercase"),
        hash_len_check("code_hash"),
        CheckConstraint("attempts >= 0", name="attempts_non_negative"),
        CheckConstraint("expires_at > created_at", name="expires_after_create"),
    )

    email: Mapped[str] = mapped_column(String(254), primary_key=True)
    name: Mapped[str] = mapped_column(String(100))
    roll_no: Mapped[str | None] = mapped_column(String(32))
    password_hash: Mapped[str] = mapped_column(Text)
    code_hash: Mapped[bytes] = mapped_column(LargeBinary)
    attempts: Mapped[int] = mapped_column(server_default=text("0"))
    expires_at: Mapped[datetime]
    created_at: Mapped[datetime] = created_at()


class PasswordReset(Base):
    """A "forgot password" code waiting to be used: one per account, replaced by a newer request.

    Like sign-up codes, only HMAC(CODE_PEPPER, "reset:" email:code) is stored, it expires after
    15 minutes, and it is useless after a few wrong attempts. Deleted when used and by the sweep.
    """

    __tablename__ = "password_resets"
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
    """Latest positions only, deleted when the session ends: at most two rows per session, the
    latest real fix and the latest fix Android flagged as coming from a mock-location app. While
    a mock app runs, the phone has no real fix to give, so viewers see the last real one beside
    the fake one instead of a lie on its own."""

    __tablename__ = "locations"
    __table_args__ = (
        CheckConstraint("lat BETWEEN -90 AND 90", name="lat_range"),
        CheckConstraint("lng BETWEEN -180 AND 180", name="lng_range"),
        CheckConstraint("accuracy_m >= 0", name="accuracy_non_negative"),
    )

    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("share_sessions.id", ondelete="CASCADE"), primary_key=True
    )
    mocked: Mapped[bool] = mapped_column(primary_key=True, server_default=text("false"))
    lat: Mapped[float] = mapped_column(Float)
    lng: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float] = mapped_column(Float)
    recorded_at: Mapped[datetime]


class AccessLog(Base):
    __tablename__ = "access_log"
    __table_args__ = (
        Index("ix_access_log_session_viewed", "session_id", "viewed_at"),
        CheckConstraint("viewer_id IS NOT NULL OR channel = 'admin'", name="who_viewed"),
    )

    id: Mapped[int] = mapped_column(BigInteger, Identity(), primary_key=True)
    session_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("share_sessions.id", ondelete="CASCADE")
    )
    viewer_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("share_viewers.id", ondelete="CASCADE")
    )
    # Set for admin reads (escalations); viewer_id is set for everyone else.
    admin_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
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
