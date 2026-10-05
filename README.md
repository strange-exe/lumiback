# Outing

Campus outing log with consent-based location sharing for Graphic Era University students.

- **Backend:** FastAPI, PostgreSQL (Supabase), WebSockets
- **Web:** Next.js *(planned)*
- **Mobile:** React Native + Expo *(planned)*

## Principles

Location sharing is always visible to the sharer, revocable in one tap, time-limited by default,
and enabled only by the student. There is no covert mode.

| Safeguard | How the backend enforces it |
|---|---|
| Two-sided consent | Viewers are the sharer's accepted contacts, or code holders the sharer approves |
| One-tap stop | Ends the session, deletes the location, and closes viewer streams immediately |
| Time-limited | Every session has `ends_at`; access is checked against it on every read and send |
| Data minimization | Only the latest location is stored, and it is deleted when the session ends |
| Transparency | Every viewer read is recorded in an access log visible only to the sharer |
| Codes | Single-use, ~10 minutes, ~50 bits, stored as HMAC, attempts rate-limited |
| Real students | Only verified `@geu.ac.in` addresses can register or be added as contacts |

## API overview

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register` `POST /auth/verify-email` `POST /auth/resend-verification` `POST /auth/login` `POST /auth/refresh` `POST /auth/logout` `GET /auth/me` |
| Contacts | `POST /contacts` `GET /contacts` `POST /contacts/{id}/accept` `DELETE /contacts/{id}` |
| Sessions | `POST /sessions` `GET /sessions/mine` `GET /sessions/watching` `GET /sessions/{id}` `POST /sessions/{id}/stop` |
| Viewers | `POST /sessions/{id}/codes` `POST /codes/redeem` `POST /sessions/{id}/viewers/{vid}/approve` `POST /sessions/{id}/viewers/{vid}/revoke` |
| Location | `PUT /sessions/{id}/location` `GET /sessions/{id}/location` `GET /sessions/{id}/access-log` |
| Live | `WS /ws`: authenticate in the first message, then subscribe to session ids |

Access tokens last 15 minutes; refresh tokens rotate on every use. Guests send their token in the
`X-Guest-Token` header. Interactive docs are served at `/docs` when `APP_ENV=development`.

## Backend setup

```bash
cd backend
cp .env.example .env              # fill in values; the server refuses to start if any are missing or weak
uv sync
uv run pytest                     # needs TEST_DATABASE_URL: a local Postgres database ending in _test
uv run alembic upgrade head       # apply migrations to DATABASE_URL
uv run uvicorn --factory app.main:create_app --reload --loop asyncio:SelectorEventLoop
```

`--loop asyncio:SelectorEventLoop` is required on Windows (psycopg's async driver does not support
the default Proactor loop). It is harmless elsewhere.
