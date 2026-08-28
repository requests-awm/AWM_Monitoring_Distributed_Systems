# Unified Workflow Failure Monitoring — Research & Design

**Owner:** Tumisang · **Date:** 2026-08-25 · **Status:** Proposal for team review

Origin: team discussion on N8N/Zapier failure visibility. Colin wants confidence that failed
executions are noticed; Armand suggested pushing failed executions to a unified interface via
the N8N API; the team discussed a global error-handler workflow. This doc is the research
result and the implementation design, slotted into the existing
[IMPLEMENTATION_PLAN.md](../IMPLEMENTATION_PLAN.md).

---

## 1. TL;DR recommendation

Build a **Workflow Failure Inbox** inside the AWM Monitoring System:

- **Push-first ingestion.** One `POST /api/ingest/workflow-events` endpoint receives
  normalized failure events. N8N pushes via a global error-handler workflow (Error Trigger →
  HTTP Request). Zapier pushes via Zapier Manager triggers (`New Zap Error`, `Zap Turned Off`)
  → Webhooks by Zapier.
- **Poll-second reconciliation (N8N only).** A worker job sweeps
  `GET /api/v1/executions?status=error` so nothing is missed if the error workflow itself
  fails or the push is lost. Zapier has **no public run-history API** for non-partners, so
  push + email alerts is the only route there.
- **Action buttons** on each event: *Open execution* (deep link), *Retry* (N8N only, via
  public API), *Acknowledge / Resolve / Ignore*, *Assign*.
- **Alerting** rides the platform's incident engine + notification channels (M3) once built;
  the existing N8N/Zapier alert emails stay on as a safety net (Zapier requires them for the
  Manager triggers to fire at all).

This is new scope — build-spec §12 covers integration *health checks* (auth/read tests), not
ingesting failed executions. It can be built as a **standalone vertical slice** ahead of
M2/M3 because it doesn't need the scheduler or HTTP executors.

---

## 2. Research findings

### 2.1 N8N

