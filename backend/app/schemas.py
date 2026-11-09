"""Request/response models. Inputs forbid unknown fields so typos fail loudly."""

import re
import unicodedata
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_serializer,
    field_validator,
    model_validator,
)

from app.security.passwords import MAX_LENGTH, password_problem

_NAME_JOINERS = frozenset((chr(0x200C), chr(0x200D)))  # ZWNJ, ZWJ
# Letters (Lo) that show nothing: the Hangul fillers. A name of only these looks empty.
_INVISIBLE_LETTERS = frozenset(map(chr, (0x115F, 0x1160, 0x3164, 0xFFA0)))


def _no_control_characters(value: object) -> object:
    """Names go into email subjects and greetings and onto other people's screens: refuse
    control characters (Cc: CR, LF, tab, NUL, C1 such as NEL), invisible format characters
    (Cf: bidi overrides, zero-width spaces, BOM) and line or paragraph separators (Zl, Zp)
    anywhere, even where stripping would hide them. ZWNJ and ZWJ are the exception: Indic
    scripts spell real names with them."""
    if isinstance(value, str) and any(
        # Cs: a lone surrogate (half of a cut emoji), never valid text.
        unicodedata.category(c) in ("Cc", "Cf", "Cs", "Zl", "Zp") and c not in _NAME_JOINERS
        for c in value
    ):
        raise ValueError("must not contain control or invisible formatting characters")
    return value


def _has_a_letter_or_digit(value: str) -> str:
    """A person's name shows at least one letter or digit (joiners, marks, punctuation or
    Hangul fillers alone would look like a blank name on someone else's screen)."""
    if not any(unicodedata.category(c)[0] in "LN" and c not in _INVISIBLE_LETTERS for c in value):
        raise ValueError("must contain a letter or digit")
    return value


Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    AfterValidator(_has_a_letter_or_digit),
    # Last, so it runs first (before validators run outermost-first): it sees the raw input,
    # before strip_whitespace could remove a trailing CR or LF.
    BeforeValidator(_no_control_characters),
]
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
    # For the signed-in devices list (services/device_label.py): the app names itself
    # ("Lumiback app on Android 14"); the website passes the browser's user agent, which is
    # reduced to "Chrome on Windows" and never stored as is.
    device: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, min_length=1, max_length=60),
            BeforeValidator(_no_control_characters),
        ]
        | None
    ) = None
    user_agent: str | None = Field(default=None, max_length=512)


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


class ChangePasswordIn(Input):
    current_password: str = Field(max_length=1024)  # re-entered: a stolen session alone can't
    password: str = Field(max_length=MAX_LENGTH)  # the new one; never stripped or altered


class DeleteAccountIn(Input):
    password: str = Field(max_length=1024)  # re-entered: a stolen session alone cannot delete


class RefreshIn(Input):
    refresh_token: str = Field(min_length=1, max_length=200)


class DeviceOut(BaseModel):
    """One signed-in device (a sign-in that's still on)."""

    id: uuid.UUID
    device: str | None  # None: signed in before devices were named, or not recognised
    signed_in_at: datetime
    last_active_at: datetime
    current: bool  # the device asking


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
    # The safe-return emergency contact, as the server knows it (the label can be copied).
    contact: bool = False
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
    # While the sharer is out on an outing: when they're due back, and the earlier time if they
    # told the hostel office they're running late (never the reason: that's the office's).
    due_back_at: datetime | None = None
    original_due_at: datetime | None = None


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
    viewer_id: uuid.UUID | None  # None for an admin following up an escalation
    viewer_name: str
    kind: Literal["user", "guest", "admin"]
    contact: bool = False  # see ViewerOut.contact
    channel: str
    viewed_at: datetime


class CodeOut(BaseModel):
    code: str  # shown once; only its HMAC is stored
    expires_at: datetime


# Phrases in the labels the server gives other viewers (app/services/safe_return.py,
# locations.py, export.py), compared as letters and digits only.
_RESERVED_LABEL_PHRASES = ("emergencycontact", "hosteloffice")


def _not_a_reserved_label(value: str) -> str:
    """A guest can't label themselves like the safe-return contact or a warden. NFKC folds
    fullwidth and other compatibility forms; keeping only visible letters and digits ignores
    brackets, spacing, punctuation and the blank Hangul fillers. Cross-script look-alikes
    aren't folded."""
    folded = "".join(
        c
        for c in unicodedata.normalize("NFKC", value).casefold()
        if c.isalnum() and c not in _INVISIBLE_LETTERS
    )
    if any(phrase in folded for phrase in _RESERVED_LABEL_PHRASES):
        raise ValueError("can't look like a label Lumiback gives other viewers")
    return value


# Goes into the sharer's push title and viewer list: the same checks as Name.
GuestLabel = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=40),
    AfterValidator(_not_a_reserved_label),
    AfterValidator(_has_a_letter_or_digit),
    BeforeValidator(_no_control_characters),
]


