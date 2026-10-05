"""Contacts: people I allow to be chosen as viewers of my location.

Only the owner creates a contact (by email). The invitee accepts or declines. Either side can
remove it at any time, which also revokes any live access it granted.
"""

import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, HTTPException, Response, status
from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import aliased

from app.api.deps import CurrentUser, HubDep, LimiterDep, SessionDep, SettingsDep, enforce
from app.models import Contact, ContactStatus, User
from app.realtime import AccessChanged
from app.schemas import ContactInviteIn, ContactsOut, IncomingContact, OutgoingContact, Person
from app.security.rate_limit import Limit
from app.services.verification import email_allowed
from app.services.viewers import revoke_user_from_sharer

router = APIRouter(prefix="/contacts", tags=["contacts"])

INVITES_PER_USER = Limit(max_hits=20, window_seconds=3600)
NOT_FOUND = HTTPException(status.HTTP_404_NOT_FOUND, detail="Contact not found")


def _outgoing(contact: Contact, person: User | None) -> OutgoingContact:
    return OutgoingContact(
        id=contact.id,
        email=contact.contact_email,
        status=contact.status,
        person=Person.model_validate(person) if person else None,
        created_at=contact.created_at,
        accepted_at=contact.accepted_at,
    )


@router.post("", status_code=status.HTTP_202_ACCEPTED)
async def invite(
    body: ContactInviteIn,
    me: CurrentUser,
    session: SessionDep,
    settings: SettingsDep,
    limiter: LimiterDep,
) -> OutgoingContact:
    """Invite an email. The response is the same whether or not that account exists."""
    enforce(limiter, "contacts:invite", str(me.id), INVITES_PER_USER)
    email = body.email.lower()
    if not email_allowed(email, settings):
        domains = ", ".join(f"@{d}" for d in settings.allowed_email_domains)
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT, detail=f"Contacts must use {domains} addresses"
        )
    if email == me.email:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, detail="You cannot add yourself")

    await session.execute(
        insert(Contact)
        .values(owner_id=me.id, contact_email=email)
        .on_conflict_do_nothing(index_elements=["owner_id", "contact_email"])
    )
    await session.commit()

    person = aliased(User)
    contact, accepted_person = (
        await session.execute(
            select(Contact, person)
            .outerjoin(person, person.id == Contact.contact_user_id)
            .where(Contact.owner_id == me.id, Contact.contact_email == email)
        )
    ).one()
    return _outgoing(contact, accepted_person)


@router.get("")
async def list_contacts(me: CurrentUser, session: SessionDep) -> ContactsOut:
    person = aliased(User)
    outgoing = await session.execute(
        select(Contact, person)
        .outerjoin(person, person.id == Contact.contact_user_id)
        .where(Contact.owner_id == me.id)
        .order_by(Contact.created_at.desc())
    )
    owner = aliased(User)
    incoming = await session.execute(
        select(Contact, owner)
        .join(owner, owner.id == Contact.owner_id)
        .where(
            or_(
                Contact.contact_user_id == me.id,
                and_(Contact.contact_email == me.email, Contact.contact_user_id.is_(None)),
            )
        )
        .order_by(Contact.created_at.desc())
    )
    return ContactsOut(
        outgoing=[_outgoing(c, p) for c, p in outgoing],
        incoming=[
            IncomingContact(
                id=c.id,
                owner=Person.model_validate(o),
                status=c.status,
                created_at=c.created_at,
                accepted_at=c.accepted_at,
            )
            for c, o in incoming
        ],
    )


@router.post("/{contact_id}/accept")
async def accept(contact_id: uuid.UUID, me: CurrentUser, session: SessionDep) -> IncomingContact:
    accepted = (
        await session.execute(
            update(Contact)
            .where(
                Contact.id == contact_id,
                Contact.status == ContactStatus.PENDING,
                Contact.contact_email == me.email,
                Contact.owner_id != me.id,
            )
            .values(
                contact_user_id=me.id,
                status=ContactStatus.ACCEPTED,
                accepted_at=datetime.now(UTC),
            )
            .returning(Contact)
        )
    ).scalar_one_or_none()
    if accepted is None:
        raise NOT_FOUND
    owner = await session.get(User, accepted.owner_id)
    await session.commit()
    return IncomingContact(
        id=accepted.id,
        owner=Person.model_validate(owner),
        status=accepted.status,
        created_at=accepted.created_at,
        accepted_at=accepted.accepted_at,
    )


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove(
    contact_id: uuid.UUID, me: CurrentUser, session: SessionDep, hub: HubDep
) -> Response:
    """Owner removes a contact, or the invitee declines / leaves. Revokes live access."""
    removed = (
        await session.execute(
            delete(Contact)
            .where(
                Contact.id == contact_id,
                or_(
                    Contact.owner_id == me.id,
                    Contact.contact_user_id == me.id,
                    and_(Contact.contact_email == me.email, Contact.contact_user_id.is_(None)),
                ),
            )
            .returning(Contact.owner_id, Contact.contact_user_id)
        )
    ).first()
    if removed is None:
        raise NOT_FOUND
    affected: list[uuid.UUID] = []
    if removed.contact_user_id is not None:
        affected = await revoke_user_from_sharer(session, removed.owner_id, removed.contact_user_id)
    await session.commit()
    for session_id in affected:
        await hub.publish(AccessChanged(session_id))
    return Response(status_code=status.HTTP_204_NO_CONTENT)