| Capability | Mechanism | Notes |
|---|---|---|
| Push on failure | **Error Trigger** node (`n8n-nodes-base.errorTrigger`) in a dedicated error-handler workflow, linked per workflow via *Settings → Error workflow* | Fires only for **production** executions, never manual test runs. The handler workflow does not need to be active. Payload: `workflow.id/name`, `execution.id/url/mode/retryOf`, `execution.error.message/stack`, `execution.lastNodeExecuted`. If the *trigger* node failed, payload carries `trigger.error` and no execution id/url (nothing ran). |
| Instance-wide default error workflow | **Does not exist natively** | Standard workaround: a "watchdog" workflow that uses the n8n API to set the error-workflow setting on every workflow (official template #2169). Run it on a schedule so new workflows get covered. |
| Pull / reconciliation | `GET /api/v1/executions?status=error` | Auth: `X-N8N-API-KEY` header (create under *Settings → n8n API*). Cursor pagination (`nextCursor`), `limit` max 250. `includeData=true` returns full node I/O (off by default — keep off; may contain client data). Recent releases add `workflow_name` to the list response. Known open bugs: status field sometimes omitted (#20706), `waiting` executions omitted (#14748), `status=crashed` filter in queue mode (#31427). No documented rate limits. |
| Retry | `POST /api/v1/executions/{id}/retry` | **Public API since the 2025-09-15 n8n release** (older instances: internal `/rest` only — verify our instance version). Optional `loadWorkflow` retries against the current workflow version instead of the version that ran. `POST /executions/{id}/stop` and bulk stop also public now. |
| Deactivation detection | Poll `GET /api/v1/workflows` and diff the `active` boolean | n8n does not auto-deactivate on errors; still worth tracking for drift. |
| Enterprise-only alternative | Log streaming (webhook/syslog/Sentry destinations, `n8n.workflow.failed` event) | Not assumed — error-workflow push works on all editions. |
| Plan constraints | API unavailable on n8n Cloud **free trial**; self-hosted (incl. community) has it. API-key **scopes** are Enterprise-only — a non-Enterprise key has full account access, so treat it as a high-value secret. |

### 2.2 Zapier

| Capability | Mechanism | Notes |
|---|---|---|
| Push on failure | **Zapier Manager** built-in app: `New Zap Error` trigger → **Webhooks by Zapier** POST to our ingest endpoint | Errors are raised **per Zap, not per task**. Caveats: fires only if error email notifications are enabled (frequency ≠ "Never"); with **Autoreplay on, it fires only after all replay attempts finish** (up to ~10.5 h after the first failure); Webhooks by Zapier is a premium app (paid plans); on Team/Enterprise, notifications go to the Zap's creator. |
| Deactivation detection | Zapier Manager `Zap Turned Off` trigger → same webhook | Zapier **auto-disables** a Zap when ≥95% of its runs errored over 7 days (Team: email + 24 h grace; Enterprise: 72 h + per-Zap override). Also fires for plan/billing/app-disconnection pauses. |
| Halted tasks | Zapier Manager `New Halted Task` trigger | Optional third feed. |
| Pull / reconciliation | **None available.** | The Workflow API (formerly Partner API) requires owning a public Zapier integration (partner status); its zap-runs endpoint is experimental/unsupported. No customer-facing run-history API. |
| Retry | **No API.** | Autoreplay (Professional+, account-wide) retries a failed step 5× over ~10.5 h. Manual *Replay* exists in Zap History — our "Retry" button for Zapier is a **deep link to Zap History**, not an API call. |
| Email fallback | Error notification emails (Immediately / hourly summary) | Keep enabled (required for Manager triggers anyway). Optional later: forward to a parsed mailbox as a second reconciliation channel. |

Key doc URLs are collected in §7.

### 2.3 What this means for the design

1. **Push is the backbone; only N8N gets a reconciliation poll.** Design the ingest endpoint
   so a missed push is recoverable for N8N and merely *detectable* for Zapier (email safety
   net).
2. **Normalize at the edge.** The two platforms send very different payloads; the error-handler
   workflow / Zap maps them into one envelope so the API stays platform-agnostic (adding
   Make.com etc. later = one new sender, zero API changes).
3. **Retry is asymmetric.** N8N: real API retry. Zapier: deep link + rely on Autoreplay. The
   UI must not pretend otherwise.
4. **Zapier's 10.5 h Autoreplay delay** means "time we learn about it" ≠ "time it broke".
   Store `occurred_at` (platform's timestamp) separately from `received_at`.

---

## 3. Architecture

```
 N8N error-handler workflow ──┐
 (Error Trigger → HTTP POST)  │
                              ├──▶ POST /api/ingest/workflow-events ──▶ workflow_failure_events
 Zapier Manager zaps ─────────┘        (per-source token, idempotent,         │
 (New Zap Error / Zap Turned           zod-validated envelope)                │
  Off → Webhooks POST)                                                        ▼
                                                                    ┌─ Failure Inbox (dashboard, SSE)
 Worker (BullMQ, Phase B):                                          ├─ Incident engine + alert rules (M3)
  • n8n executions sweep (status=error, cursor)  ──▶ upsert ────────┤   → email / Slack / Teams
  • n8n workflows active-state diff              ──▶ events         └─ Actions: retry (n8n API) / ack /
                                                                        resolve / ignore / assign / open
```

### 3.1 Ingest endpoint

`POST /api/ingest/workflow-events`

- **Auth:** per-source static bearer token (random 256-bit, stored **hashed** in
  `workflow_sources.ingest_token_hash`); rate-limited per source. Service-role DB access as
  per shared-DB rules — this is an API-side endpoint, never direct-to-DB.
- **Idempotency:** unique on `(source_id, event_type, external_execution_id)`; Zapier events
  without an execution id fall back to a payload hash + time bucket. Replays return `200`
  with the existing event id (commandment #3).
- **Envelope** (zod schema in `packages/shared`):

```jsonc
{
  "platform": "n8n",                      // n8n | zapier | make | other
  "event_type": "execution_failed",      // execution_failed | workflow_deactivated | task_halted
  "workflow": { "external_id": "...", "name": "..." },
  "execution": { "external_id": "...", "url": "...", "retry_of": null },
  "error": { "message": "...", "node": "...", "stack": "..." },
  "occurred_at": "2026-08-25T09:12:00Z",
  "raw": { /* platform payload, passthrough */ }
}
```

- **Raw payload caution:** n8n error payloads can contain node data. Store `raw` but truncate
  large bodies and never request `includeData=true` on the sweep. Flag for review whether
  `raw` needs the same masking treatment as monitor response bodies.

### 3.2 Data model additions (schema `awm_monitoring`)

All shared-DB rules apply: TIMESTAMPTZ, `ON DELETE RESTRICT`, soft delete, enums
(lowercase snake_case), `org_id` on every table. Shipped as reviewed SQL through Colin
(next numbered file after `0001_init.sql`), mirrored in `schema.prisma` + shared zod enums.

**New enums**

- `workflow_platform`: `n8n | zapier | make | other`
- `workflow_event_type`: `execution_failed | workflow_deactivated | task_halted`
- `workflow_event_status`: `new | acknowledged | investigating | retried | resolved | ignored`

**`workflow_sources`** — one row per connected platform instance

| column | notes |
|---|---|
| `id`, `org_id`, `project_id?` | org-scoped like everything else |
| `platform` | enum |
| `name`, `base_url` | e.g. "AWM n8n", `https://….app.n8n.cloud` |
| `api_key_encrypted` | AES-256-GCM app-side (n8n key; null for Zapier). Never returned to frontend. |
| `ingest_token_hash` | SHA-256 of the per-source ingest bearer token |
| `sweep_enabled`, `last_swept_at`, `sweep_cursor` | reconciliation state (n8n only) |
| soft-delete triple + audit timestamps | |

**`workflow_failure_events`** — the inbox rows

| column | notes |
|---|---|
| `id`, `org_id`, `source_id` (FK RESTRICT) | |
| `event_type`, `status` | enums above |
| `external_workflow_id`, `external_workflow_name` | |
| `external_execution_id?`, `execution_url?` | null for trigger-node failures / deactivations |
| `error_message`, `error_node?` | message truncated + indexed for dedup |
| `raw_payload JSONB` | truncated passthrough |
| `occurred_at`, `received_at` | platform time vs ingest time |
| `acknowledged_by?`, `acknowledged_at?`, `resolved_at?`, `assigned_to?` | |
| `retried_at?`, `retry_execution_id?` | n8n retry bookkeeping |
| `incident_id?` (FK RESTRICT, nullable) | linked when the M3 incident engine lands |
| `ingest_channel` | enum-ish: `push | sweep` — measures how much the sweep catches |
| soft-delete triple | no hard deletes |

Index: `(org_id, status, received_at desc)` for the inbox; unique partial index for the
idempotency key.

### 3.3 Sender side

**N8N (two workflows, built once):**

1. **Global error handler** — Error Trigger → (optional Set node normalizing the envelope) →
   HTTP Request POST to our ingest endpoint with the source token. Handles both payload
   shapes (node failure vs trigger failure).
2. **Watchdog** — Schedule Trigger (e.g. hourly) → n8n API: list workflows → set
   `errorWorkflow` on any workflow missing it (template #2169 pattern). Solves "new workflows
   silently unmonitored", which is exactly Colin's concern.

**Zapier (two or three Zaps):** `New Zap Error` → Webhooks POST; `Zap Turned Off` → Webhooks
POST; optionally `New Halted Task`. Prereq: error notifications not set to "Never" on the
owning account.

### 3.4 Worker reconciliation (Phase B, n8n only)

BullMQ repeatable job per n8n source (~5 min):

- `GET /api/v1/executions?status=error&cursor=…` from the stored cursor; upsert anything the
  push missed (`ingest_channel = 'sweep'`).
- Also sweep `status=crashed` and `canceled` (crashed executions never run the error
  workflow).
- Daily `GET /api/v1/workflows` diff → `workflow_deactivated` events on `active` flips we
  didn't cause.

### 3.5 Dashboard: Failure Inbox

New page in `apps/dashboard` (first routed page — router lands with it):

- Unified list across sources: platform badge, workflow name, error message, failed node,
  occurred/received times, status chip, assignee. Filters: platform, status, workflow,
  date. Live via SSE (consistent with the plan's realtime decision), TanStack Query cache.
- Row actions:
  - **Open execution** — deep link (`execution.url` for n8n; Zap History URL for Zapier).
  - **Retry** — n8n only: API proxies `POST /executions/{id}/retry`, records
    `retry_execution_id`, audit-logged. Hidden/disabled for Zapier with an explainer
    ("Zapier retries automatically via Autoreplay; replay manually from Zap History").
  - **Acknowledge / Resolve / Ignore / Assign** — status transitions, all audit-logged,
    Operator+ role.
- Overview page gets a "Workflow failures (24 h)" tile feeding from the same table.

### 3.6 Alerting

- **Now:** existing N8N/Zapier emails keep flowing (Zapier requires them anyway).
- **With M3:** failure events run through the incident engine — dedup signature
  `(org_id, source_id, external_workflow_id, normalized error)` in a time window, so a Zap
  failing 200× overnight is one incident. Alert rules route to email/Slack/Teams channels.
  The unified interface then *replaces* inbox-watching, not just mirrors it.

### 3.7 In-place remediation (retry *and fix* without opening the platform)

Requirement from Tumisang (2026-08-25): resolving a failure should not require opening
n8n/Zapier. Three remediation levels, all surfaced in the drawer:

| Level | n8n | Zapier |
|---|---|---|
| **Retry as-is** | `POST /api/v1/executions/{id}/retry` | No API. Autoreplay (automatic) + Zap History deep link |
| **Fix the data** ("edit & resubmit") | Show the captured trigger payload, let the user edit the JSON, re-POST to the workflow's webhook URL → fresh execution | Same pattern via the Zap's **catch URL** — works for webhook-triggered Zaps only |
| **Fix the workflow** | AI-suggested patch (generated from workflow JSON + error context) → human approves → `PUT /api/v1/workflows/{id}` → retry with `loadWorkflow: true` so the retry runs the fixed version. Also: re-register lost webhooks via `POST /workflows/{id}/deactivate` + `/activate` | **Not possible** — no public API to edit or run Zaps. Deep link only |

Design rules:

1. **Human approval always.** A suggested fix is a proposal card (summary + concrete changes +
   the exact API mechanism); nothing touches the platform until "Apply fix & retry" is
   clicked. Every apply is audit-logged with the before/after workflow version.
2. **Version safety.** Before `PUT /workflows/{id}`, re-fetch the workflow and diff against
   the version the suggestion was generated from; abort with a "workflow changed since"
   error rather than clobbering a concurrent edit. n8n keeps workflow history for rollback.
3. **Suggestion generation** is a backend concern (worker calls the Claude API with the
   workflow JSON + error + failed node; strips credentials first). The contract field is
   `fix_suggestion` on the event; the UI is already built against it.
4. **Resubmit capture** requires the ingest side to store `input_payload` (truncated,
   secrets-stripped) — the n8n error-handler workflow forwards the trigger item; Zapier's
   Manager trigger does not include run data, so for Zapier the payload comes from the
   original catch-URL request only if the Zap is fronted by our relay (optional later) —
   otherwise resubmit is offered without prefill.
5. **New risk:** this upgrades the n8n API key from read+retry to **write** scope
   (`PUT /workflows`). Without Enterprise scopes that key already had full access; the
   mitigation is unchanged (encrypted at rest, backend only) plus the approval gate and
   version check above.

---

## 4. Phasing (against IMPLEMENTATION_PLAN.md)

| Phase | Contents | Depends on |
|---|---|---|
| **A — Failure Inbox slice** | Enums + 2 tables (reviewed SQL → Colin), ingest endpoint + token auth, n8n error-handler + watchdog workflows, Zapier Manager zaps, inbox page with open/ack/resolve/ignore actions | M1 auth/RBAC (guards exist before exposing actions); Colin: schema + credentials |
| **B — Reconciliation + retry** | n8n sweep job in worker (first BullMQ consumer — pathfinds M2's scheduler), active-state diff, retry proxy + AES-256-GCM secret utility (also needed by M2), SSE live updates | Redis provisioned; n8n API key; instance version ≥ 2025-09-15 for public retry |
| **C — Incident integration** | Events → incidents (dedup), alert rules → channels, MTTR reporting includes workflow failures | M3 incident engine |

Phase A/B deliberately front-load two things M2/M3 need anyway (secret encryption, first
BullMQ consumer, SSE plumbing), so this isn't a detour from the MVP path.

---

## 5. Risks & caveats

1. **Zapier visibility ceiling** — no run-history API; if the Manager Zap itself is off or
   notifications are disabled, we're blind. Mitigation: the Manager Zaps are themselves
   monitored (heartbeat-style "canary" check in Phase C), and error emails stay on.
2. **Autoreplay delay** — Zapier error events can arrive ~10.5 h late by design. Surface
   `occurred_at` prominently.
3. **n8n retry endpoint version gate** — public only since 2025-09-15 release; confirm the
   instance version before promising the button.
4. **n8n API key blast radius** — no scopes below Enterprise; key must be AES-encrypted at
   rest, worker/API only, never sent to the dashboard.
5. **Error-workflow coverage drift** — new n8n workflows don't inherit an error workflow;
   the watchdog closes this, but it must itself be watched.
6. **`raw_payload` may contain client data** — truncate, never sweep with `includeData`,
   and review masking needs.

## 6. Open questions for the team

1. **Colin:** approve the two tables + three enums as reviewed SQL; confirm schema/credential
   timing (this is the first real DB dependency of the build).
2. **Armand/Joshua:** which n8n instance(s) and version? Cloud or self-hosted? Who creates
   the API key?
3. **Zapier plan check:** are we Professional+ (Autoreplay, Webhooks premium app)? Who owns
   the account the Manager Zaps must live under (Team plans notify the Zap creator)?
4. Should Make.com (or anything else) be in scope for the envelope from day one? (Costs
   nothing — it's just an enum value.)
5. Do we keep per-workflow error emails once inbox + channel alerts are live, or downgrade
   them to hourly summaries?

## 7. Sources

- n8n Error Trigger: <https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.errortrigger>
- n8n error handling: <https://docs.n8n.io/build/flow-logic/handle-errors-gracefully>
- n8n API — executions (list/retry/stop): <https://docs.n8n.io/connect/n8n-api/execution>
- n8n API auth: <https://docs.n8n.io/connect/n8n-api/authentication>
- n8n log streaming (Enterprise): <https://docs.n8n.io/administer/observe-and-log/stream-logs-to-external-systems>
- n8n watchdog template: <https://n8n.io/workflows/2169-watchdog-update-all-workflows-with-default-error-workflow/>
- n8n API list bugs: GitHub n8n-io/n8n #20706, #14748, #31427
- Zapier error notifications: <https://help.zapier.com/hc/en-us/articles/8496289225229>
- Zapier troubleshooting/auto-off: <https://help.zapier.com/hc/en-us/articles/8496037690637>, grace period: <https://help.zapier.com/hc/en-us/articles/19532291509901>
- Zapier Manager troubleshooting: <https://help.zapier.com/hc/en-us/articles/8496200014477>
- Zapier replay/Autoreplay: <https://help.zapier.com/hc/en-us/articles/8496241726989>, <https://help.zapier.com/hc/en-us/articles/19220226086797>
- Zapier error-handler template: <https://zapier.com/shared/error-zap-error-handler/75279b0b1896449d475f25872637cc8d41346478>
- Zap-history API status (partner-only/experimental): <https://community.zapier.com/general-discussion-13/zap-history-rest-api-37249>