class RedeemIn(Input):
    code: str = Field(min_length=1, max_length=20)
    guest_label: GuestLabel | None = None  # required when not logged in


class RedeemOut(BaseModel):
    session_id: uuid.UUID
    viewer_id: uuid.UUID
    status: str
    guest_token: str | None = None  # guests only, shown once; send as X-Guest-Token


# Every role, for output. Inputs from the dashboard (RoleIn, PersonIn, the CSV import) never
# take "developer": only scripts/make_developer.py grants it.
AnyRole = Literal["student", "warden", "head_warden", "admin", "developer"]


# The roles a developer can view the screens of (X-View-As-Role, api/deps.py).
ViewableRole = Literal["student", "warden", "head_warden", "admin"]


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    email: str
    roll_no: str | None
    hostel: str | None
    email_verified: bool
    created_at: datetime
    role: AnyRole = "student"
    # GET /auth/me while a developer views as a role (X-View-As-Role): that role, which is
    # also `role` then. The real role is "developer" whenever this is set.
    viewing_as: ViewableRole | None = None


# ---------- outings ----------

# India Standard Time has no daylight saving, so a fixed offset is exact (and needs no tz database).
IST = timezone(timedelta(hours=5, minutes=30), "IST")
# One line each, shown to wardens: no control characters (a NUL can't even be stored).
Destination = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=100),
    BeforeValidator(_no_control_characters),
]
Purpose = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    BeforeValidator(_no_control_characters),
]


class OutingCreateIn(Input):
    destination: Destination | None = None
    purpose: Purpose | None = None
    # Ignored: the outing rules set the return time. Accepted so older app versions still work.
    expected_return_at: AwareDatetime | None = None
    # "Let my emergency contact follow until I'm back": emails them a watch link for this outing.
    safe_return: bool = False


InVia = Literal["self", "gate", "staff", "unrecorded"]
CorrectionKindLit = Literal["return", "return_time", "cancel"]
CorrectionReason = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=3, max_length=300),
    BeforeValidator(_no_control_characters),
]


class CorrectionIn(Input):
    """return: they came back at `returned_at` (an open outing). return_time: they came back
    at `returned_at` instead (a closed one). cancel: the tap was a mistake, no trip."""

    kind: CorrectionKindLit
    returned_at: AwareDatetime | None = None
    reason: CorrectionReason

    @model_validator(mode="after")
    def _time_unless_cancel(self) -> "CorrectionIn":
        if self.kind != "cancel" and self.returned_at is None:
            raise ValueError("Say when they came back")
        return self


class CorrectionOut(BaseModel):
    """The latest correction on an outing: applied by the office, or asked for by the student."""

    id: uuid.UUID
    kind: CorrectionKindLit
    status: Literal["pending", "approved", "declined", "cancelled"]
    returned_at: datetime | None
    reason: str
    by_staff: bool  # the office made it (else the student asked)
    old_returned_at: datetime | None  # what the record said before, once applied
    note: str | None  # the office's reply to a student's ask
    created_at: datetime

    @field_serializer("returned_at", "old_returned_at", "created_at")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class CorrectionDecisionIn(Input):
    approve: bool
    note: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, max_length=300),
            BeforeValidator(_no_control_characters),
        ]
        | None
    ) = None


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
    # staff: the hostel office recorded or corrected the return. unrecorded: closed when they
    # tapped out again on a later day, so when they came back isn't known.
    in_via: InVia | None = None
    late_reply: Literal["on_my_way", "safe"] | None = None  # answer to the "are you OK?" alert
    # The share the emergency contact follows (safe return), for the app or website to send
    # location to. None: not chosen, or it couldn't start (e.g. today's email limit).
    safe_return_session_id: uuid.UUID | None = None
    correction: CorrectionOut | None = None  # the latest one, if any
    # Only on the current outing (GET /outings/current): who to call while out or late.
    office: "OfficeContact | None" = None
    # Running late (told the office once, before the late alert): expected_return_at is the
    # moved time; these are the time before it, the move, the reason and when.
    original_return_at: datetime | None = None
    running_late_minutes: Literal[15, 30, 60] | None = None
    running_late_reason: str | None = None
    running_late_at: datetime | None = None
    # What the student may choose now ([] once used, after the late alert, or once back).
    running_late_choices: list[int] = []

    @field_serializer(
        "left_at", "expected_return_at", "returned_at", "original_return_at", "running_late_at"
    )
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class RunningLateIn(Input):
    """ "I'm running late": 15, 30 or 60 minutes, once per outing, with an optional reason
    the hostel office reads (one line, no control or invisible characters; blank = none)."""

    minutes: Literal[15, 30, 60]
    reason: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, max_length=120),
            BeforeValidator(_no_control_characters),
        ]
        | None
    ) = None

    @field_validator("reason")
    @classmethod
    def _blank_is_none(cls, value: str | None) -> str | None:
        return value or None


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


