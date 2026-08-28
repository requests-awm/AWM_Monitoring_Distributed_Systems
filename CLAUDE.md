# CLAUDE.md — AWM Monitoring System

Custom Application Monitoring Platform. Reusable system to monitor apps, APIs, websites,
scheduled jobs, ports, SSL, email workflows, and business processes, with multi-channel alerting.

## Source of Truth (read these before working)

- [Project Construction.md](Project%20Construction.md) — the project constitution: persona, tech stack, source tree, coding commandments, communication protocol. **These are non-negotiable.**
- [custom-monitoring-platform-build-spec.md](custom-monitoring-platform-build-spec.md) — the full functional/feature spec (27 sections, 20 tasks, 10 sprints).
- [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) — the MVP-first build plan, milestones, risks, and how the shared-DB rules reshape the spec.
- [PERFORMANCE_TESTING_PLAN.md](PERFORMANCE_TESTING_PLAN.md) — NFRs/SLOs, k6 workload models, perf environment, CI gates. **Perf tests never run against the shared Supabase instance.**

When the constitution and the build spec conflict, the reconciliation in IMPLEMENTATION_PLAN.md wins (it already accounts for both).

## Locked Stack

- **Backend:** NestJS + TypeScript (Node 20) — `api` and `worker` are separate deployables.
- **Frontend:** React 18 + Vite + Tailwind + Shadcn/ui + TanStack Query.
- **DB:** Supabase (AWM shared instance), Prisma, schema `awm_monitoring`.
- **Jobs:** BullMQ + Redis.
- **Monorepo:** pnpm workspaces + Turborepo.

## AWM Shared Database Rules

This project connects to the AWM shared Supabase instance (URL provided by Colin).
**My schema is `awm_monitoring`** (proposed — must be agreed and created by Colin before any DB code).

Before writing any database code, read:
- `~/.claude/shared-db/STANDARDS_AND_RULES.md`
- `~/.claude/shared-db/PUBLIC_SCHEMA_REFERENCE.md`

### Non-negotiable rules (enforce without being asked)

1. Never write to the `public` schema — read only
2. Never write to another app's schema — only `awm_monitoring`
3. All timestamps: `TIMESTAMPTZ` not `TIMESTAMP`
4. All foreign keys: `ON DELETE RESTRICT` never `CASCADE`
5. No hard deletes — use `is_deleted = true`, `deleted_at`, `deletion_reason`
6. Enums for every status/type column — never plain `TEXT` for controlled values
7. Enum values: lowercase snake_case always
8. Every client-linked table: `insightly_id TEXT NOT NULL` (relevant to Insightly integration monitoring, not core monitoring tables)
9. RLS enabled on every table before any cross-read can be granted
10. Service role key: server/backend only — never in client-side code

### Consequences for this build (from IMPLEMENTATION_PLAN.md §1)

- RLS is service-role-only → **the dashboard never queries the DB directly**; all data goes through the NestJS API using the service-role key.
- Supabase Realtime with the anon key won't receive rows → **live dashboard updates use API SSE**, not Supabase Realtime.
- Supabase Auth handles identity; **roles (Owner/Admin/Operator/Viewer) are enforced by NestJS guards**, not RLS.
- **Prisma is scoped to `awm_monitoring` only** (`@@schema`, multiSchema). Never touch `public` or other schemas. Iterate migrations on a separate **dev Supabase project**; shared-prod migrations are reviewed SQL, gated through Colin.
- Secrets (monitor auth, notification credentials, canary credentials) need **app-level AES-256-GCM encryption**, not just RLS.
- Every table carries `org_id`.

### Cross-schema query pattern

Supabase embedded joins do not cross schemas. To join our data with `public.insightly_contacts`,
use two separate Supabase clients (service role) and merge in application code.
See `PUBLIC_SCHEMA_REFERENCE.md`.

## How We Work

- Tell me what you're about to do before doing it. Ask before anything non-trivial.
- Short answers by default.
- Always run build/typecheck before saying code is ready — verify, don't assume.
- Fix what's asked; flag anything worth noting but don't refactor unrelated code unprofited.
- No comments in code unless the reason isn't obvious.
- Don't assume environment variables are available at build time.

## Git

- Git identity: operations.support@ascotwm.com
- Commit/push only when asked.
