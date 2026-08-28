# Implementation Plan — Custom Application Monitoring Platform

Companion to [custom-monitoring-platform-build-spec.md](custom-monitoring-platform-build-spec.md).
Depth: **MVP-first, with a high-level roadmap for later sprints.**

---

## 0. Locked Decisions

| Decision | Choice |
|---|---|
| Backend | Node.js + TypeScript + **NestJS** (API and worker) |
| Frontend | React + TypeScript + Vite + Tailwind |
| Database | **Supabase** — on the **AWM shared instance**, under this project's **own schema** |
| ORM / migrations | **Prisma** (scoped to our schema only) |
| Auth | **Supabase Auth** for identity; authorization/roles enforced in the NestJS API |
| Jobs | **BullMQ + Redis** |
| Monorepo | pnpm workspaces + Turborepo |
| Scope | Build the **MVP** first (spec §25), defer ML anomaly detection |

Proposed schema name: **`awm_monitoring`** — *not final; must be agreed with and created by Colin* (see §2).

---

## 1. How the AWM Shared-DB Rules Reshape the Spec

These are not optional. They change the architecture the spec assumes, so they are called out up front.

1. **All data access goes through the API using the service-role key.**
   RLS on our schema is `TO service_role` only. A browser using the anon/user-JWT client would get `null` silently. So the React dashboard **never queries the monitoring schema directly** — it calls the NestJS API, which uses the service-role key server-side.

2. **"Realtime dashboard updates" cannot use Supabase Realtime with the anon key.**
   Because RLS is service-role-only, browser subscriptions won't receive rows. → For MVP, push updates from the **API via SSE (or WebSocket)**. Supabase Realtime is off the table unless a dedicated broader-RLS surface is designed later.

3. **Supabase Auth for identity, roles enforced in our API.**
   `auth.users` is mirrored into `awm_monitoring.users` (id = auth uid). Org membership + roles (Owner/Administrator/Operator/Viewer) live in our schema and are enforced by NestJS guards — not by RLS.

4. **Prisma must be scoped to `awm_monitoring` only.**
   - Use Prisma `multiSchema`; declare `@@schema("awm_monitoring")` on every model.
   - Prisma must **never** create/alter tables in `public` or any other app's schema.
   - Colin creates the *schema*; Prisma manages *tables inside it*.
   - **Migration friction to resolve with Colin:** Prisma's shadow-DB and `migrate deploy` assume more ownership than a shared prod DB allows. Plan: iterate against a **separate dev Supabase project**, and gate any shared-DB migration through Colin (reviewed SQL). Do not run `prisma migrate` against shared prod unsupervised.

5. **Schema conventions enforced in the Prisma schema from day one:**
   - `TIMESTAMPTZ` for all timestamps (Prisma `@db.Timestamptz`), never bare timestamp.
   - Foreign keys `ON DELETE RESTRICT`, never cascade.
   - Enums (Postgres enum types in our schema) for every status/type column — lowercase snake_case values.
   - Soft delete (`is_deleted`, `deleted_at`, `deletion_reason`) on anything holding client data or audit history — no hard deletes.
   - `insightly_id TEXT NOT NULL` **only on client-linked tables** (relevant to Insightly integration monitoring in Sprint 8, not to core monitoring tables).
   - Every table carries `org_id` — spec requires each record linked to an organisation.

6. **Secrets need app-level encryption, not just RLS.**
   Monitor auth headers, notification credentials, and test credentials must be encrypted at rest (AES-256-GCM with a key from env/KMS), decrypted only in the worker/API, and never returned to the frontend.

---

## 2. Pre-Work / Blockers (clear before any DB code)