# ---------- contacts, hostels, weekend requests ----------


def _phone(value: str) -> str:
    """'98765 43210', '+91-98765-43210', '09876543210' -> '+919876543210'. Other countries need
    their + code. Stored in one dialable form so a warden can call it straight from the page."""
    digits = re.sub(r"[\s\-().]", "", value)
    if digits.startswith("+"):
        rest = digits[1:]
        if not rest.isdigit() or not 8 <= len(rest) <= 15:
            raise ValueError("Phone numbers have 8 to 15 digits after the country code.")
        return "+" + rest
    if not digits.isdigit():
        raise ValueError("A phone number can only have digits.")
    if len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    if len(digits) == 12 and digits.startswith("91"):
        digits = digits[2:]
    if len(digits) != 10 or digits[0] not in "6789":
        raise ValueError("Enter a 10-digit Indian mobile number, or add the country code (+).")
    return "+91" + digits


Phone = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=24), AfterValidator(_phone)
]
# Emailed and shown to others like Name (the same checks, see Name for the order).
PersonName = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=80),
    AfterValidator(_has_a_letter_or_digit),
    BeforeValidator(_no_control_characters),
]
Relation = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=40),
    BeforeValidator(_no_control_characters),
]


class ContactsIn(Input):
    """The student's own number and an emergency contact (parent, guardian or companion)."""

    phone: Phone
    emergency_name: PersonName
    emergency_relation: Relation
    emergency_phone: Phone


ContactEmail = Annotated[EmailStr, Field(max_length=254), AfterValidator(str.lower)]


class ProfileIn(Input):
    """Fields a student may change on their profile. Omitted fields stay as they are."""

    hostel_id: uuid.UUID | None = None
    contacts: ContactsIn | None = None
    # Separate from `contacts` so app versions that don't know it never clear it. null clears.
    emergency_email: ContactEmail | None = None


class ProfileOut(BaseModel):
    hostel_id: uuid.UUID | None
    hostel: str | None  # the hostel's name
    # Chosen once: after that only the hostel office can move the student.
    hostel_locked: bool = False
    phone: str | None
    emergency_name: str | None
    emergency_relation: str | None
    emergency_phone: str | None
    emergency_email: str | None = None  # for safe return; never shown to anyone else


class HostelChoiceOut(BaseModel):
    """For the student's hostel picker: just names and their rule set."""

    id: uuid.UUID
    name: str
    rule_set: str


class OutingRequestIn(ContactsIn):
    purpose: Purpose
    # Shorter than the day's limit, if the student wants; never longer.
    requested_minutes: int | None = Field(default=None, ge=30, le=720)


class OutingRequestOut(BaseModel):
    id: uuid.UUID
    day: date
    purpose: str
    requested_minutes: int | None
    status: Literal["pending", "approved", "declined", "cancelled"]
    note: str | None
    decided_at: datetime | None
    created_at: datetime
    used: bool  # an outing was started with it
    again: bool  # asked after an earlier approval that day was used

    @field_serializer("decided_at", "created_at")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class RequestDecisionIn(Input):
    approve: bool
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None


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
    # Ignored: the outing rules set the return time. Accepted so older app versions still work.
    expected_return_at: AwareDatetime | None = None
    destination: Destination | None = None
    # Tapping out only: safe return, as in OutingCreateIn. Ignored when tapping in.
    safe_return: bool = False
    # The answer to "your outing from an earlier day is still open": coming back in, or going
    # out again (that old outing is then closed as an unrecorded return). Ignored otherwise.
    intent: Literal["in", "out"] | None = None
    # Sent by apps that can show that question (1.10.0+). Older apps get a plain message.
    ask_if_stale: bool = False


class GateScanOut(BaseModel):
    direction: Literal["out", "in"]
    gate: str
    outing: OutingOut


class TodayRulesOut(BaseModel):
    """The student's outing rules for today (their hostel's rule set, or the campus default)."""

    day: date
    day_type: Literal["weekday", "saturday", "sunday", "holiday"]
    label: str  # "Weekday", "Sunday", or the holiday's name
    rule_set: str
    hostel: str | None  # None: the student hasn't picked one (campus default rules)
    opens_at: datetime
    return_by: datetime
    max_minutes: int | None
    needs_form: bool  # today needs an approved form...
    no_form_from: datetime | None = None  # ...except from this time (no form, no maximum)

    @field_serializer("opens_at", "return_by", "no_form_from")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class CampusOut(BaseModel):
    """What a student may know about the outing rules, on the campus clock.
    `curfew`/`curfew_at` (today's return-by) stay for app versions that predate `today`.
    All three are None when the rules aren't set up (no return time to show)."""

    curfew: str | None = None  # "20:00", IST
    curfew_at: datetime | None = None
    today: TodayRulesOut | None = None

    @field_serializer("curfew_at")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


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
    # Any scan or outing names this gate: it stays for the records (switch it off instead).
    # Only an unused gate can be removed.
    used: bool = False
    # Kiosk health, for admins only (None for wardens): when the tablet last asked for a code,
    # and what that means now (services/gates.py kiosk_health).
    kiosk_seen_at: datetime | None = None
    kiosk: Literal["ok", "stale", "never", "quiet"] | None = None

    @field_serializer("kiosk_seen_at")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class GateCreated(BaseModel):
    gate: GateOut
    kiosk_token: str  # shown once; only its hash is stored


