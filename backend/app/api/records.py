"""A student's record for the hostel office (services/records.py): read-only, for staff who
look after the student (a warden: their hostels' students only; anyone else's is a 404)."""

import uuid
from typing import Annotated

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import AwareDatetime

from app.api.admin_rules import _listing, _request_out
from app.api.deps import SessionDep, StaffUser
from app.models import User
from app.schemas import AdminScanPage, RecordOutingPage, RecordRequestPage, StudentRecordOut
from app.services import admin as office
from app.services import records

router = APIRouter(prefix="/admin/students", tags=["admin"])

Limit = Annotated[int, Query(ge=1, le=50)]
# A row id cursor: kept inside BIGINT, so a huge value is a 422, not a database error (500).
RowId = Annotated[int | None, Query(ge=1, le=2**63 - 1)]


async def _student(session: SessionDep, staff: StaffUser, student_id: uuid.UUID) -> User:
    try:
        return await records.student_in_scope(session, staff, student_id)
    except records.NotFound:
        raise HTTPException(status.HTTP_404_NOT_FOUND, detail="No such student") from None


@router.get("/{student_id}")
async def record(student_id: uuid.UUID, staff: StaffUser, session: SessionDep) -> StudentRecordOut:
    """Who they are, their contacts and status now, and their record in numbers."""
    student = await _student(session, staff, student_id)
    return await records.header(session, staff, student)


@router.get("/{student_id}/outings")
async def record_outings(
    student_id: uuid.UUID,
    staff: StaffUser,
    session: SessionDep,
    before: AwareDatetime | None = None,
    limit: Limit = 20,
) -> RecordOutingPage:
    """Their outings in the viewer's hostels, newest first, each with its corrections and late
    follow-up. `before`: the previous page's `next_before`."""
    student = await _student(session, staff, student_id)
    return await records.outings(session, staff, student, before=before, limit=limit)


@router.get("/{student_id}/requests")
async def record_requests(
    student_id: uuid.UUID,
    staff: StaffUser,
    session: SessionDep,
    before: AwareDatetime | None = None,
    limit: Limit = 20,
) -> RecordRequestPage:
    """Their weekend and holiday requests, newest first."""
    student = await _student(session, staff, student_id)
    page, next_before = await records.requests(session, student, before=before, limit=limit)
    listing = await _listing(session, [(r, student) for r in page])
    return RecordRequestPage(
        items=[await _request_out(session, r, student, listing) for r in page],
        next_before=next_before,
    )


@router.get("/{student_id}/scans")
async def record_scans(
    student_id: uuid.UUID,
    staff: StaffUser,
    session: SessionDep,
    before: RowId = None,
    limit: Limit = 20,
) -> AdminScanPage:
    """Their gate scans, refused ones too, newest first."""
    student = await _student(session, staff, student_id)
    return await office.scans(
        session,
        staff,
        before=before,
        limit=limit,
        gate_id=None,
        result=None,
        student_id=student.id,
    )
