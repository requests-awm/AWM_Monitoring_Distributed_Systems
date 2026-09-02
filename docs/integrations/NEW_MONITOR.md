# Add an app to AWM Monitoring — external checks & job heartbeats

Feed this document to the app (or its developer/agent) that should be **monitored** by
AWM Monitoring at **https://awmappmonitor.ascotwm.com**. This covers the outside-in checks
(uptime, SSL, response times) and the heartbeat pings that prove scheduled jobs actually ran.
For reporting *failures with error details*, use CONNECT_APP.md instead — most apps want both.

## Monitor types — what the app must provide

An AWM operator creates the monitor in the dashboard (**Monitors → + New monitor**); the
table below is what they need from the app's side.

| Monitor type | The app provides | The platform then detects |
|---|---|---|
| **HTTP / website** | A URL we may poll (ideally a `/health` endpoint), the expected status code, optionally a keyword the body must contain and a max response time | Downtime, wrong responses, slowness — checked every 1–60 min |
| **Third-party integration** | Base URL + a **read-only** credential + a safe endpoint (never a real client record — use a dedicated test record) | Auth failures, permission errors, rate limiting, timeouts |
| **TCP port** | Host + port | Listener down / unreachable |
| **SSL certificate** | Hostname (port 443 assumed) | Expiry warnings at 30/14/7/1 days, invalid/untrusted certs |
| **Email provider** | SMTP host + port (e.g. `smtp.gmail.com:465`) | Provider unreachable / bad banner |
| **Heartbeat (scheduled job)** | One line of code in the job — see below | The job **not running** (missed schedule), and job-reported failures |

### Recommended `/health` endpoint (for HTTP monitors)

Fast (<1s), no side effects, returns `200` with a stable keyword:

```json
{ "status": "ok", "service": "your-app" }
```

If the endpoint must be protected, provide an API key/bearer for the check — it is stored
encrypted and only ever used read-only.

## Heartbeats — proving scheduled jobs ran

Push-based failure reporting only catches jobs that fail *loudly*. A job that silently never
starts (dead cron, disabled trigger) sends nothing — heartbeats close that gap.

**Setup:** the operator creates a Heartbeat monitor (expected interval + grace minutes) and
hands the app its **ping URL**: `https://awmappmonitor.ascotwm.com/api/heartbeats/<TOKEN>`.
Store the token as `MONITORING_HEARTBEAT_URL` in the app's secrets.

**Contract:** the job POSTs on every run. If no ping arrives within
`expected interval + grace`, the platform raises a **missed-job incident**; the next
successful ping auto-resolves it.

```
POST https://awmappmonitor.ascotwm.com/api/heartbeats/<TOKEN>
Content-Type: application/json
```

| Body field (all optional) | Meaning |
|---|---|
| `event_type` | `success` (default) · `failure` (job ran but failed — creates a failure event) · `started` · `completed` |
| `job_name` | Which job, if the monitor covers several |
| `records_processed`, `records_failed` | Throughput numbers, shown in the run history |
| `duration_ms` | How long the run took |
| `error_message` | Required context when `event_type` is `failure` |

### Snippets

```js
// End of a successful run:
await fetch(process.env.MONITORING_HEARTBEAT_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ event_type: "success", records_processed: count, duration_ms: ms }),
}).catch(() => {}); // never let monitoring take the job down

// In the catch block:
await fetch(process.env.MONITORING_HEARTBEAT_URL, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ event_type: "failure", error_message: String(err) }),
}).catch(() => {});
```

```bash
# cron one-liner (append after the job command):
&& curl -s -X POST "$MONITORING_HEARTBEAT_URL" -H "Content-Type: application/json" -d '{"event_type":"success"}'
```

```python
import os, requests
def ping(event="success", **fields):
    try:
        requests.post(os.environ["MONITORING_HEARTBEAT_URL"],
                      json={"event_type": event, **fields}, timeout=10)
    except Exception:
        pass
```

## What happens on the platform side

- Failures open **incidents** with deduplication (one outage = one incident), auto-resolve on
  recovery, and escalation that stops on acknowledge.
- Alerts route by severity to the configured channels (email/SMS/WhatsApp/Slack/Teams/Asana/webhook).
- Uptime, response times, incident counts, and MTTA/MTTR appear in the **Reports** tab with
  CSV export; scheduled **maintenance windows** suppress alerts during planned work.

## Rules

- Heartbeat pings and health endpoints must **never block or crash the app** — fire-and-forget
  with short timeouts.
- Choose the expected interval honestly (a nightly job = 1440 min, not 60) and give a grace
  period covering normal jitter.
- Integration checks must use dedicated test records/endpoints — never real client data.
