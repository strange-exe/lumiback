# Lumiback

Campus outing log with consent-based location sharing for Graphic Era University students.

- **Backend:** FastAPI, PostgreSQL (Supabase), WebSockets
- **Web:** Next.js 16, Tailwind CSS v4 (see `apps/web/README.md`)
- **Mobile:** Android app, Expo SDK 57 + expo-router (`apps/mobile`)

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
| Gates | `POST /gates/scan` (students tap out / in) `GET /kiosk/qr` (gate tablet, `X-Kiosk-Token`) |
| Devices | `POST /devices/push-token` `POST /devices/push-token/remove` |
| Admin | `GET /admin/overview` `GET /admin/outings` `GET /admin/outings.csv` `GET /admin/scans` `GET /admin/gates` `POST /admin/gates` `PATCH /admin/gates/{id}` `POST /admin/gates/{id}/kiosk-token` `GET /admin/settings` `PUT /admin/settings` `GET /admin/users` `POST /admin/users/{id}/role` |

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

## Mobile setup

The Android app shares location through a foreground service with a visible notification, so it
needs only while-in-use location permission (no background-location access).

```bash
cd apps/mobile
cp .env.example .env              # EXPO_PUBLIC_API_URL of the API
npm install
npx eas-cli build --profile development --platform android   # dev client APK, install on the phone
npm start                         # then open the dev client and scan the QR code
npm test && npm run lint && npm run typecheck
```

**A standalone app (no PC needed).** The `preview` profile builds an installable APK in Expo's
cloud with the JavaScript bundled in. It reads `EXPO_PUBLIC_API_URL` from the EAS project's
environment variables (`npx eas-cli env:list preview`), not from your local `.env`:

```bash
npx eas-cli build --profile preview --platform android
```

**Updates without a new APK.** JavaScript-only changes ship over the air with `expo-updates`;
installed apps download them on launch and use them from the next start. A new build is needed only
when native code changes (new native modules, permissions, app config); `runtimeVersion` uses the
`fingerprint` policy, so an update never reaches a build it isn't compatible with.

```bash
npx eas-cli update --channel preview --environment preview --message "What changed"
```

**Push notifications (optional).** Android delivers push through Firebase. Create a Firebase
project with an Android app `codes.abhinesh.lumiback`, download `google-services.json`, and upload it
as a file variable: `npx eas-cli env:create --name GOOGLE_SERVICES_JSON --type file --value
./google-services.json --environment preview --environment production --visibility secret`. Then
upload the FCM service-account key with `npx eas-cli credentials`. Until then the app uses local
notifications only.

## Deploying (Render + Cloudflare)

`render.yaml` describes two free Render web services: `lumiback-api` (FastAPI) and
`lumiback-web` (Next.js). Cloudflare serves `lumiback.abhinesh.codes` in front of the web app. The
browser only ever talks to the web app; the web app talks to the API server-side.

1. **Render:** New → Blueprint → this repository. When asked, fill in `DATABASE_URL` (Supabase
   session pooler), `RESEND_API_KEY` and, for the web app, `BACKEND_URL` (the API's
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
5. **First admin:** sign up in the app with the warden's address, then in `lumiback-api` → Shell
   run `.venv/bin/python scripts/make_admin.py warden@geu.ac.in`. Further admins are promoted
   from the dashboard; the last admin can't be demoted.

**Free-tier limits.** Free services sleep after 15 minutes without traffic and take about a minute
to wake. The 750 free instance hours per month are shared by both services, so keeping either one
awake around the clock leaves almost nothing for the other. If you use a pinger, schedule it for
peak hours only (e.g. 16:00–23:00 IST, about 430 hours a month for both), and hit the API's
`/health` at least once a day so the Supabase project never counts as inactive.

Email goes through Resend's HTTPS API, not SMTP: Render's free plan blocks outbound traffic on
SMTP ports (25, 465, 587).

Each service must run as a single instance: live updates and token-refresh de-duplication are
in-process. Moving off the free plan or to another host needs no code changes.
