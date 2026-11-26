"""The hostel board: what the hostel office tells every student in some hostels, or in all of
them (timings, mess, laundry, maintenance). Spec: .claude/tasks/hostel-board-spec.md.

- Posting: wardens (their own hostels only), head wardens and admins (any hostels, or all).
  Never a developer, although developers pass every other office check (EVERY_HOSTEL).
- Reading: a student sees the active posts for their current hostel, and every all-hostels
  post. Active: not withdrawn and not yet ended.
- The office's list: every-hostel staff see every post; a warden sees all-hostels posts and
  posts for any of their hostels. Another office's post is a 404, as if it didn't exist.
- Withdrawing: the author, or every-hostel staff (head wardens and admins).
- Seen: only ever a count, over the students the post was for when sent (kept per post in
  board_post_audience, so moving, turning off or adding a student never moves it), in steps
  of SEEN_FLOOR, and hidden while fewer than SEEN_FLOOR did or didn't open it (seen_band), so
  nobody can be singled out, by one post or by comparing two (owner, 2026-11-26).
"""

import uuid
from collections.abc import Collection, Sequence
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import (
    ColumnElement,
    and_,
    exists,
    func,
    join,
    literal,
    or_,
    select,
    true,
    update,
)
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    BoardCategory,
    BoardPost,
    BoardPostAudience,
    BoardPostHostel,
    BoardPostSeen,
    CampusSettings,
    DayRule,
    Hostel,
    User,
    UserRole,
)
from app.push import count_board_phones
from app.schemas import (
    BoardHostel,
    BoardPostIn,
    BoardPostOut,
    BoardTargets,
    StaffBoardPostOut,
)
from app.services import admin as audit_svc
from app.services import rules
from app.services.staff import Staff

POSTERS = frozenset({UserRole.WARDEN, UserRole.HEAD_WARDEN, UserRole.ADMIN})
STUDENT_LIMIT = 30  # GET /board
STAFF_LIMIT = 50  # GET /admin/board
SEEN_FLOOR = 5  # seen counts: steps of this many, shown with this many who did and didn't open it
DEFAULT_DAYS = {BoardCategory.TIMINGS: 30}  # else OTHER_DAYS
OTHER_DAYS = 7
ROLE_LABELS = {
    UserRole.STUDENT: "Student",
    UserRole.WARDEN: "Warden",
    UserRole.HEAD_WARDEN: "Head warden",
    UserRole.ADMIN: "Admin",
    UserRole.DEVELOPER: "Developer",
}

NOT_A_POSTER = "Only the hostel office posts to the hostel board"
ALL_HOSTELS_ONLY = "Only head wardens and admins post to all hostels"
NO_HOSTELS = "You don't look after a hostel yet. Ask an admin to assign one."
WITHDRAW_REFUSED = "Only the person who posted it, a head warden or an admin can take it down"


class Refused(Exception):
    """Not allowed for this person (403); `message` is written for them."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFound(Exception):
    """Unknown, or outside this office's hostels: the same answer for both (404)."""


def can_post(user: User) -> bool:
    return user.role in POSTERS


# ---------- who a post is for ----------


async def resolve_targets(
    session: AsyncSession, staff: Staff, targets: BoardTargets
) -> list[Hostel] | None:
    """The hostels named, by name; None for all hostels. The same checks for posting, the
    reach preview and the draft: all hostels is for every-hostel staff only; a warden without
    hostels is told why; an unknown hostel and another office's hostel are both a 404."""
    if targets.all_hostels:
        if not staff.every_hostel:
            raise Refused(ALL_HOSTELS_ONLY)
        return None
    if staff.hostels is not None and not staff.hostels:
        raise Refused(NO_HOSTELS)
    hostels = list(
        await session.scalars(
            select(Hostel).where(Hostel.id.in_(targets.hostel_ids)).order_by(Hostel.name)
        )
    )
    if len(hostels) != len(targets.hostel_ids) or not all(
        staff.covers_hostel(h.id) for h in hostels
    ):
        raise NotFound
    return hostels


def _ids(hostels: Sequence[Hostel] | None) -> list[uuid.UUID] | None:
    return None if hostels is None else [h.id for h in hostels]


def audience(hostel_ids: Collection[uuid.UUID] | None) -> list[ColumnElement[bool]]:
    """Students a post is for: account on and set up (an invited student who never signed in
    can't read it), in `hostel_ids` (None: every student, those without a hostel too)."""
    where = [
        User.role == UserRole.STUDENT,
        User.deactivated_at.is_(None),
        User.email_verified_at.is_not(None),
    ]
    if hostel_ids is not None:
        where.append(User.hostel_id.in_(list(hostel_ids)))
    return where


