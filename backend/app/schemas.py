"""Request/response models. Inputs forbid unknown fields so typos fail loudly."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated, Literal

from pydantic import (
    AwareDatetime,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_serializer,
    model_validator,
)

from app.security.passwords import MAX_LENGTH, password_problem

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
OptionalShort = Annotated[
    str, StringConstraints(strip_whitespace=True, min_length=1, max_length=64)
]


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RegisterIn(Input):
    name: Name
    email: EmailStr
    password: str = Field(max_length=MAX_LENGTH)  # never stripped or altered
    roll_no: Annotated[OptionalShort, StringConstraints(max_length=32)] | None = None

    @model_validator(mode="after")
    def _normalize_and_check(self) -> "RegisterIn":
        self.email = self.email.lower()
        if problem := password_problem(self.password, email=self.email, name=self.name):
            raise ValueError(f"password {problem}")
        return self


class RegisteredOut(BaseModel):
    """A sign-up waiting for its code. There is no account (and no id) until it is verified."""

    email: str
    code_expires_in_minutes: int


class LoginIn(Input):
    email: EmailStr
    password: str = Field(max_length=1024)


class EmailIn(Input):
    email: EmailStr


class VerifyEmailIn(Input):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")


class ResetPasswordIn(Input):
    email: EmailStr
    code: str = Field(pattern=r"^\d{6}$")
    # Strength is checked after the code (it needs the account's name), see password_reset.py.
    password: str = Field(max_length=MAX_LENGTH)  # never stripped or altered


class DeleteAccountIn(Input):
    password: str = Field(max_length=1024)  # re-entered: a stolen session alone cannot delete


class RefreshIn(Input):
    refresh_token: str = Field(min_length=1, max_length=200)


class TokenOut(BaseModel):
    access_token: str
    token_type: str = "bearer"  # noqa: S105 - OAuth token type, not a secret
    expires_in: int
    refresh_token: str


class ContactInviteIn(Input):
    email: EmailStr


class Person(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str


class OutgoingContact(BaseModel):
    """Someone I invited. `person` is only known once they accept (no enumeration)."""

    id: uuid.UUID
    email: str
    status: str
    person: Person | None
    created_at: datetime
    accepted_at: datetime | None


class IncomingContact(BaseModel):
    """Someone who invited me to be able to see them."""

    id: uuid.UUID
    owner: Person
    status: str
    created_at: datetime
    accepted_at: datetime | None


class ContactsOut(BaseModel):
    outgoing: list[OutgoingContact]
    incoming: list[IncomingContact]


MAX_MINUTES = {"manual": 8 * 60, "tab_live": 4 * 60, "app": 8 * 60}


class SessionCreateIn(Input):
    """`outing` and `pairing` sessions are created by their own flows (M4, M5), not here."""

    source: Literal["manual", "tab_live", "app"]
    duration_minutes: int = Field(default=60, ge=5)
    viewer_user_ids: list[uuid.UUID] = Field(default_factory=list, max_length=20)

    @model_validator(mode="after")
    def _check(self) -> "SessionCreateIn":
        cap = MAX_MINUTES[self.source]
        if self.duration_minutes > cap:
            raise ValueError(f"{self.source} sessions last at most {cap} minutes")
        if self.source == "manual" and not self.viewer_user_ids:
            raise ValueError("choose at least one contact to share with")
        if self.source in ("tab_live", "app") and self.viewer_user_ids:
            raise ValueError(f"{self.source} viewers join with a code, not by id")
        if len(set(self.viewer_user_ids)) != len(self.viewer_user_ids):
            raise ValueError("viewer_user_ids contains duplicates")
        return self


class StopIn(Input):
    """Why the sharer's device ended the session: a tap, or the share tab closing."""

    reason: Literal["stopped_by_sharer", "tab_closed"] = "stopped_by_sharer"


class ViewerOut(BaseModel):
    id: uuid.UUID
    kind: Literal["user", "guest"]
    name: str
    status: str
    requested_at: datetime
    granted_at: datetime | None
    revoked_at: datetime | None


class SessionOut(BaseModel):
    """The sharer's full view of their own session."""

    id: uuid.UUID
    source: str
    ends_when: str
    status: str  # effective: an active session past ends_at reads "ended"
    ends_at: datetime
    created_at: datetime
    ended_at: datetime | None
    ended_reason: str | None
    viewers: list[ViewerOut]


class SharerRef(BaseModel):
    id: uuid.UUID
    name: str


class WatchingOut(BaseModel):
    """A viewer's view of a session shared with them (no other viewers, no history)."""

    id: uuid.UUID
    sharer: SharerRef
    source: str
    ends_at: datetime


class LocationIn(Input):
    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0, le=100_000)
    recorded_at: AwareDatetime  # device time with offset; naive timestamps are rejected
    mocked: bool = False  # Android's mock-location flag; app versions before it never send it


class LocationOut(BaseModel):
    lat: float
    lng: float
    accuracy_m: float
    recorded_at: datetime
    stale: bool  # no fresh update recently: show "paused", not a live dot


class SessionLocationOut(BaseModel):
    session_id: uuid.UUID
    location: LocationOut | None  # latest real fix; None until the sharer's first one
    # Latest fix from a mock-location app, kept apart so it is never shown as the real position.
    # Older than `location`: the mock app was used earlier in this share and has been turned off.
    mocked_location: LocationOut | None = None


class AccessLogEntry(BaseModel):
    viewer_id: uuid.UUID
    viewer_name: str
    kind: Literal["user", "guest"]
    channel: str
    viewed_at: datetime


