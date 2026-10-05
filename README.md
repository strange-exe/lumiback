# Outing

Campus outing log with consent-based location sharing for Graphic Era University students.

- **Backend:** FastAPI, PostgreSQL (Supabase), WebSockets
- **Web:** Next.js *(planned)*
- **Mobile:** React Native + Expo *(planned)*

## Principles

Location sharing is always visible to the sharer, revocable in one tap, time-limited by default,
and enabled only by the student. There is no covert mode.

## Backend setup

```bash
cd backend
cp .env.example .env   # fill in values; the server refuses to start if any are missing or weak
uv sync
uv run pytest
uv run uvicorn --factory app.main:create_app --reload
```