async def reach(session: AsyncSession, hostels: Sequence[Hostel] | None) -> tuple[int, int]:
    """(students, phones) a post to these hostels would reach now."""
    ids = _ids(hostels)
    students = await session.scalar(select(func.count()).select_from(User).where(*audience(ids)))
    return students or 0, await count_board_phones(session, ids)


# ---------- reading ----------


def active() -> ColumnElement[bool]:
    return and_(BoardPost.withdrawn_at.is_(None), BoardPost.expires_at > func.now())


def _targets_hostel(hostel_ids: Collection[uuid.UUID] | Any) -> ColumnElement[bool]:
    """The post has a target among `hostel_ids`: a set of ids, or a column (User.hostel_id)."""
    match = (
        BoardPostHostel.hostel_id.in_(list(hostel_ids))
        if isinstance(hostel_ids, set | frozenset | list | tuple)
        else BoardPostHostel.hostel_id == hostel_ids
    )
    return exists().where(BoardPostHostel.post_id == BoardPost.id, match)


def for_student(user: User) -> ColumnElement[bool]:
    """Posts a student reads: all-hostels posts, and those for their current hostel."""
    if user.hostel_id is None:
        return BoardPost.all_hostels.is_(True)
    return or_(BoardPost.all_hostels.is_(True), _targets_hostel({user.hostel_id}))


def in_scope(staff: Staff) -> ColumnElement[bool]:
    """Posts on the office's list. A post whose every hostel was deleted has no targets left:
    every-hostel staff only, never vacuously a warden's."""
    if staff.hostels is None:
        return true()
    if not staff.hostels:
        return BoardPost.all_hostels.is_(True)
    return or_(BoardPost.all_hostels.is_(True), _targets_hostel(staff.hostels))


async def _hostels_of(session: AsyncSession, post_ids: list[int]) -> dict[int, list[Hostel]]:
    rows = await session.execute(
        select(BoardPostHostel.post_id, Hostel)
        .join(Hostel, Hostel.id == BoardPostHostel.hostel_id)
        .where(BoardPostHostel.post_id.in_(post_ids))
        .order_by(Hostel.name)
    )
    found: dict[int, list[Hostel]] = {}
    for post_id, hostel in rows.all():
        found.setdefault(post_id, []).append(hostel)
    return found


def from_label(post: BoardPost, hostels: list[Hostel]) -> str:
    """Who it is from, as students read it: the office, never a name."""
    if post.all_hostels:
        return "Campus office"
    if len(hostels) == 1:
        return f"Hostel office, {hostels[0].name}"
    return "Hostel office"


async def student_board(session: AsyncSession, user: User) -> list[BoardPostOut]:
    """The student's active posts, newest first. Anyone else (staff, and a developer viewing
    as a student: the request still runs as the developer) reads an empty board."""
    if user.role != UserRole.STUDENT:
        return []
    seen = exists().where(BoardPostSeen.post_id == BoardPost.id, BoardPostSeen.user_id == user.id)
    rows = (
        await session.execute(
            select(BoardPost, seen.label("seen"))
            .where(active(), for_student(user))
            .order_by(BoardPost.created_at.desc(), BoardPost.id.desc())
            .limit(STUDENT_LIMIT)
        )
    ).all()
    hostels = await _hostels_of(session, [p.id for p, _ in rows])
    return [
        BoardPostOut(
            id=p.id,
            category=p.category.value,
            title=p.title,
            body=p.body,
            from_label=from_label(p, hostels.get(p.id, [])),
            created_at=p.created_at,
            expires_at=p.expires_at,
            seen=bool(was_seen),
        )
        for p, was_seen in rows
    ]


async def mark_seen(session: AsyncSession, user: User, ids: list[int]) -> None:
    """Records that the student had these posts on screen. Only posts they can read now
    count; anything else is ignored without a word. Idempotent. Not for other roles."""
    if user.role != UserRole.STUDENT:
        return
    visible = list(
        await session.scalars(
            select(BoardPost.id).where(BoardPost.id.in_(set(ids)), active(), for_student(user))
        )
    )
    if visible:
        await session.execute(
            insert(BoardPostSeen)
            .values([{"post_id": i, "user_id": user.id} for i in visible])
            .on_conflict_do_nothing()
        )
    await session.commit()


