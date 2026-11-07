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
- The visitor's IP goes to the API in `X-Client-IP`, with `X-Internal-Auth` carrying
  `INTERNAL_API_SECRET`, so the API's per-IP limits apply per student (`src/lib/client-ip.ts`).
  Set `INTERNAL_API_SECRET` to the same value on both services; without it the API ignores
  `X-Client-IP` and counts every student as this server. The web server reads the IP from
  `CLIENT_IP_HEADER` (behind Cloudflare: `cf-connecting-ip`) and trusts it only when the edge also
  sends `EDGE_SECRET` in `X-Edge-Auth`; `CLIENT_IP_HEADER` without `EDGE_SECRET` refuses to start.
  `X-Forwarded-For` is never trusted here. For callers that reach the API directly, the API's
  own `PROXY_HOPS` says how many proxies in front of it append to `X-Forwarded-For` (Render: 1).

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
npm run test:unit            # node --test on src/**/*.test.ts
npm run format:check         # Prettier
npm run build
npm run test:e2e             # Playwright: flows + design matrix (desktop/mobile × light/dark, axe)
```

`test:e2e` starts the API on :8100 against the **local test database** (`TEST_DATABASE_URL`,
reset on every run), starts Next.js on :3000 pointed at it, and signs in once as each seeded
role. Screenshots land in `e2e/shots/`. If something already listens on :3000 (say your own
`npm run dev`), the run stops instead of testing against it. To reuse a server on purpose, start
it with `BACKEND_URL=http://127.0.0.1:8100 E2E_FAULTS=1` and run with `E2E_REUSE_WEB=1`.