ClockTime = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]


class CampusSettingsIO(Input):
    # Superseded by rule sets; optional so the settings page can leave it out.
    curfew: ClockTime | None = None
    scan_retention_days: int = Field(ge=7, le=730)
    # Kiosk quiet hours, "HH:MM" IST: both, or both null (off, the default). May cross
    # midnight. Leaving both out of a PUT keeps them as they are.
    kiosk_quiet_from: ClockTime | None = None
    kiosk_quiet_until: ClockTime | None = None
    # Follow-up timings in minutes (always answered; a PUT that leaves one out keeps it).
    request_remind_minutes: int | None = Field(default=None, ge=5, le=240)
    request_backup_minutes: int | None = Field(default=None, ge=5, le=240)
    escalation_realert_minutes: int | None = Field(default=None, ge=5, le=240)
    escalation_takeover_minutes: int | None = Field(default=None, ge=5, le=240)

    @model_validator(mode="after")
    def _quiet_pair(self) -> "CampusSettingsIO":
        if (self.kiosk_quiet_from is None) != (self.kiosk_quiet_until is None):
            raise ValueError("Give both quiet-hour times, or neither")
        if self.kiosk_quiet_from is not None and self.kiosk_quiet_from == self.kiosk_quiet_until:
            raise ValueError("Quiet hours need different start and end times")
        return self


class AdminOverview(BaseModel):
    out_now: int
    overdue: int
    scans_today: int
    rejected_today: int
    active_gates: int
    pending_requests: int = 0  # today's weekend/holiday requests waiting for a decision
    open_escalations: int = 0  # late students who didn't answer, not yet handled
    corrections: int = 0  # students' correction asks plus unrecorded returns to fix
    open_help: int = 0  # students who pressed Help, not yet handled


class AdminOuting(BaseModel):
    id: uuid.UUID
    # None (both) for a deleted account's outing; `name` then ends "(deleted account)".
    student_id: uuid.UUID | None
    name: str
    email: str | None
    roll_no: str | None
    destination: str | None
    left_at: datetime
    expected_return_at: datetime
    returned_at: datetime | None = None
    status: Literal["out", "overdue", "returned"]
    late_minutes: int  # past the return time: when they came back, or so far
    out_via: Literal["self", "gate"]
    out_gate: str | None
    in_via: InVia | None = None
    hostel: str | None = None
    late_reply: Literal["on_my_way", "safe"] | None = None  # answer to the late alert
    on_request: bool = False  # a weekend/holiday outing an admin approved
    # The student said they're running late: expected_return_at is the moved time.
    original_return_at: datetime | None = None
    running_late_minutes: int | None = None
    running_late_reason: str | None = None
    running_late_at: datetime | None = None

    @field_serializer(
        "left_at", "expected_return_at", "returned_at", "original_return_at", "running_late_at"
    )
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class RecordEscalation(BaseModel):
    """The late follow-up of one outing on a student's record."""

    created_at: datetime
    resolved_at: datetime | None
    resolved_by: str | None  # the staff member's name (None: open, or their account is gone)
    note: str | None

    @field_serializer("created_at", "resolved_at")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class RecordOuting(AdminOuting):
    """An outing on a student's record, with everything that happened to it."""

    purpose: str | None = None
    corrections: list["CorrectionOut"] = []  # oldest first
    escalation: RecordEscalation | None = None


class RecordOutingPage(BaseModel):
    items: list[RecordOuting]
    next_before: datetime | None  # a left_at: pass as ?before= for older outings

    @field_serializer("next_before")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class StudentRecordOut(BaseModel):
    """The top of a student's record: who they are, and their record in numbers (outings and
    late ones in the hostels the viewer looks after)."""

    student: "StudentOut"
    outings: int
    late: int
    open_escalations: int
    requests: int


class CorrectionAsk(BaseModel):
    """A student's correction ask, with the outing as it stands."""

    correction: CorrectionOut
    outing: AdminOuting


class CorrectionQueue(BaseModel):
    asks: list[CorrectionAsk]
    # Closed when the student tapped out again on a later day: when they came back is unknown.
    unrecorded: list[AdminOuting]