def seen_band(students: int, seen: int) -> int | None:
    """What the office is shown for a post sent to `students` that `seen` of them opened: the
    count rounded down to a step of SEEN_FLOOR ("5 to 9"), or None while fewer than
    SEEN_FLOOR opened it or fewer than SEEN_FLOOR haven't. One student opening it then never
    changes what shows on its own, so comparing two overlapping posts can't single them out."""
    if seen < SEEN_FLOOR or students - seen < SEEN_FLOOR:
        return None
    return seen - seen % SEEN_FLOOR


async def _seen_counts(session: AsyncSession, post_ids: list[int]) -> dict[int, int]:
    """How many of the students each post was for when sent have opened it (exact: the
    caller bands it). One grouped query over the audience kept at sending."""
    if not post_ids:
        return {}
    rows = await session.execute(
        select(BoardPostAudience.post_id, func.count(BoardPostSeen.user_id))
        .select_from(
            join(
                BoardPostAudience,
                BoardPostSeen,
                and_(
                    BoardPostSeen.post_id == BoardPostAudience.post_id,
                    BoardPostSeen.user_id == BoardPostAudience.user_id,
                ),
            )
        )
        .where(BoardPostAudience.post_id.in_(post_ids))
        .group_by(BoardPostAudience.post_id)
    )
    return {post_id: count for post_id, count in rows.all()}


def may_withdraw(staff: Staff, post: BoardPost) -> bool:
    """The author, or every-hostel staff; never a developer."""
    return can_post(staff.user) and (post.author_id == staff.user.id or staff.every_hostel)


def _status(post: BoardPost, now: datetime) -> str:
    if post.withdrawn_at is not None:
        return "withdrawn"
    return "active" if post.expires_at > now else "ended"


async def staff_board(session: AsyncSession, staff: Staff) -> list[StaffBoardPostOut]:
    """The office's list, newest first: what each post said, who it was for and from, and
    roughly how many of the students it was for opened it (seen_band)."""
    now = await session.scalar(select(func.now()))
    posts = list(
        await session.scalars(
            select(BoardPost)
            .where(in_scope(staff))
            .order_by(BoardPost.created_at.desc(), BoardPost.id.desc())
            .limit(STAFF_LIMIT)
        )
    )
    hostels = await _hostels_of(session, [p.id for p in posts])
    seen = await _seen_counts(session, [p.id for p in posts if p.students >= 2 * SEEN_FLOOR])
    listed = []
    for p in posts:
        status = _status(p, now)
        targets = hostels.get(p.id, [])
        listed.append(
            StaffBoardPostOut(
                id=p.id,
                category=p.category.value,
                title=p.title,
                body=p.body,
                from_label=from_label(p, targets),
                created_at=p.created_at,
                expires_at=p.expires_at,
                status=status,
                all_hostels=p.all_hostels,
                hostels=[BoardHostel(id=h.id, name=h.name) for h in targets],
                author="You" if p.author_id == staff.user.id else ROLE_LABELS[p.author_role],
                students=p.students,
                seen=seen_band(p.students, seen.get(p.id, 0)),
                can_withdraw=status == "active" and may_withdraw(staff, p),
            )
        )
    return listed


# ---------- writing ----------


def _where(hostels: Sequence[Hostel] | None) -> str:
    return "all hostels" if hostels is None else ", ".join(h.name for h in hostels)


async def _withdraw_now(
    session: AsyncSession, staff: Staff, where: ColumnElement[bool]
) -> list[tuple[int, BoardCategory]]:
    """Takes down the active posts matching `where`, each with its audit row (the caller
    commits). Atomic: a post another request just took down is skipped, not logged twice."""
    rows = (
        await session.execute(
            update(BoardPost)
            .where(where, active())
            .values(withdrawn_at=func.now(), withdrawn_by=staff.user.id)
            .returning(BoardPost.id, BoardPost.category)
            .execution_options(synchronize_session=False)
        )
    ).all()
    for post_id, category in rows:
        audit_svc.audit(session, staff.user, "notice:withdraw", f"post {post_id}, {category}")
    return [(post_id, category) for post_id, category in rows]


