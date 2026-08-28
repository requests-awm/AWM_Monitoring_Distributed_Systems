# Deployment

The platform ships as two container images built from the single root [Dockerfile](../Dockerfile):

| Target | Contents | Port | Health |
|---|---|---|---|
| `api` | NestJS API **+ the built dashboard** (served same-origin, no CORS) | 3000 | `GET /api/health` |
| `worker` | Check poller + n8n sweep (headless, with a bare liveness listener) | 3001 | `GET /health` |

```bash
docker build --target api    -t awm-monitoring-api .
docker build --target worker -t awm-monitoring-worker .
```

Or run the whole stack (api + worker + Redis) with
[docker-compose.prod.yml](../docker-compose.prod.yml):

```bash
# .env next to the compose file supplies the ${...} values
docker compose -f docker-compose.prod.yml up -d --build
```

> **Status note (2026-08-28):** Docker is not installed on the dev laptop, so these
> images have not been built/run yet — the TypeScript builds they run are verified,
> the Dockerfile itself is not. First `docker build` happens on the deploy host;
> budget a few minutes for surprises (most likely spot: Prisma engines on Alpine).

## Environment

Production (`NODE_ENV=production`) is fail-fast: the apps **refuse to start** with
missing/dev-default secrets rather than run open.

### api (required in production)

| Var | Purpose |
|---|---|
| `ACCESS_TOKEN` | Interim auth gate (see below). Min 24 chars. Generate: `node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"` |
| `WORKER_TOKEN` | Shared secret for `/api/internal/*`; must match the worker. Dev default rejected. |
| `INGEST_TOKEN_N8N` / `INGEST_TOKEN_ZAPIER` | Only enforced while in sample mode (no `DATABASE_URL`) — dev defaults rejected because they'd be live credentials. |

### api (live mode — when Colin provides the DB)

Set `DATABASE_URL` + `ENCRYPTION_KEY` and the API flips from the in-memory sample
store to Prisma (`GET /api/health` reports `mode: "live"`). Full sequence:
[CONTINUATION.md](CONTINUATION.md) Step 1. **Until then any deployment is sample
mode: single instance only, all data resets on restart.**

### worker

`API_BASE_URL` (e.g. `http://api:3000`), `WORKER_TOKEN` (must match the API),
`WORKER_PORT` (default 3001), optional `N8N_BASE_URL`/`N8N_API_KEY`/`INGEST_TOKEN_N8N`
to enable the sweep, `REDIS_URL` (unused until BullMQ lands in M2).

## Interim access gate

Until Supabase Auth (M1), the API is protected by a single shared token:

- Every `/api` route requires `X-Access-Token: <ACCESS_TOKEN>`, **except** routes with
  their own auth: `/api/health*`, `/api/ingest/*` (bearer ingest tokens),
  `/api/heartbeats/*` (URL token), `/api/internal/*` (worker token).
- The dashboard shell is public; on the first 401 it shows a token prompt and stores
  the value in `localStorage` (`awm_access_token`).
- RBAC is unchanged underneath — everyone holding the token acts as `owner` via the
  dev-header fallback. The token is a perimeter, not user identity. Remove the gate
  when Supabase JWT auth replaces `currentUser()` in
  [roles.guard.ts](../apps/api/src/auth/roles.guard.ts).

## Go-live checklist

1. Colin: run `0001_init.sql` + `0002_workflow_failure_monitoring.sql`; get `DATABASE_URL`.
2. Generate real `ACCESS_TOKEN`, `WORKER_TOKEN`, `ENCRYPTION_KEY`; store outside git.
3. `docker compose -f docker-compose.prod.yml up -d --build` on the host.
4. Verify: `curl -H "X-Access-Token: ..." https://<host>/api/health` → `mode: "live"`;
   dashboard loads and unlocks; unauthenticated `/api/overview` → 401.
5. Re-create workflow sources in live mode (sample-mode sources/tokens do not carry
   over) and update every connected app's ingest token — starting with LEAD_PORTAL.
6. Point connected apps' `MONITORING_BASE_URL` at the deployed URL.

## Not containerised (on purpose)

- **Migrations** — reviewed SQL applied by Colin, never `prisma migrate` against the
  shared instance (IMPLEMENTATION_PLAN §1.4).
- **The dashboard as its own service** — it is static output baked into the api image.
  `AWM_API_TARGET`/Vite dev proxy remain dev-only.