class AdminScan(BaseModel):
    id: int
    student_id: uuid.UUID | None = None  # for a link to their record
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


class AuditEntry(BaseModel):
    """One change in admin_audit. The actor fields are None once their account was deleted."""

    id: int
    at: datetime
    actor_name: str | None
    actor_email: str | None
    actor_role: AnyRole | None
    action: str  # "gate:create", "settings", ...: the area, then what was done
    target: str

    @field_serializer("at")
    def _in_ist(self, value: datetime) -> str:
        return value.astimezone(IST).isoformat()


class AuditPage(BaseModel):
    items: list[AuditEntry]
    next_before: int | None  # entry id: pass as ?before= for older ones


class AdminUser(BaseModel):
    id: uuid.UUID
    name: str
    email: str
    roll_no: str | None
    role: AnyRole
    hostel_ids: list[uuid.UUID] = []  # a warden's hostels
    hostels: list[str] = []
    home_hostel_id: uuid.UUID | None = None  # the hostel they live in (students), to move them
    home_hostel: str | None = None
    # invited: imported, hasn't chosen a password; reset: password reset, not chosen yet;
    # off: turned off by the hostel office
    account: Literal["active", "invited", "reset", "off"] = "active"


class StudentOut(BaseModel):
    """Someone the hostel office looks after, with the contacts it may need."""

    id: uuid.UUID
    name: str
    email: str
    roll_no: str | None
    role: AnyRole
    hostel_id: uuid.UUID | None
    hostel: str | None
    phone: str | None
    emergency_name: str | None
    emergency_relation: str | None
    emergency_phone: str | None
    status: Literal["in", "out", "overdue"]  # right now
    account: Literal["active", "invited", "reset", "off"] = "active"  # see AdminUser


class StudentHostelIn(Input):
    """The hostel office moving a student (students choose their hostel only once)."""

    hostel_id: uuid.UUID


class RoleIn(Input):
    role: Literal["student", "warden", "head_warden", "admin"]  # never "developer"
    # Required (at least one) for a warden; ignored for other roles.
    hostel_ids: list[uuid.UUID] = Field(default_factory=list, max_length=50)


def _roll_no(value: str) -> str:
    if not (3 <= len(value) <= 32 and value.isascii() and value.isalnum()):
        raise ValueError("A roll no. is 3 to 32 letters or digits.")
    return value


RollNo = Annotated[
    str, StringConstraints(strip_whitespace=True, max_length=64), AfterValidator(_roll_no)
]


class AccountEditIn(Input):
    """Corrects the details someone was set up with. Only the fields sent change; send
    `roll_no` or `phone` as null to clear it. Changing `email` is for admins only."""

    name: Name | None = None
    email: ContactEmail | None = None
    roll_no: RollNo | None = None
    phone: Phone | None = None


class AccountOn(Input):
    on: bool


# ---------- adding students in bulk, set-password links ----------


class StudentImportIn(Input):
    csv: str = Field(min_length=1, max_length=600_000)  # the service caps it at 512 KB
    confirm: bool = False  # False: only check the rows


class PersonIn(Input):
    """One person, added from a form: the same columns and checks as a row of the CSV import
    (the service validates the values). They're emailed a link to choose a password."""

    name: str = Field(max_length=200)
    role: Literal["student", "warden", "head_warden", "admin"] = "student"  # never "developer"
    student_id: str | None = Field(default=None, max_length=64)  # required for students
    email: str | None = Field(default=None, max_length=254)  # defaults from the student ID
    hostel_id: uuid.UUID | None = None  # a student's hostel; the one a warden looks after
    phone: str | None = Field(default=None, max_length=32)
    parent_name: str | None = Field(default=None, max_length=200)
    parent_phone: str | None = Field(default=None, max_length=32)


class StudentImportRow(BaseModel):
    line: int
    student_id: str
    name: str
    email: str
    hostel: str | None
    status: Literal["new", "exists", "error", "added"]
    error: str | None
    role: AnyRole


class StudentImportOut(BaseModel):
    rows: list[StudentImportRow]
    added: int  # 0 until confirmed
    new: int
    existing: int
    errors: int


class PasswordLinkOut(BaseModel):
    kind: Literal["invite", "reset"]  # reset: the old password stopped working
    email: str


class LinkTokenIn(Input):
    token: str = Field(min_length=20, max_length=100, pattern=r"^[A-Za-z0-9_-]+$")


class LinkInfoOut(BaseModel):
    name: str
    email: str
    invite: bool  # setting up a new account (otherwise a reset)


class SetPasswordIn(LinkTokenIn):
    password: str = Field(max_length=MAX_LENGTH)  # never stripped or altered


class SetPasswordOut(BaseModel):
    email: str  # to prefill sign-in


# ---------- push ----------


