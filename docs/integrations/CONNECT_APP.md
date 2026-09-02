# Connect an app to AWM Monitoring — failure reporting

Feed this document to the app (or its developer/agent) that should report failures into the
AWM Monitoring failure inbox at **https://awmappmonitor.ascotwm.com**.

Once connected, every failure the app reports appears in the team's unified inbox within
seconds — with the error message, stack trace, and payload — where it can be assigned,
tracked, retried, and alerted on.

## One-time setup (done by an AWM operator, not the app)

1. Open **https://awmappmonitor.ascotwm.com → Workflow failures → + Connect app**.
2. Name the app, pick platform **Custom app / script** (or Make/n8n/Zapier if applicable).
3. Copy the **ingest token** shown — it is displayed exactly once (only its hash is stored).
4. Put the token in the app's secrets as `MONITORING_INGEST_TOKEN`. Never commit it.

## The contract

**One HTTP call from the app's error/catch path:**

```
POST https://awmappmonitor.ascotwm.com/api/ingest/workflow-events
Authorization: Bearer <MONITORING_INGEST_TOKEN>
Content-Type: application/json
```

### Envelope

| Field | Required | Notes |
|---|---|---|
| `platform` | yes | Must match the platform chosen at connect time: `custom_app`, `make`, `n8n`, `zapier`, or `other` |
| `event_type` | yes | `execution_failed` (a run failed) · `workflow_deactivated` (the automation was switched off) · `task_halted` (a run stopped without completing) |
| `workflow.external_id` | yes | Stable id of the job/flow inside the app, e.g. `"lead-import"` |
| `workflow.name` | yes | Human name shown in the inbox, e.g. `"Lead import"` |
| `execution.external_id` | recommended | Id of this specific run — **this is the idempotency key**; replays with the same id are deduplicated safely |
| `execution.url` | optional | Deep link to the run in the app's own UI ("Open execution" button) |
| `error.message` | yes | What went wrong (max 4000 chars) |
| `error.node` | optional | The step/function that failed |
| `error.stack` | optional | Stack trace (max 20000 chars) — shown with a copy button |
| `input_payload` | optional | The trigger data that fed the failed run — enables in-dashboard **Edit & resubmit** |
| `resubmit_url` | optional | A webhook URL that re-runs the job when POSTed the (edited) payload — required for Edit & resubmit |
| `occurred_at` | yes | ISO-8601 with offset, e.g. `2026-09-02T08:15:00.000Z` |
| `raw` | optional | Any extra context object (truncate large blobs) |

**Response:** `200 {"id":"...","duplicate":false}` — `duplicate: true` means this exact run was
already reported (safe; nothing was double-counted). `401` = wrong/missing token.
`400` = envelope validation failure, with a list of the offending fields.

## Drop-in snippets

### JavaScript / TypeScript (in the catch block)

```js
async function reportFailure(error, runId) {
  try {
    await fetch("https://awmappmonitor.ascotwm.com/api/ingest/workflow-events", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.MONITORING_INGEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        platform: "custom_app",
        event_type: "execution_failed",
        workflow: { external_id: "lead-import", name: "Lead import" },
        execution: { external_id: runId },
        error: { message: error.message, stack: error.stack ?? null },
        occurred_at: new Date().toISOString(),
      }),
    });
  } catch {
    // never let monitoring take the app down — swallow reporting errors
  }
}
```

### Python

```python
import os, datetime, requests

def report_failure(exc, run_id, job_id="lead-import", job_name="Lead import"):
    try:
        requests.post(
            "https://awmappmonitor.ascotwm.com/api/ingest/workflow-events",
            headers={"Authorization": f"Bearer {os.environ['MONITORING_INGEST_TOKEN']}"},
            json={
                "platform": "custom_app",
                "event_type": "execution_failed",
                "workflow": {"external_id": job_id, "name": job_name},
                "execution": {"external_id": run_id},
                "error": {"message": str(exc)},
                "occurred_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            },
            timeout=10,
        )
    except Exception:
        pass  # monitoring must never crash the app
```

### curl (smoke test after wiring the token)

```bash
curl -X POST https://awmappmonitor.ascotwm.com/api/ingest/workflow-events \
  -H "Authorization: Bearer $MONITORING_INGEST_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "platform": "custom_app",
    "event_type": "execution_failed",
    "workflow": { "external_id": "smoke-test", "name": "Smoke test" },
    "execution": { "external_id": "test-1" },
    "error": { "message": "connection test — please ignore/resolve" },
    "occurred_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"
  }'
```

A successful test appears at https://awmappmonitor.ascotwm.com/#/workflow-failures within ~15s.

## Rules

- **Report failures only.** "It ran fine" belongs to a heartbeat monitor (see NEW_MONITOR.md),
  not this endpoint.
- **No client personal data** in `error.*`, `input_payload`, or `raw` — ids and technical
  context only; truncate anything large.
- **Never block on reporting.** Wrap the call in try/catch with a short timeout.
- Duplicate sends are safe by design — retry the report on network failure if you like.