async def create(
    session: AsyncSession, staff: Staff, body: BoardPostIn, hostels: list[Hostel] | None
) -> tuple[int, int, int]:
    """Saves a post, its hostels and its audit row, and with `replace_timings` takes down the
    older timings posts it covers that the sender may withdraw (the caller commits). The
    audit row names the post, its category, how many students and where: never its title or
    text, which go to every student and are deleted with the post (the log is kept a year).
    Returns (post id, students, phones)."""
    category = BoardCategory(body.category)
    days = body.expires_in_days or DEFAULT_DAYS.get(category, OTHER_DAYS)
    students, devices = await reach(session, hostels)
    post_id = await session.scalar(
        insert(BoardPost)
        .values(
            author_id=staff.user.id,
            author_role=staff.user.role,
            category=category,
            title=body.title,
            body=body.body,
            all_hostels=hostels is None,
            students=students,
            devices=devices,
            # One clock: ends exactly `days` after it was created.
            created_at=func.now(),
            expires_at=func.now() + timedelta(days=days),
        )
        .returning(BoardPost.id)
    )
    if hostels:
        await session.execute(
            insert(BoardPostHostel).values(
                [{"post_id": post_id, "hostel_id": h.id} for h in hostels]
            )
        )
    # The audience as sent, the group seen counts are over. `students` is its size, so a
    # student set up between the count above and now can't make the two disagree.
    kept = len(
        (
            await session.execute(
                insert(BoardPostAudience)
                .from_select(
                    ["post_id", "user_id"],
                    select(literal(post_id), User.id).where(*audience(_ids(hostels))),
                )
                .returning(BoardPostAudience.user_id)
            )
        ).all()
    )
    if kept != students:
        students = kept
        await session.execute(
            update(BoardPost).where(BoardPost.id == post_id).values(students=students)
        )
    audit_svc.audit(
        session,
        staff.user,
        "notice:post",
        f"post {post_id}, {category}, {students} students, {_where(hostels)}",
    )
    if body.replace_timings and category == BoardCategory.TIMINGS:
        older = and_(BoardPost.id != post_id, BoardPost.category == BoardCategory.TIMINGS)
        if not staff.every_hostel:
            older = and_(older, BoardPost.author_id == staff.user.id)
        if hostels is not None:  # only posts whose every hostel the new one covers
            outside = exists().where(
                BoardPostHostel.post_id == BoardPost.id,
                BoardPostHostel.hostel_id.not_in([h.id for h in hostels]),
            )
            older = and_(older, BoardPost.all_hostels.is_(False), ~outside)
        await _withdraw_now(session, staff, older)
    return post_id, students, devices


async def withdraw(session: AsyncSession, staff: Staff, post_id: int) -> None:
    """Takes a post down (idempotent: an ended or withdrawn post stays as it is). Scope first,
    then permission: another office's post is a 404 for everyone, even a developer."""
    post = await session.scalar(select(BoardPost).where(BoardPost.id == post_id, in_scope(staff)))
    if post is None:
        raise NotFound
    if not can_post(staff.user):
        raise Refused(NOT_A_POSTER)
    if not may_withdraw(staff, post):
        raise Refused(WITHDRAW_REFUSED)
    await _withdraw_now(session, staff, BoardPost.id == post_id)
    await session.commit()


# ---------- the draft from the outing rules ----------


async def _rules_by_set(
    session: AsyncSession, set_ids: Collection[uuid.UUID]
) -> dict[uuid.UUID, list[DayRule]]:
    found: dict[uuid.UUID, list[DayRule]] = {}
    if set_ids:
        for rule in await session.scalars(
            select(DayRule).where(DayRule.rule_set_id.in_(list(set_ids)))
        ):
            found.setdefault(rule.rule_set_id, []).append(rule)
    return found


async def draft_blocks(session: AsyncSession, hostels: list[Hostel] | None) -> list[rules.Block]:
    """The rules these hostels follow, one block per rule set headed by its hostels' names.
    For all hostels, the campus default's block too ("Students without a hostel") when no
    hostel follows it, since those students get the post as well."""
    every = hostels is None
    if hostels is None:
        hostels = list(await session.scalars(select(Hostel).order_by(Hostel.name)))
    names: dict[uuid.UUID, list[str]] = {}
    for h in sorted(hostels, key=lambda h: h.name):
        names.setdefault(h.rule_set_id, []).append(h.name)
    default = None
    if every:
        settings = await session.get(CampusSettings, 1)
        default = settings.default_rule_set_id if settings else None
        if default in names:
            default = None
    by_set = await _rules_by_set(session, [*names, *([default] if default else [])])
    blocks = sorted(
        ((", ".join(n), by_set.get(s, [])) for s, n in names.items()), key=lambda b: b[0]
    )
    if default is not None:
        blocks.append((rules.NO_HOSTEL, by_set.get(default, [])))
    return blocks


def today() -> date:
    return rules.ist_date(datetime.now(UTC))
