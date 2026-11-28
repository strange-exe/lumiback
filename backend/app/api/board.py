"""The hostel board (services/board.py): students read their hostel's posts; the hostel
office posts, lists and withdraws them, previews who a post reaches, and drafts one from the
outing rules.

A post is saved first and pushed after the response, to phones whose app has the "Hostel
board" channel. The board is what students read: a server without push still saves the post,
and a lost push loses nothing. Withdrawing sends nothing (a notification already on a phone
stays there until opened)."""

from datetime import date
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, HTTPException, Path, Query, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import Response
from pydantic import ValidationError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, LimiterDep, SessionDep, StaffUser, enforce
from app.models import Holiday, Hostel
from app.push import BOARD_CHANNEL, DAY, PushMessage, send_board_post
from app.schemas import (
    BoardDraftOut,
    BoardOut,
    BoardPostIn,
    BoardReachOut,
    BoardSeenIn,
    BoardSentOut,
    BoardTargets,
    StaffBoardOut,
)
from app.security.rate_limit import Limit
from app.services import board, rules
from app.services.staff import Staff

router = APIRouter(tags=["board"])

NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, detail="Not found")
POSTS = Limit(max_hits=10, window_seconds=3600)  # per sender
PUSH_BODY = 140  # characters of the post in its notification
BOARD_URL = "/today/board"  # the app's board screen (apps/mobile/src/notify/plan.ts)

PostId = Annotated[int, Path(ge=1, le=2**63 - 1)]  # inside BIGINT: 422, not 500


def _refused(e: board.Refused) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, detail=e.message)


def query_targets(
    hostel_ids: Annotated[list[str] | None, Query()] = None, all_hostels: bool = False
) -> BoardTargets:
    """?hostel_ids=<uuid>&hostel_ids=<uuid> or ?all_hostels=true, checked like a post's."""
    try:
        return BoardTargets(hostel_ids=hostel_ids or [], all_hostels=all_hostels)
    except ValidationError as e:
        raise RequestValidationError(e.errors(include_input=False, include_url=False)) from None


async def _resolve(
    session: AsyncSession, staff: Staff, targets: BoardTargets
) -> list[Hostel] | None:
    try:
        return await board.resolve_targets(session, staff, targets)
    except board.Refused as e:
        raise _refused(e) from None
    except board.NotFound:
        raise NOT_FOUND from None


# ---------- students ----------


@router.get("/board")
async def read_board(me: CurrentUser, session: SessionDep) -> BoardOut:
    """The student's active posts, newest first (at most 30). Anyone else: an empty board."""
    return BoardOut(posts=await board.student_board(session, me))


@router.post("/board/seen", status_code=status.HTTP_204_NO_CONTENT)
async def seen(body: BoardSeenIn, me: CurrentUser, session: SessionDep) -> Response:
    """The posts the student had on screen. Posts they can't read are ignored; other roles'
    calls do nothing. Idempotent."""
    await board.mark_seen(session, me, body.ids)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------- the hostel office ----------


@router.get("/admin/board")
async def office_board(staff: StaffUser, session: SessionDep) -> StaffBoardOut:
    """The posts for this office's hostels and every all-hostels post, newest first (50)."""
    return StaffBoardOut(posts=await board.staff_board(session, staff))


@router.get("/admin/board/reach")
async def board_reach(
    staff: StaffUser,
    session: SessionDep,
    hostel_ids: Annotated[list[str] | None, Query()] = None,
    all_hostels: bool = False,
) -> BoardReachOut:
    """How many students a post would be for, and how many phones it would be pushed to."""
    hostels = await _resolve(session, staff, query_targets(hostel_ids, all_hostels))
    students, devices = await board.reach(session, hostels)
    return BoardReachOut(students=students, devices=devices)


@router.get("/admin/board/draft")
async def board_draft(
    staff: StaffUser,
    session: SessionDep,
    hostel_ids: Annotated[list[str] | None, Query()] = None,
    all_hostels: bool = False,
    holiday: date | None = None,
) -> BoardDraftOut:
    """A timings post drafted from the outing rules these hostels follow (or, with
    `holiday`, that holiday's hours). `too_long`: more than a post may hold."""
    hostels = await _resolve(session, staff, query_targets(hostel_ids, all_hostels))
    blocks = await board.draft_blocks(session, hostels)
    if holiday is not None:
        found = await session.get(Holiday, holiday)
        if found is None:
            raise NOT_FOUND
        draft = rules.holiday_draft(found.name, holiday, blocks)
    else:
        draft = rules.timings_draft(board.today(), blocks)
    return BoardDraftOut(
        title=draft.title, body=draft.body, category="timings", too_long=draft.too_long
    )


@router.post("/admin/board", status_code=status.HTTP_201_CREATED)
async def post_to_board(
    body: BoardPostIn,
    staff: StaffUser,
    session: SessionDep,
    limiter: LimiterDep,
    request: Request,
    tasks: BackgroundTasks,
) -> BoardSentOut:
    """A post for the named hostels' students, or every student. Checked, then rate limited,
    before anything is written; the post, its hostels and the audit row commit together."""
    if not board.can_post(staff.user):
        raise _refused(board.Refused(board.NOT_A_POSTER))
    hostels = await _resolve(session, staff, body)
    await enforce(limiter, "board:user", str(staff.user.id), POSTS)
    post_id, students, devices = await board.create(session, staff, body, hostels)
    await session.commit()
    sender = request.app.state.push
    if sender is not None:
        tasks.add_task(
            send_board_post,
            request.app.state.sessionmaker,
            sender,
            PushMessage(
                title=body.title,
                body=body.body[:PUSH_BODY],
                url=BOARD_URL,
                channel=BOARD_CHANNEL,
                tag=f"board:{post_id}",
                ttl=DAY,
            ),
            None if hostels is None else [h.id for h in hostels],
        )
    return BoardSentOut(id=post_id, students=students, devices=devices)


@router.post("/admin/board/{post_id}/withdraw", status_code=status.HTTP_204_NO_CONTENT)
async def withdraw_post(post_id: PostId, staff: StaffUser, session: SessionDep) -> Response:
    """Takes a post off the board (idempotent; no push). The author, a head warden, an admin or
    a developer; another office's post is a 404."""
    try:
        await board.withdraw(session, staff, post_id)
    except board.NotFound:
        raise NOT_FOUND from None
    except board.Refused as e:
        raise _refused(e) from None
    return Response(status_code=status.HTTP_204_NO_CONTENT)