class PushTokenIn(Input):
    # Expo push tokens look like ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx].
    token: Annotated[
        str, StringConstraints(pattern=r"^Expo(nent)?PushToken\[[A-Za-z0-9_-]{8,200}\]$")
    ]
    platform: Literal["android", "ios"]
    # Channels switched off in the app's notification settings; pushes on them are skipped
    # (urgent safety alerts excepted). "share-status" also carries outing-request decisions.
    muted: list[Literal["follow-requests", "return-reminders", "share-status"]] = Field(
        default_factory=list, max_length=3
    )
    # The app draws the update announcement itself (apps after 1.20.0), so it can be sent
    # data-only. Older apps don't send it: they get the visible push.
    draws_updates: bool = False


# ---------- admin: outing rules, hostels, holidays, weekend requests ----------

Clock = Annotated[str, StringConstraints(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")]  # "18:00", IST
ShortName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]


class DayRuleIO(Input):
    day_type: Literal["weekday", "saturday", "sunday", "holiday"]
    opens_at: Clock
    return_by: Clock
    max_minutes: int | None = Field(default=None, ge=30, le=720)
    needs_form: bool = False
    no_form_from: Clock | None = None  # form days only: no form needed from this time

    @model_validator(mode="after")
    def _order(self) -> "DayRuleIO":
        if self.return_by <= self.opens_at:
            raise ValueError("the return time must be after the opening time")
        if not self.needs_form:
            self.no_form_from = None  # every outing that day is already form-free
        elif self.no_form_from is not None and not (
            self.opens_at <= self.no_form_from < self.return_by
        ):
            raise ValueError("'no form needed from' must be between the opening and return times")
        return self


class RuleSetIn(Input):
    name: ShortName
    days: list[DayRuleIO] = Field(min_length=4, max_length=4)

    @model_validator(mode="after")
    def _every_day_once(self) -> "RuleSetIn":
        if {d.day_type for d in self.days} != {"weekday", "saturday", "sunday", "holiday"}:
            raise ValueError("give rules for weekday, saturday, sunday and holiday, once each")
        return self


class RuleSetOut(BaseModel):
    id: uuid.UUID
    name: str
    is_default: bool  # applies to students who haven't picked a hostel
    hostels: list[str]
    days: list[DayRuleIO]


class HostelIn(Input):
    name: ShortName
    rule_set_id: uuid.UUID
    warden_name: PersonName | None = None
    warden_phone: Phone | None = None


class HostelContactIn(Input):
    """What a warden may change about their own hostel: the contact shown on escalations."""

    warden_name: PersonName | None = None
    warden_phone: Phone | None = None


class HostelOut(BaseModel):
    id: uuid.UUID
    name: str
    rule_set_id: uuid.UUID
    rule_set: str
    warden_name: str | None
    warden_phone: str | None
    students: int


class HolidayIO(Input):
    day: date
    name: ShortName


class AdminRequestOut(BaseModel):
    """A weekend/holiday request as admins see it: who, why, how long, and whom to call."""

    id: uuid.UUID
    student_id: uuid.UUID
    name: str
    email: str
    roll_no: str | None
    hostel: str | None
    day: date
    purpose: str
    phone: str
    emergency_name: str
    emergency_relation: str
    emergency_phone: str
    requested_minutes: int | None
    max_minutes: int | None  # the student's limit that day, for context
    status: Literal["pending", "approved", "declined", "cancelled"]
    note: str | None
    decided_by: str | None
    decided_at: datetime | None
    created_at: datetime
    used: bool
    again: bool  # another outing after today's approved one was used

    @field_serializer("decided_at", "created_at")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class RecordRequestPage(BaseModel):
    """A student's requests on their record, newest first."""

    items: list[AdminRequestOut]
    next_before: datetime | None  # a created_at: pass as ?before= for older requests

    @field_serializer("next_before")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


# ---------- late follow-up and escalations ----------


class LateReplyIn(Input):
    reply: Literal["on_my_way", "safe"]


class LastSeenOut(BaseModel):
    """Where a late student was last known to be. Never collected for this: an active live
    share's latest real position, or else the last gate they scanned."""

    kind: Literal["live", "gate"]
    at: datetime
    lat: float | None = None
    lng: float | None = None
    accuracy_m: float | None = None
    gate: str | None = None
    mock_since: datetime | None = None  # the share has a newer fix flagged as mock location

    @field_serializer("at", "mock_since")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class EscalationOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    name: str  # ends "(deleted account)" once the student deleted it
    email: str | None  # None for a deleted account
    roll_no: str | None
    hostel: str | None
    warden_name: str | None
    warden_phone: str | None
    phone: str | None
    emergency_name: str | None
    emergency_relation: str | None
    emergency_phone: str | None
    destination: str | None
    purpose: str | None
    left_at: datetime
    expected_return_at: datetime
    returned_at: datetime | None
    late_minutes: int
    alert_at: datetime | None
    late_reply: Literal["on_my_way", "safe"] | None
    late_replied_at: datetime | None
    last_seen: LastSeenOut | None
    resolved_by: str | None
    resolved_at: datetime | None
    note: str | None

    # Follow-up: who said "I'm on it" (None: nobody yet), the office's calls (oldest first),
    # how many re-alerts went out while nobody had, and when it went to the head wardens.
    claimed_by: str | None = None
    claimed_by_me: bool = False
    claimed_at: datetime | None = None
    handed_over_at: datetime | None = None
    realerts: int = 0
    calls: list["EscalationCallOut"] = []

    @field_serializer(
        "created_at",
        "left_at",
        "expected_return_at",
        "returned_at",
        "alert_at",
        "late_replied_at",
        "resolved_at",
        "claimed_at",
        "handed_over_at",
    )
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class EscalationResolveIn(Input):
    note: Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None = None


# Short text one person writes for another to read (a call note, an office notice): one line,
# no control or invisible formatting characters.
ShortText = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=200),
    BeforeValidator(_no_control_characters),
]

