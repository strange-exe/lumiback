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

The Android app shares location through a foreground service with a visible notification, so it
needs only while-in-use location permission, never background location.

## API overview

A summary by area. The running API's OpenAPI docs (FastAPI's `/docs`) are the full reference.

| Area | Endpoints |
|---|---|
| Sign-up and sign-in | `POST /auth/register` `/auth/verify-email` `/auth/resend-verification` `/auth/login` `/auth/refresh` `/auth/logout`, `GET /auth/me` |
| Passwords | `POST /auth/forgot-password` `/auth/reset-password` `/auth/password-link` `/auth/set-password` `/auth/change-password` |
| Account | `GET /auth/devices`, `DELETE /auth/devices/{id}`, `POST /auth/devices/sign-out-others` `/auth/delete-account`; `GET /profile` `/profile/export`, `PATCH /profile`; `GET /hostels` |
| Contacts | `POST /contacts`, `GET /contacts`, `POST /contacts/{id}/accept`, `DELETE /contacts/{id}` |
| Sessions | `POST /sessions`, `GET /sessions/mine` `/sessions/watching` `/sessions/{id}`, `POST /sessions/{id}/stop` |
| Viewers | `POST /sessions/{id}/codes` `/codes/redeem` `/sessions/{id}/viewers/{vid}/approve` `/sessions/{id}/viewers/{vid}/revoke` |
| Location | `PUT /sessions/{id}/location`, `GET /sessions/{id}/location` `/sessions/{id}/access-log` |
| Outings | `POST /outings`, `GET /outings` `/outings/current` `/outings/summary`, `POST /outings/current/return` `/outings/current/late-reply` `/outings/{id}/correction` |
| Outing requests | `GET /outings/request`, `POST /outings/request`, `DELETE /outings/request/{id}` |
| Live | `WS /ws`: authenticate in the first message, then subscribe to session ids |
| Gates | `GET /campus`, `POST /gates/scan` (students tap out / in), `GET /kiosk/qr` (gate tablet, `X-Kiosk-Token`) |
| Devices | `POST /devices/push-token` `/devices/push-token/remove` |
| Admin: monitoring | `GET /admin/overview` `/admin/outings` `/admin/outings.csv` `/admin/late-today` `/admin/scans` `/admin/escalations`, `POST /admin/escalations/{id}/resolve` |
| Admin: gates, settings | `/admin/gates` (list, create, edit, delete), `POST /admin/gates/{id}/kiosk-token`, `GET`/`PUT /admin/settings` |
| Admin: people | `GET /admin/users` `/admin/students`, `POST /admin/people` `/admin/students/import` `/admin/students/{id}/hostel` `/admin/users/{id}/role` `/admin/users/{id}/active` `/admin/users/{id}/password-link`, `PATCH /admin/users/{id}`, `DELETE /admin/users/{id}/invite` |
| Admin: rules | `/admin/rule-sets` (list, create, edit, delete, `POST .../{id}/default`), `/admin/hostels` (list, create, edit, delete, `GET /admin/my-hostels`, `PATCH .../{id}/contact`), `/admin/holidays` (`GET`, `PUT`/`DELETE .../{day}`) |
| Admin: decisions | `GET /admin/requests` `/admin/corrections`, `POST /admin/requests/{id}/decision` `/admin/corrections/{id}/decision` `/admin/outings/{id}/correction` |
| Developers | `GET /meta/status` (API version, deployed commit, database migration vs. head; developers only) |

Access tokens last 15 minutes; refresh tokens rotate on every use. Guests send their token in the
`X-Guest-Token` header. Outing times are returned in IST (`+05:30`); outing status (out, overdue,
returned) is computed when read.

## App updates

JavaScript-only changes reach installed apps over the air. `runtimeVersion` uses Expo's
`fingerprint` policy, so an update never reaches a build it isn't compatible with. When native code
changes, installed apps learn about the new build from `apps/web/public/app/android.json` and offer
the download. Each build ships three APKs: 64-bit ARM (the default), 32-bit ARM, and a universal
one. Phones pick the APK for their processor. The version people see comes from
`apps/mobile/src/updates/changelog.json`.

## Hosting

The API and the website run as two free Render web services. Cloudflare serves
`lumiback.abhinesh.codes` in front of the website, and Supabase hosts the database. The browser
only talks to the website, which talks to the API server-side.

- **Single instance.** Live updates and token-refresh de-duplication are in-process, so each
  service runs as one instance.
- **Free-plan sleep.** Render spins a free service down after 15 minutes without traffic, and
  wakes it in about a minute. The late-alert sweep runs inside the API, so it pauses while the API
  sleeps. Supabase pauses a free project after about a week of low activity.
- **Keep-awake.** A Cloudflare Worker cron (`infra/support-email`) pings each service every 10
  minutes inside its own IST window. The API's ping runs `SELECT 1`, which also keeps Supabase
  active. Both services share Render's 750 free hours a month, and running out suspends both, so
  the windows are sized for a 31-day month:

  | Service | Window (IST) | Hours a month |
  |---|---|---|
  | API | 09:30–22:00 | ~396 |
  | Website | 17:00–22:00 | ~163 |
  | Left for visits outside the windows | | ~190 |

- **Health alerts.** `GET /health` answers `{"status": "ok", "sweep": "ok"}`; `sweep` turns
  `stale` when the background sweep (late alerts, escalations, expiry) hasn't finished for 3
  intervals (90 s). It stays 200 when only the sweep is stale, so Render's health check doesn't
  restart the API in a loop. The same Worker emails the support inbox (`FORWARD_TO`, through
  Resend) when a ping inside a window finds a service down or the sweep stale. It keeps no state,
  so it only emails on the runs at :00 and :30: at most 2 emails an hour while a problem lasts.
  The first ping of each window only wakes the service and never alerts.
- **Email.** Mail goes through Resend's HTTPS API, because Render's free plan blocks SMTP ports.
- **Support address.** `support@lumiback.abhinesh.codes` uses Cloudflare Email Routing. The same
  Worker forwards each message to an inbox and sends one automatic acknowledgement. It never
  answers bounces, mailing lists or other auto-replies.

Moving off the free plan or to another host needs no code changes.
