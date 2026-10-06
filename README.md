# Lumiback

Campus outing log with consent-based location sharing for Graphic Era University students.

- **Backend:** FastAPI, PostgreSQL (Supabase), WebSockets
- **Web:** Next.js 16, Tailwind CSS v4 (see `apps/web/README.md`)
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
| Outings | `POST /outings` `GET /outings/current` `PATCH /outings/current` `POST /outings/current/return` `GET /outings` `GET /outings/summary` |
| Live | `WS /ws`: authenticate in the first message, then subscribe to session ids |

Access tokens last 15 minutes; refresh tokens rotate on every use. Guests send their token in the
`X-Guest-Token` header. Outing times are returned in IST (`+05:30`); outing status (out, overdue,
returned) is computed when read. Interactive docs are served at `/docs` when `APP_ENV=development`.

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

## Web setup

```bash
cd apps/web
cp .env.example .env.local        # BACKEND_URL of the API
npm install
npm run dev
npm run test:e2e                  # Playwright against the API on the local test database
```

## Deploying (Render + Cloudflare)

`render.yaml` describes two free Render web services: `lumiback-api` (FastAPI) and
`lumiback-web` (Next.js). Cloudflare serves `lumiback.abhinesh.codes` in front of the web app. The
browser only ever talks to the web app; the web app talks to the API server-side.

1. **Render:** New → Blueprint → this repository. When asked, fill in `DATABASE_URL` (Supabase
   session pooler), `SMTP_PASSWORD` (Resend key) and, for the web app, `BACKEND_URL` (the API's
   `https://…onrender.com` address; set it after the API's first deploy if needed) and
   `EDGE_SECRET` (generate one: `python -c "import secrets; print(secrets.token_urlsafe(32))"`).
   Put both services in the same region as the Supabase database.
2. **Custom domain:** in `lumiback-web` → Settings → Custom Domains, add
   `lumiback.abhinesh.codes`. In Cloudflare DNS, add `CNAME lumiback → <web>.onrender.com`
   as **DNS only** (grey cloud) until Render shows the domain as verified, then switch it to
   **Proxied**. Set SSL/TLS mode to **Full (strict)**.
3. **Edge secret:** Cloudflare → Rules → Transform Rules → Modify Request Header, for hostname
   `lumiback.abhinesh.codes`: set static header `X-Edge-Auth` to the same `EDGE_SECRET`.
   Without it the web app ignores `CF-Connecting-IP` (anyone could forge it on the onrender.com
   address), and rate limits fall back to the web server's address.
4. **Check:** `https://<api>.onrender.com/health` returns `{"status":"ok"}` (it queries the
   database), sign-up emails arrive, and a live share works between two browsers.

**Free-tier limits.** Free services sleep after 15 minutes without traffic and take about a minute
to wake. The 750 free instance hours per month are shared by both services, so keeping either one
awake around the clock leaves almost nothing for the other. If you use a pinger, schedule it for
peak hours only (e.g. 16:00–23:00 IST, about 430 hours a month for both), and hit the API's
`/health` at least once a day so the Supabase project never counts as inactive.

Each service must run as a single instance: live updates and token-refresh de-duplication are
in-process. Moving off the free plan or to another host needs no code changes.
