# Lumiback web

Next.js 16 (App Router) + Tailwind CSS v4. Mobile-first student app: sign in, check out,
the return arc, "I'm back", and history.

## How it talks to the API

- **Server Components** read from FastAPI directly on the server.
- **Server Actions** perform every change (sign in, check out, return, …).
- Tokens live only in `httpOnly` cookies (`outing_at` 14 min, `outing_rt` 30 days). Browser
  JavaScript never sees them, and there is no generic API proxy.
- `src/proxy.ts` refreshes the access token before pages and actions run, and shares one refresh
  between simultaneous requests (the API revokes a login if a refresh token is reused).
- The visitor's IP is forwarded as `X-Forwarded-For` so the API's per-IP limits apply per student.
  In production run the API with `--forwarded-allow-ips=<this server's IP>`.

## Develop

```bash
cp .env.example .env.local   # BACKEND_URL of the API
npm install
npm run dev
```

## Checks

```bash
npm run lint
npm run typecheck
npm run test:e2e             # Playwright: flows + design matrix (desktop/mobile × light/dark, axe)
```

`test:e2e` starts the API on :8100 against the **local test database** (`TEST_DATABASE_URL`,
reset on every run) and signs in once as a seeded student. Screenshots land in `e2e/shots/`.
