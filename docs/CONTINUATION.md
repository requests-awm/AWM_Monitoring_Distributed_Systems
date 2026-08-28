# Continuation Runbook

## Monitoring core (added 2026-08-27)

The platform MVP now runs end-to-end in sample mode (in-memory store, real executors):

- **Executors** (`apps/worker/src/checks/`): HTTP (auth, status/keyword/JSON validation,
  performance threshold → degraded), TCP, SSL (expiry thresholds 30/14/7/1), SMTP banner,
  integration (auth/permission/rate-limit classification). Worker pulls due checks from
  `GET /api/internal/monitors/due` (claim-on-read) and reports to `POST /api/internal/monitor-results`
  (`WORKER_TOKEN` auth). Interval loop → BullMQ in M2.
- **Incident engine** (`apps/api/src/monitoring/incident.engine.ts`): retry budget → dedup
  signature → incident create/increment, auto-resolve on recovery, escalation timers that stop
  on acknowledge, maintenance-window suppression, missed-heartbeat sweep (30s).
- **Alerting**: channels (email/sms/whatsapp/slack/teams/asana/webhook) + alert rules
  (severity/project/environment/type match). Webhook/Slack/Teams/Asana-with-token/Twilio-with-creds
  send for real; the rest simulate and say so. Every attempt logs to the incident timeline.
- **Heartbeats**: public `POST /api/heartbeats/{token}`; missed-job detection verified live.
- **RBAC**: `RolesGuard` (owner>admin>operator>viewer), dev-header auth (`x-user-role`),
  Supabase JWT seam marked TODO(m1). Verified: viewer 403 on mutations.
- **Dashboard**: Overview (live), Monitors (CRUD + detail + run-now), Incidents (timeline,
  ack/resolve/mute/assign/notes), Workflow failures, Maintenance, Reports (uptime/MTTA/MTTR + CSV),
  Settings (channels + rules).
- **Live-mode seam**: the monitoring store is in-memory only for now — the Prisma repository
  for the monitoring core is the next continuation step (same pattern as the workflow-events
  repos below; the DB schema for all of it already exists in `packages/db`).

---

# Workflow Failure Monitoring

Everything is built to flip from **sample mode** (in-memory, fixture-seeded) to **live mode**
by supplying credentials. No code changes required for the switch. This is the exact sequence
when each dependency arrives.

## Current state (2026-08-26)

| Layer | Status |
|---|---|
| Contract (`packages/shared`) | Done — event type, ingest envelope (zod), action bodies/results |
| DB (`packages/db`) | Models + reviewed SQL ready ([0002_workflow_failure_monitoring.sql](../packages/db/prisma/sql/0002_workflow_failure_monitoring.sql)) — **not yet applied** |
| API | Real endpoints live: `GET /api/workflow-events`, `POST /api/ingest/workflow-events` (bearer token, idempotent), `POST /api/workflow-events/:id/{acknowledge,resolve,ignore,assign,retry,apply-fix,resubmit}` |
| Storage seam | `WorkflowEventsRepository`: in-memory (sample) ⇄ Prisma (live), selected by `DATABASE_URL` |
| n8n calls | `N8nGateway` — real HTTP (retry, webhook resubmit) when the source has `base_url` + API key; simulated otherwise |
| Worker | `N8nSweepService` — idle until env is set; then sweeps `status=error|crashed` every 5 min and re-posts through our ingest endpoint |
| Dashboard | Fully wired to the real endpoints; sample badge driven by `GET /api/health` `mode` |

## Step 1 — When Colin provides the schema + credentials

1. Have Colin run [0002_workflow_failure_monitoring.sql](../packages/db/prisma/sql/0002_workflow_failure_monitoring.sql)
   (after `0001_init.sql`). Additive only; includes RLS `TO service_role`.
2. Set in `.env`: `DATABASE_URL` (dev Supabase project first, per IMPLEMENTATION_PLAN §1.4),
   `ENCRYPTION_KEY` (generate per `.env.example`).
