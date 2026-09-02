# Connect Zapier to AWM Monitoring

Zapier has no customer-facing API for listing Zaps or reading Zap run history
(the zap-runs endpoint is partner-only — verified, returns 403). So Zapier
failures reach the Failure Inbox by **push**: two small Zaps built with the
**Zapier Manager** app forward every error and every auto-turned-off Zap to our
ingest endpoint. Build them once; they cover the whole Zapier account.

- Ingest endpoint: `https://awmappmonitor.ascotwm.com/api/ingest/workflow-events`
- Auth: `Authorization: Bearer <ZAPIER INGEST TOKEN>` — the value of
  `PROD_INGEST_TOKEN_ZAPIER` (ask Tumisang; never commit it to a repo or paste
  it into a Zap's name/notes).
- Events land in the dashboard → **Workflow failures**, deduplicated, with
  acknowledge/resolve/assign and (for webhook-triggered Zaps) edit-&-resubmit.

---

## Zap 1 — “AWM Monitor: Zap errors”

Forwards every failed Zap run.

### Step 1: Trigger — Zapier Manager → **New Zap Error**

| Setting | Value |
| --- | --- |
| App | Zapier Manager |
| Trigger event | New Zap Error |
| Account | the AWM Zapier account |
| Which Zaps | All Zaps (leave the filter empty) |

### Step 2: Action — Webhooks by Zapier → **Custom Request**

| Setting | Value |
| --- | --- |
| App | Webhooks by Zapier |
| Action event | Custom Request |
| Method | `POST` |
| URL | `https://awmappmonitor.ascotwm.com/api/ingest/workflow-events` |
| Data pass-through | No |
| Unflatten | Yes |

**Data** (paste, then replace each `{{...}}` with the matching field from the
Step-1 dropdown — names in Zapier Manager's sample: `title`, `id`,
`error_message`, `url`, `date`):

```json
{
  "platform": "zapier",
  "event_type": "execution_failed",
  "workflow": {
    "external_id": "{{Zap ID}}",
    "name": "{{Zap Title}}"
  },
  "execution": {
    "external_id": "{{Task ID}}",
    "url": "{{Task URL}}"
  },
  "error": {
    "message": "{{Error Message}}"
  },
  "occurred_at": "{{Error Date (ISO-8601)}}",
  "raw": {
    "zap_url": "{{Zap URL}}"
  }
}
```

**Headers:**

| Key | Value |
| --- | --- |
| `Authorization` | `Bearer <ZAPIER INGEST TOKEN>` |
| `Content-Type` | `application/json` |

Notes for the builder:

- `occurred_at` must be an ISO-8601 datetime **with offset**
  (e.g. `2026-09-02T10:15:00Z`). If Zapier Manager's date field isn't ISO,
  add a Formatter step (Date/Time → Format → `YYYY-MM-DDTHH:mm:ssZ`) between
  trigger and webhook.
- If a field has no Task ID/URL for a given error, leave the mapping — the
  endpoint accepts a null execution; the event just loses its deep link.
- Test: press *Test step*. Expected response: `200` with
  `{"id":"…","duplicate":false}`. A `401` means the bearer token is wrong;
  a `400` lists exactly which field failed validation.

---

## Zap 2 — “AWM Monitor: Zap turned off”

Zapier auto-disables a Zap after repeated failures — that's the silent killer
this catches.

### Step 1: Trigger — Zapier Manager → **Zap Turned Off**

Same account, all Zaps.

### Step 2: Action — Webhooks by Zapier → **Custom Request**

Method, URL and headers identical to Zap 1. **Data:**

```json
{
  "platform": "zapier",
  "event_type": "workflow_deactivated",
  "workflow": {
    "external_id": "{{Zap ID}}",
    "name": "{{Zap Title}}"
  },
  "error": {
    "message": "Zap was turned off ({{Reason, or 'no reason given'}})"
  },
  "occurred_at": "{{Turned Off Date (ISO-8601)}}",
  "raw": {
    "zap_url": "{{Zap URL}}"
  }
}
```

The inbox shows these as **Workflow deactivated** — they stay in the
needs-attention count until someone resolves them, because a disabled Zap
fails silently forever.

---

## Optional Zap 3 — “AWM Monitor: Zap throttled”

Zapier Manager also has **Zap Flood Detected** (a Zap suddenly processing an
unusual task volume) and **New Halted Task**. Either can be forwarded with the
same webhook shape — use `event_type: "task_halted"` for halted tasks and put
the specifics in `error.message`.

---

## What this enables (and what it can't)

| Capability | Status |
| --- | --- |
| Failed Zap runs in the inbox, deduplicated | ✅ via Zap 1 |
| Auto-turned-off Zaps flagged | ✅ via Zap 2 |
| Error payload copy / troubleshooting from the dashboard | ✅ |
| Edit & resubmit trigger data | ✅ only for webhook-triggered Zaps (re-posts to the catch URL) |
| Retry a failed run from the dashboard | ❌ no Zapier API — use Autoreplay/Zap History |
| Turn a Zap on/off from the dashboard | ❌ not with API keys; possible later through a Zapier MCP connection |
| List all Zaps in the Automations inventory | ⚠️ push-only: `POST /api/internal/zap-inventory` accepts a snapshot (worker token) when one is exported |

## Checklist before switching both Zaps on

- [ ] Both Zaps live in a shared/team folder, not a personal one
- [ ] Bearer token came from the env secret, not typed from memory
- [ ] Test step returned `200 {"duplicate":false}` and the event appeared at
      https://awmappmonitor.ascotwm.com/#/workflow-failures
- [ ] The Zaps themselves are excluded from "All Zaps" filters if Zapier offers
      the option (avoids error loops if the webhook endpoint is ever down)