CallOutcomeName = Literal["reached_student", "reached_contact", "no_answer", "left_message"]


class EscalationCallIn(Input):
    outcome: CallOutcomeName
    note: ShortText | None = None


class EscalationCallOut(BaseModel):
    at: datetime
    by: str | None  # the staff member's name (None: their account is gone)
    outcome: CallOutcomeName
    note: str | None

    @field_serializer("at")
    def _in_ist(self, value: datetime) -> str:
        return value.astimezone(IST).isoformat()


# ---------- wave 2: call the office, notices, help ----------


class OfficeContact(BaseModel):
    """Who a student who is out can call: their outing's hostel and its office number (the
    warden contact on the Hostel page). `phone` None: the hostel has no number yet, so the
    student can ask the office to call them instead."""

    hostel: str | None
    name: str | None
    phone: str | None


class CallMeOut(BaseModel):
    notified: int  # office members told


class NoticeIn(Input):
    """A short notice from the hostel office to its students who are out. `recall`: "come
    back now". `hostel_id`: one of the sender's hostels (else all of them)."""

    message: ShortText
    recall: bool = False
    hostel_id: uuid.UUID | None = None


class NoticeOut(BaseModel):
    sent: int  # students it went to


class HelpFixIn(Input):
    """The one location fix sent with a help alert (none if the phone gave none)."""

    lat: float = Field(ge=-90, le=90)
    lng: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0, le=100_000)
    mocked: bool = False


class HelpIn(Input):
    location: HelpFixIn | None = None


class HelpOut(BaseModel):
    office: OfficeContact | None
    office_told: int  # wardens and head wardens
    followers_told: int  # people the student shares their location with
    contact_told: bool  # the emergency contact was emailed


class HelpRequestOut(BaseModel):
    id: uuid.UUID
    created_at: datetime
    student_id: uuid.UUID
    name: str
    roll_no: str | None
    phone: str | None
    hostel: str | None
    # The fix sent with it; cleared a day later (null then, or if the phone gave none).
    lat: float | None
    lng: float | None
    accuracy_m: float | None
    mocked: bool
    returned: bool  # the outing it was sent from has ended
    handled_by: str | None
    handled_at: datetime | None
    note: str | None

    @field_serializer("created_at", "handled_at")
    def _in_ist(self, value: datetime | None) -> str | None:
        return value.astimezone(IST).isoformat() if value else None


class HelpHandleIn(Input):
    note: ShortText | None = None


# ---------- wave 3: update announcements (developers) ----------


AnnouncementKind = Literal["feature", "fix", "maintenance", "notice"]
# The roles an announcement can go to (wave 5): every role there is.
AudienceRole = Literal["student", "warden", "head_warden", "admin", "developer"]


def _unique(roles: list[str]) -> list[str]:
    if len(set(roles)) != len(roles):
        raise ValueError("Each role once")
    return roles


class AnnouncementIn(Input):
    """A short push about a released update: plain text, one line each. Wave 5 adds `kind`,
    `audience` and a banner (`image`: a name from the website's banner list, feature launches
    only). 1.18 and 1.19 apps send only title and body: a notice to everyone."""

    title: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=50),
        BeforeValidator(_no_control_characters),
    ]
    body: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=140),
        BeforeValidator(_no_control_characters),
    ]
    kind: AnnouncementKind = "notice"
    audience: (
        Literal["everyone"]
        | Annotated[list[AudienceRole], Field(min_length=1, max_length=5), AfterValidator(_unique)]
    ) = "everyone"
    # Checked against the banner list in api/admin.py (BANNERS), never used as a URL.
    image: Annotated[str, StringConstraints(pattern=r"^[a-z][a-z0-9-]{0,39}$")] | None = None

    @model_validator(mode="after")
    def _image_for_features_only(self) -> "AnnouncementIn":
        if self.image is not None and self.kind != "feature":
            raise ValueError("A banner is for feature launches only")
        return self


