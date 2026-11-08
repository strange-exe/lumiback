"""Followers (wave 3 #15; owner: "not specifically parents, just people who were shared
location with or emergency contact"): the signed-up people a student shares their location
with on a live share. They see the student's due-back time on the watch page, and are told
(a push on the "Sharing and requests" channel, which they can mute; an email if they don't
use the app) when the student who is out:
- says they're running late (the new time),
- is 30 min late (the moment of the student's own "are you OK?" alert),
- is back (tapped in, or "I'm back"), or
- has a share with them end on its own while still out (time ran out, or the tab or phone
  stopped reporting): "sharing timed out", with no due time (owner, 2026-11-09).
A share the student stops themselves is told to nobody: it's their choice, often to cut
someone off (owner, 2026-11-09).

Everything is queued in the caller's transaction (services/outbox.py). Each alert is checked
again when sent: a follower cut off by then (revoked, share stopped or ended, account off)
gets nothing. The "timed out" notice is about a share that has just ended, so it is checked
against that share's viewer row instead (still granted, not revoked).

The safe-return contact has their own emails for "late" and "back" (services/safe_return.py):
a follower whose address is that contact's isn't told those twice. Code guests have no
account, so nothing reaches them but the watch page itself.
"""

import uuid
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.email_templates import follower_email
from app.models import (
    OutboxMode,
    Outing,
    SessionStatus,
    ShareSession,
    ShareViewer,
    User,
    ViewerStatus,
)
from app.push import PushMessage
from app.services import outbox
from app.services.rules import IST

FOLLOW_URL = "/live?view=follow"  # the app's follow view
CHANNEL = "share-status"  # the app's "Sharing and requests" switch


def hhmm(moment: datetime) -> str:
    t = moment.astimezone(IST)
    return f"{t.hour % 12 or 12}:{t.minute:02d} {'AM' if t.hour < 12 else 'PM'}"


async def followers(
    session: AsyncSession,
    student: User,
    now: datetime,
    *,
    except_share: uuid.UUID | None = None,
) -> list[User]:
    """The people the student shares their location with right now: signed-up viewers they
    granted on a live share (code guests have no account to tell). `except_share`: not
    counting that share."""
    query = (
        select(User)
        .join(ShareViewer, ShareViewer.viewer_user_id == User.id)
        .join(ShareSession, ShareSession.id == ShareViewer.session_id)
        .where(
            ShareSession.sharer_id == student.id,
            ShareSession.status == SessionStatus.ACTIVE,
            ShareSession.ends_at > now,
            ShareViewer.status == ViewerStatus.GRANTED,
            User.id != student.id,
            User.deactivated_at.is_(None),
            User.email_verified_at.is_not(None),
        )
        .distinct()
    )
    if except_share is not None:
        query = query.where(ShareSession.id != except_share)
    return list(await session.scalars(query))


async def _tell(
    session: AsyncSession,
    student: User,
    people: list[User],
    *,
    key: str,
    kind: str,
    title: str,
    body: str,
    paragraph: str,
    web_url: str,
    viewer_of: uuid.UUID | None = None,
) -> list[int]:
    ids = []
    for person in people:
        found = await outbox.enqueue(
            session,
            key=f"{key}:{person.id}",
            kind=kind,
            mode=OutboxMode.PUSH_OR_EMAIL,
            user_id=person.id,
            push=PushMessage(title=title, body=body, url=FOLLOW_URL, channel=CHANNEL),
            email=follower_email(
                to=person.email,
                student=student.name,
                heading=title,
                paragraph=paragraph,
                web_url=web_url,
            ),
            follows=None if viewer_of is not None else student.id,
            viewer_of=viewer_of,
        )
        if found is not None:
            ids.append(found)
    return ids


def _not_the_contact(people: list[User], outing: Outing) -> list[User]:
    """Without the safe-return contact, who gets that outing's late and back emails."""
    contact = (outing.safe_return_email or "").lower()
    return [p for p in people if not contact or p.email.lower() != contact]


async def running_late(
    session: AsyncSession, student: User, outing: Outing, now: datetime, web_url: str
) -> list[int]:
    assert outing.original_return_at is not None
    new, was = hhmm(outing.expected_return_at), hhmm(outing.original_return_at)
    return await _tell(
        session,
        student,
        await followers(session, student, now),
        key=f"follower-running-late:{outing.id}",
        kind="follower_running_late",
        title=f"{student.name} will be back later",
        body=f"Now due back at {new} (was {was}). They told the hostel office.",
        paragraph=(
            f"{student.name} told the hostel office they're running late. They're now due "
            f"back at {new} IST instead of {was} IST."
        ),
        web_url=web_url,
    )


async def late(
    session: AsyncSession, student: User, outing: Outing, now: datetime, web_url: str
) -> list[int]:
    """At the student's own late alert (30 min past the due time)."""
    due = hhmm(outing.expected_return_at)
    return await _tell(
        session,
        student,
        _not_the_contact(await followers(session, student, now), outing),
        key=f"follower-late:{outing.id}",
        kind="follower_late",
        title=f"{student.name} isn't back yet",
        body=f"They were due back at {due}. Lumiback has asked them if they're OK.",
        paragraph=(
            f"{student.name} was due back at the hostel by {due} IST and hasn't checked in "
            "yet. Lumiback has asked them if they're OK. If they don't answer, the hostel "
            "office follows up."
        ),
        web_url=web_url,
    )


async def back(
    session: AsyncSession,
    student: User,
    outing: Outing,
    now: datetime,
    web_url: str,
    *,
    contact: str | None,
) -> list[int]:
    """`contact`: the outing's safe-return address before the return forgot it."""
    assert outing.returned_at is not None
    at = hhmm(outing.returned_at)
    people = [
        p
        for p in await followers(session, student, now)
        if p.email.lower() != (contact or "").lower()
    ]
    return await _tell(
        session,
        student,
        people,
        key=f"follower-back:{outing.id}",
        kind="follower_back",
        title=f"{student.name} is back",
        body=f"Back at the hostel at {at}.",
        paragraph=f"{student.name} checked back in at the hostel at {at} IST.",
        web_url=web_url,
    )


async def timed_out(
    session: AsyncSession, student: User, share_id: uuid.UUID, now: datetime, web_url: str
) -> list[int]:
    """This share ended on its own (its time ran out, or the tab or phone stopped reporting)
    while the student is out (owner, 2026-11-09): its granted viewers who won't still follow
    them through another live share are told it timed out, and nothing more: not that the
    student is out, nor when they're due (owner: "Timed out only"). A share the student stops
    themselves is told to nobody. The sweep ends the share and commits; the row is checked at
    send time against this share's viewer row."""
    viewers = list(
        await session.scalars(
            select(User)
            .join(ShareViewer, ShareViewer.viewer_user_id == User.id)
            .where(
                ShareViewer.session_id == share_id,
                ShareViewer.status == ViewerStatus.GRANTED,
                User.id != student.id,
                User.deactivated_at.is_(None),
                User.email_verified_at.is_not(None),
            )
        )
    )
    still = {u.id for u in await followers(session, student, now, except_share=share_id)}
    return await _tell(
        session,
        student,
        [u for u in viewers if u.id not in still],
        key=f"follower-timed-out:{share_id}",
        kind="follower_timed_out",
        title=f"{student.name}'s location sharing timed out",
        body="You can't see their location until they share it again.",
        paragraph=(
            f"{student.name}'s location sharing with you timed out: its time ran out, or their "
            "phone stopped sending its location. You can't see their location until they share "
            "it again."
        ),
        web_url=web_url,
        viewer_of=share_id,
    )