3. Seed one row in `organisations` and one per platform in `workflow_sources`:
   - `ingest_token_hash` = sha256 hex of a freshly generated token (keep the plaintext for step 2/3)
   - n8n row: `base_url`, `api_key_encrypted` (encrypt with `encryptSecret()` from
     `apps/api/src/lib/secrets.ts`), `sweep_enabled = true`
4. Restart the API → `GET /api/health` reports `mode: "live"`, the dashboard badge disappears.

## Step 2 — When the n8n instance + API key arrive

1. Confirm the instance version is ≥ the Sep 2025 release (public retry endpoint). If older,
   the Retry button will get 404s from `POST /api/v1/executions/{id}/retry`.
2. Build the two n8n workflows (specs in [workflow-failure-monitoring.md](workflow-failure-monitoring.md) §3.3):
   - **Global error handler**: Error Trigger → map to the ingest envelope → HTTP Request
     `POST {API_BASE_URL}/api/ingest/workflow-events` with header
     `Authorization: Bearer <n8n source token>`.
   - **Watchdog**: hourly schedule → n8n API → set the error workflow on every workflow.
3. Enable the sweep: set `N8N_BASE_URL`, `N8N_API_KEY`, `API_BASE_URL`, `INGEST_TOKEN_N8N`
   for the worker.

## Step 3 — When Zapier plan/ownership is confirmed

1. Create the Manager Zaps (New Zap Error, Zap Turned Off → Webhooks POST to the ingest
   endpoint with the Zapier source token). Error email notifications must stay enabled.
2. Webhook-triggered Zaps that should support Edit & resubmit: include `resubmit_url`
   (the Zap's catch URL) in the envelope the sender posts.

## Connecting any other app (Make, Power Automate, cron jobs, AWM apps)

Self-serve from the dashboard: **Workflow failures → + Connect app** → name + platform →
`POST /api/workflow-sources` creates the source and returns the ingest bearer token **once**
(only the SHA-256 hash is stored), together with copy-paste curl/JS snippets. The app then
POSTs the standard envelope from its error handler:

- Make.com: error-handler route → HTTP module
- Power Automate: "Configure run after: has failed" → HTTP action
- GitHub Actions: `if: failure()` step → curl
- Node/cron jobs: `fetch()` in the catch block (snippet provided by the dialog);
  superseded by `@tumisang/monitoring-sdk` in Sprint 9

Platform enum: `make` and `custom_app` are first-class; anything else uses `other` or adds an
enum value (shared zod + Prisma enum + `ALTER TYPE ... ADD VALUE` for Colin). Sample mode ships
a third source, "Task Booker Jobs" (`custom_app`), token `dev-ingest-taskbooker-sample-token`.

Push covers loud failures only — workflows that silently never run need a heartbeat monitor
(M4) alongside.

## Deferred (Phase B/C backlog)

- **Apply-fix workflow patching**: `applyFix` currently retries with `loadWorkflow: true`
  (picks up manual fixes). The suggestion *applier* (`PUT /api/v1/workflows/{id}` + version
  check) and the suggestion *generator* (Claude API over credential-stripped workflow JSON)
  are TODO — seam is `WorkflowEventsService.applyFix` / `N8nGateway`.
- **Fix suggestions in live mode** are null until the generator exists (sample fixtures carry
  hand-written ones).
- **SSE live updates** (dashboard polls every 15s meanwhile), **RBAC guards** (M1),
  **incident engine link-up** (`incident_id` FK is already in place), **BullMQ sweep** (M2),
  **`assignee` → users FK** once Supabase Auth mirroring lands.

## Verify after any switch

```
curl -s http://localhost:3000/api/health                       # mode: live
curl -s http://localhost:3000/api/workflow-events | head -c 200
curl -s -X POST http://localhost:3000/api/ingest/workflow-events \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d @docs/samples/ingest-envelope.json                        # {"id":"...","duplicate":false}
# repeat the same POST → {"duplicate":true}
```