class AnnouncementSent(BaseModel):
    devices: int  # phones it is going to
    # Always None since the daily limit went (2026-11-09); kept so 1.18.x apps still parse it.
    next_at: datetime | None


class AnnouncementOut(BaseModel):
    """One sent announcement in the history. Those sent before wave 5 went to everyone and kept
    only `at`, `by` and `title` (kind and devices are None)."""

    at: datetime
    by: str | None  # the developer's name; None if their account was deleted
    kind: AnnouncementKind | None
    title: str
    audience: Literal["everyone"] | list[str]
    devices: int | None
    image: str | None


class Banner(BaseModel):
    name: str
    url: str  # on the configured website, e.g. https://lumiback.abhinesh.codes/app/banners/x.png


class AnnouncementStatus(BaseModel):
    last_at: datetime | None
    next_at: datetime | None  # always None (allowed now), kept for 1.18.x apps
    history: list[AnnouncementOut] = []  # the last 20, newest first
    banners: list[Banner] = []  # the pictures a feature launch may carry


# ---------- wave 4: reports (the office) ----------


class ReportStats(BaseModel):
    """One hostel's numbers (or the campus's) for a range of IST days. Counts only: never a
    student's name, roll number or anything else that says who."""

    outings: int  # left in the range (a cancelled mistaken tap isn't one)
    gate_out: int  # left through a gate scan
    self_out: int  # logged in the app or on the website
    back: int  # came back with a recorded time (not still out, not "not recorded")
    returned_late: int  # of `back`, at least a minute after their due time
    late_rate: float | None  # returned_late / back, 0 to 1; None with nobody back
    median_minutes_late: int | None  # among the late ones
    escalations: int  # opened in the range
    requests_approved: int  # outing requests for days in the range
    requests_declined: int
    running_late: int  # outings where the student moved their due time


class ReportHostel(ReportStats):
    hostel_id: uuid.UUID | None  # None: students who hadn't chosen a hostel
    hostel: str


class ReportWeek(BaseModel):
    week_start: date  # the Monday (IST)
    days: int  # how many of its days are inside the range (1 to 7)
    outings: int
    returned_late: int


class Report(BaseModel):
    start: date
    end: date
    # False for a warden: `total` then covers their hostels only, not the campus.
    every_hostel: bool
    hostels: list[ReportHostel]
    total: ReportStats
    weeks: list[ReportWeek]


# ---------- wave 4: error reports (the website and the app) ----------


def _strip_controls(value: object, keep: str = "") -> object:
    """Removes control and invisible formatting characters (Cc, Cf, Cs, Co, Zl, Zp: NUL, bidi
    overrides, zero-width spaces) except those in `keep`. Error text is stored, emailed and
    shown on the developer's page, so none of it may reorder or hide what is shown."""
    if not isinstance(value, str):
        return value
    return "".join(
        c
        for c in value
        if c in keep or unicodedata.category(c) not in ("Cc", "Cf", "Cs", "Co", "Zl", "Zp")
    )


def _one_line(value: object) -> object:
    """A message is one line: breaks and tabs become spaces, other controls are dropped."""
    if isinstance(value, str):
        value = re.sub(r"[\r\n\t]+", " ", value)
    return _strip_controls(value)


class ErrorReportIn(Input):
    """What the website or the app sends when something breaks (POST /errors). Hard caps on
    every field; the body as a whole is capped before it is read (api/errors.py)."""

    message: Annotated[
        str,
        StringConstraints(strip_whitespace=True, min_length=1, max_length=500),
        BeforeValidator(_one_line),
    ]
    stack: (
        Annotated[
            str,
            StringConstraints(max_length=8000),
            BeforeValidator(lambda v: _strip_controls(v, keep="\n\t")),
        ]
        | None
    ) = None
    route: (
        Annotated[
            str,
            StringConstraints(strip_whitespace=True, max_length=300),
            BeforeValidator(_one_line),
        ]
        | None
    ) = None
    app_version: Annotated[str, StringConstraints(pattern=r"^[0-9A-Za-z.+-]{1,32}$")] | None = None
    platform: Literal["web", "android", "ios"]


class ErrorGroup(BaseModel):
    """One group of the same error, scrubbed (services/error_reports.py). Who reported it is
    never shown: only whether the latest report came from a signed-in session."""

    id: int
    message: str
    top_frame: str | None
    stack: str | None
    route: str | None
    platform: str
    app_version: str | None
    count: int
    first_seen_at: datetime
    last_seen_at: datetime
    signed_in: bool

    @field_serializer("first_seen_at", "last_seen_at")
    def _in_ist(self, value: datetime) -> str:
        return value.astimezone(IST).isoformat()


class ErrorGroupList(BaseModel):
    items: list[ErrorGroup]