class CodeOut(BaseModel):
    code: str  # shown once; only its HMAC is stored
    expires_at: datetime


GuestLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=40)]


class RedeemIn(Input):
    code: str = Field(min_length=1, max_length=20)
    guest_label: GuestLabel | None = None  # required when not logged in


class RedeemOut(BaseModel):
    session_id: uuid.UUID
    viewer_id: uuid.UUID
    status: str
    guest_token: str | None = None  # guests only, shown once; send as X-Guest-Token


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    roll_no: str | None
    hostel: str | None
    email_verified: bool
    created_at: datetime
    role: Literal["student", "admin"] = "student"


# ---------- outings ----------

# India Standard Time has no daylight saving, so a fixed offset is exact (and needs no tz database).
IST = timezone(timedelta(hours=5, minutes=30), "IST")
Destination = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
Purpose = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class OutingCreateIn(Input):
    destination: Destination | None = None
    purpose: Purpose | None = None
    expected_return_at: AwareDatetime  # any offset; naive timestamps are rejected


class OutingExtendIn(Input):
    expected_return_at: AwareDatetime


class OutingOut(BaseModel):
    """Times are returned in IST (+05:30). Status is derived, never stored."""

    id: uuid.UUID
    destination: str | None
    purpose: str | None
    left_at: datetime
    expected_return_at: datetime
    returned_at: datetime | None
    status: Literal["out", "overdue", "returned"]
    late_minutes: int  # past expected return: when returned, or so far if overdue
    duration_minutes: int | None  # once returned
    out_via: Literal["self", "gate"] = "self"  # tapped out at a gate, or logged in the app
    in_via: Literal["self", "gate"] | None = None

    @field_serializer("left_at", "expected_return_at", "returned_at")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class OutingPage(BaseModel):
    items: list[OutingOut]
    next_before: datetime | None  # pass as ?before= for the next page

    @field_serializer("next_before")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class OutingSummary(BaseModel):
    total: int
    returned: int
    returned_late: int
    on_time_rate: float | None  # share of returned outings back by the expected time
    currently: Literal["in", "out", "overdue"]


# ---------- gates (tap in / tap out) ----------

GateName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]


class GateScanIn(Input):
    qr: str = Field(min_length=1, max_length=300)
    lat: Latitude
    lng: Longitude
    accuracy_m: float = Field(ge=0, le=100_000)
    mocked: bool = False  # Android's "from a mock location provider" flag
    # Tap-out only: when the student plans to be back. Defaults to today's curfew.
    expected_return_at: AwareDatetime | None = None
    destination: (
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]
        | None
    ) = None


class GateScanOut(BaseModel):
    direction: Literal["out", "in"]
    gate: str
    outing: OutingOut


class KioskOut(BaseModel):
    gate_id: uuid.UUID
    gate_name: str
    qr: str
    refresh_at: datetime  # when this code stops being the current one

    @field_serializer("refresh_at")
    def _utc(self, value: datetime) -> str:
        return value.isoformat()


# ---------- admin ----------


class GateIn(Input):
    name: GateName
    lat: Latitude
    lng: Longitude
    radius_m: int = Field(default=75, ge=10, le=500)


class GatePatch(Input):
    name: GateName | None = None
    lat: Latitude | None = None
    lng: Longitude | None = None
    radius_m: int | None = Field(default=None, ge=10, le=500)
    active: bool | None = None


class GateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    lat: float
    lng: float
    radius_m: int
    active: bool
    created_at: datetime


class GateCreated(BaseModel):
    gate: GateOut
    kiosk_token: str  # shown once; only its hash is stored


class CampusSettingsIO(Input):
    curfew: Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]
    scan_retention_days: int = Field(ge=7, le=730)


class AdminOverview(BaseModel):
    out_now: int
    overdue: int
    scans_today: int
    rejected_today: int
    active_gates: int


class AdminOuting(BaseModel):
    id: uuid.UUID
    student_id: uuid.UUID
    name: str
    email: str
    roll_no: str | None
    destination: str | None
    left_at: datetime
    expected_return_at: datetime
    status: Literal["out", "overdue", "returned"]
    late_minutes: int
    out_via: Literal["self", "gate"]
    out_gate: str | None

    @field_serializer("left_at", "expected_return_at")
    def _in_ist(self, value: datetime) -> str:
        return value.astimezone(IST).isoformat()


class AdminScan(BaseModel):
    id: int
    name: str
    roll_no: str | None
    gate: str | None
    direction: Literal["out", "in"]
    result: str
    distance_m: float | None
    accuracy_m: float | None
    scanned_at: datetime

    @field_serializer("scanned_at")
    def _in_ist(self, value: datetime) -> str:
        return value.astimezone(IST).isoformat()


class AdminScanPage(BaseModel):
    items: list[AdminScan]
    next_before: int | None  # scan id: pass as ?before= for older scans


class AdminUser(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    roll_no: str | None
    role: Literal["student", "admin"]


class RoleIn(Input):
    role: Literal["student", "admin"]


# ---------- push ----------


class PushTokenIn(Input):
    # Expo push tokens look like ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx].
    token: Annotated[
        str, StringConstraints(pattern=r"^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$")
    ]
    platform: Literal["android", "ios"]
    # Channels switched off in the app's notification settings; pushes on them are skipped.
    muted: list[Literal["follow-requests", "return-reminders", "share-status"]] = Field(
        default_factory=list, max_length=3
    )