- [ ] Register the tool in the Notion Tool Registry (name, one-liner, touches-client-data = yes for Insightly monitor later).
- [ ] Agree schema name with Colin and have him **create the schema** (`awm_monitoring` proposed).
- [ ] Receive scoped credentials from Colin: `SUPABASE_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`; generate personal `SUPABASE_ACCESS_TOKEN`.
- [ ] Stand up a **separate dev Supabase project** for schema iteration (so Prisma migrations don't touch shared prod).
- [ ] Provision **Redis** (Upstash / Railway / Fly).
- [ ] Pick **hosting** (Render or Railway recommended for MVP; worker deployed separately from API/dashboard).
- [ ] Decide the **secrets encryption key** source (env var for MVP; KMS later).

---

## 3. Foundation — Repo & Tooling

```
/apps
  /api        NestJS  — REST + SSE, auth, CRUD, incident/alert orchestration
  /dashboard  React + Vite + Tailwind
  /worker     NestJS standalone — BullMQ consumers, all check executors
/packages
  /shared     TS types, zod schemas, enums, DTOs (single source of truth)
  /monitoring-sdk  @tumisang/monitoring-sdk (Sprint 9)
  /config     eslint / tsconfig / tailwind presets, env validation (zod)
```

- pnpm workspaces + Turborepo pipeline (`build`, `lint`, `typecheck`, `test`).
- Env validation with zod at startup in each app (fail fast on missing vars).
- Docker Compose for local: Redis (+ optional local Postgres for offline dev; primary DB is the dev Supabase project).
- Prisma client generated into `packages/shared` and consumed by api + worker.

---

## 4. MVP Plan (spec §25) — Detailed Milestones

Ordered to deliver a usable product early. Each milestone ends with the spec acceptance criteria it satisfies.

### M1 — Foundation & Auth  *(spec Tasks 1.1–1.3)*
- Monorepo scaffold, env validation, Docker Compose, CI skeleton.
- Prisma schema + first migration for: users, organisations, org_members, projects, environments, monitors, monitor_results, incidents, incident_events, notification_channels, alert_rules, maintenance_windows, heartbeat_events, audit_logs. (All with `org_id`, TIMESTAMPTZ, enums, RESTRICT FKs, soft-delete where needed.)
- Supabase Auth wiring: login, password reset, session; mirror to `users`.
- RBAC guards (Owner/Admin/Operator/Viewer) + org-scoping middleware.
- Audit-log write helper (used everywhere from here on).
- **Done when:** all three apps boot; migrations apply; unauthenticated users blocked; users only see their orgs; role restrictions hold.

### M2 — Monitor CRUD + HTTP Engine  *(Tasks 2.1, 3.1, 3.2; parts of 13.1)*
- Monitor CRUD (create/edit/disable/delete(soft)/duplicate), interval + config validation via zod, writes to audit log.
- **Scheduler:** BullMQ repeatable jobs, one per enabled monitor; add/update/remove on monitor changes; disabled monitors not scheduled. Claim/locking so multiple worker replicas don't double-run a monitor.
- **HTTP executor:** methods GET–HEAD, headers/query/body/auth (none/basic/bearer/api-key/custom), timeout; records status + duration; detects timeout/DNS/TLS failures; encrypts sensitive headers; never returns secrets to frontend.
- **Response validation:** status code, expected/forbidden keyword, JSON field + schema, max duration; stores failure reasons; truncates large bodies; doesn't store sensitive bodies by default.
- Result storage with `(monitor_id, created_at)` index + retention strategy (high write volume — see §6).
- Basic dashboard: monitor list with live status.
- **Done when:** a created HTTP monitor runs on schedule, results/durations recorded, validation failures captured.

### M3 — Incident Engine + Alerting  *(Tasks 10.1, 10.2, 11.1, 11.2; recovery)*
- Retry logic (per-monitor `retry_count`) before failing.
- Incident creation on failure-after-retries; statuses Open/Acknowledged/Investigating/Resolved/Muted; occurrence counting.
- **Deduplication:** signature = hash(org, monitor, error_type, normalized reason, time window). Repeated failures increment; new error types = new incident; configurable.
- Recovery auto-resolves; reopen within configured window; all changes logged.
- **Notification channels:** Email (Resend/SendGrid/Graph) + Slack + Teams webhooks for MVP (SMS/WhatsApp deferred to Sprint 6). Encrypted credentials, test-send, retry, attempt logging.
- **Alert rules** (basic): severity/project/environment/failure-duration → channel, with escalation delay. Business-hours + escalation-stop-on-resolve.
- **Done when:** one outage → one incident (not hundreds); email + Slack/Teams alerts fire; recovery resolves and stops escalation.

### M4 — Remaining MVP Check Types  *(Tasks 4.1, 5.1, 5.2, 6.1)*
- **TCP port** executor: connect, timing, refusal/timeout/DNS detection → incidents.
- **Heartbeat** monitors: secure random token, `POST /api/heartbeats/{token}`, last-seen updates, missed-heartbeat + failed-event incidents, token regeneration, history.
- **Job execution tracking:** long-running / missed / repeatedly-failing detection; graphable metrics.
- **SSL** monitor: validity, expiry, issuer, domain match, chain, days-remaining; thresholds 30/14/7/1 days without duplicate incidents.
- **Done when:** all four MVP check types run and generate incidents correctly.

### M5 — Ops Surface: Dashboards, Maintenance, Reports, Audit  *(Tasks 12.1, 13.1–13.3, 14.1, 17.2)*
- **Maintenance windows:** one-time/recurring, project/monitor/environment scope; results still collected, incidents suppressed, optional mute, start/end logged.
- **Overview dashboard** (SSE live), **monitor detail** (uptime, response-time history, checks, failures, masked config, manual test-run), **incident page** (timeline, ack, notes, assignee, resolve, no silent delete).
- **Uptime reports:** uptime %, downtime, incident count, MTTD/MTTA/MTTR, avg/slowest response, missed jobs, notification success rate; filter by date/project; CSV export; weekly/monthly + emailed.
- **Audit logging** complete + queryable/exportable, immutable.
- **Done when:** dashboards live-update and filter; reports export; maintenance suppresses incidents; audit trail immutable.

### M6 — Self-Monitoring & Deploy (MVP subset of Sprints 10 & 24)  *(Tasks 18.1, 20.1)*
- Health endpoints (liveness/readiness), queue/DB/provider health, worker heartbeat, dead-letter queue, auto-restart.
- **External monitor** watching the platform itself.
- CI/CD pipeline: install → lint → typecheck → test → build → migrate (gated) → deploy api/worker/dashboard → smoke tests; documented rollback.
- **Performance gates** (see [PERFORMANCE_TESTING_PLAN.md](PERFORMANCE_TESTING_PLAN.md)): `/metrics` (prom-client) on api + worker; k6 smoke test as a PR gate; nightly normal+peak runs; first baselines committed. Perf tests run against local Postgres only — never the shared Supabase instance.
- **Done when:** the monitoring system is itself monitored, deploys are automated, and the perf smoke gate is enforced in CI.

---

## 5. Post-MVP Roadmap (high level)

| Sprint | Work |
|---|---|
| 6 (finish) | SMS + WhatsApp (Twilio) channels; full multi-step escalation; weekends/public-holiday awareness |
| 8 | Synthetic **workflow engine** (multi-step: HTTP/DB/delay/assert/extract/conditional/cleanup); **Insightly monitoring** (dedicated labelled test records, never real clients, auto-cleanup); **email canary** end-to-end |
| 9 | **`@tumisang/monitoring-sdk`** (jobStarted/Completed/Failed, recordMetric, sendHeartbeat, captureError, checkDependency — non-blocking, retrying, buffered); client integration docs; deploy templates |
| 10 | Rule-based anomaly detection (§15.1) → statistical (§15.2, rolling median + MAD, seasonal baselines); performance optimisation driven by the k6 spike/soak results and bottleneck loop in [PERFORMANCE_TESTING_PLAN.md](PERFORMANCE_TESTING_PLAN.md) §7; security review; production hardening |
| Security (17.1) | Runs throughout, hardened here: encryption at rest, masking, secret rotation, access logging, environment separation |

Note: **third-party integration monitoring (§12)** and **business-workflow monitoring (§13)** are the AWM-specific payoff — they're where the Insightly/Supabase/Graph/Zapier/Twilio checks live. Sequenced in Sprint 8 after the engine is solid.

---

## 6. Key Technical Designs to Settle Early

- **Scheduling & scale:** BullMQ repeatable job per monitor. Need a claim/lock so N worker replicas don't double-execute. 1-minute intervals across many monitors = real load — size Redis and workers accordingly.
- **Result-table volume:** `monitor_results` is the highest-write table. Time-based partitioning + retention policy + tight indexing `(monitor_id, created_at desc)`. Consider rolling aggregates for long-range charts instead of scanning raw rows.
- **Secret encryption:** AES-256-GCM app-side; key from env (MVP) → KMS later. Encrypt monitor auth config + channel credentials + canary/test credentials. Decrypt only in worker/API; mask in dashboard.
- **Dedup signature:** stable hash of `(org_id, monitor_id, error_type, normalized_failure_reason)` within a time window.
- **Multi-tenancy:** `org_id` on every row; every API query org-scoped by guard, not trusted from client.
- **Realtime:** API SSE channel per org for dashboard; worker → API event bus (Redis pub/sub) → SSE fan-out.

---

## 7. Risks & Open Questions

1. **Prisma on a shared prod DB** — biggest risk. Confirm migration workflow with Colin; keep shared-prod migrations SQL-reviewed and gated; iterate on a dev Supabase project.
2. **Realtime approach** — confirm SSE is acceptable vs. investing in a Supabase Realtime-compatible RLS surface.
3. **Secrets key custody** — env var acceptable for MVP? KMS for prod?
4. **Public-holiday source** for business-hours alert rules (UK + SA — you have staff in both).
5. **Interval cost** — is 1-minute monitoring needed at launch, or start at 5-minute minimum to control load/cost?
6. **Notification provider** — Resend vs SendGrid vs Microsoft Graph for email (Graph aligns with AWM's Microsoft stack).

---

## 8. Immediate Next Actions

1. Confirm schema name with Colin and get it created + credentials issued.
2. Spin up dev Supabase project + Redis.
3. Scaffold the monorepo (M1 start): apps + packages, env validation, Docker Compose, CI skeleton.
4. Draft the Prisma schema for the 13 MVP tables (enums, TIMESTAMPTZ, RESTRICT, soft-delete, org_id) — review before first migration.
5. Answer the six open questions in §7.
