# Track your API usage in AWM Monitoring

Feed this document to an app that should report **how much it uses third-party APIs**
(Insightly, Asana, OpenAI, Twilio, …) to AWM Monitoring at
**https://awmappmonitor.ascotwm.com**. The org gets one Reports view answering
"who is consuming which provider, how much, trending how" — and spike/error visibility
before a provider quota kills a workflow.

Uses the **same ingest token** as failure reporting (CONNECT_APP.md). If the app isn't
connected yet, do that first.

## The contract

Count outbound calls per provider in the app, and flush the counters every 1–5 minutes:

```
POST https://awmappmonitor.ascotwm.com/api/ingest/usage
Authorization: Bearer <MONITORING_INGEST_TOKEN>
Content-Type: application/json
```

| Field | Required | Notes |
|---|---|---|
| `provider` | yes | Lowercase provider name — use the same spelling everywhere: `insightly`, `asana`, `openai`, `twilio`, `supabase`, `graph` |
| `calls` | yes | Calls made since the last report |
| `errors` | no | How many of them failed (4xx/5xx/timeout) |
| `units` | no | Extra counters, e.g. `{ "tokens": 8123 }` for LLMs, `{ "sms": 4 }` for Twilio |
| `window_start` / `window_end` | yes | ISO-8601 with offset — the period the counters cover |

Response: `200 {"ok":true,"bucket":"2026-09-02"}`. Reports are **additive** — each flush adds
to that UTC day's bucket, so restart-and-resend never needs reconciliation. `401` = bad token.

## Drop-in middleware (JavaScript / TypeScript)

Wrap the app's HTTP client once; everything else is automatic:

```js
// usage-meter.js — count calls per provider, flush every 60s
const counters = new Map(); // provider -> { calls, errors }
let windowStart = new Date().toISOString();

export function countApiCall(provider, ok) {
  const c = counters.get(provider) ?? { calls: 0, errors: 0 };
  c.calls += 1;
  if (!ok) c.errors += 1;
  counters.set(provider, c);
}

async function flush() {
  const windowEnd = new Date().toISOString();
  for (const [provider, c] of counters) {
    counters.delete(provider);
    try {
      await fetch("https://awmappmonitor.ascotwm.com/api/ingest/usage", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.MONITORING_INGEST_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ provider, ...c, window_start: windowStart, window_end: windowEnd }),
      });
    } catch {
      // put the numbers back so nothing is lost on a blip
      const prev = counters.get(provider) ?? { calls: 0, errors: 0 };
      counters.set(provider, { calls: prev.calls + c.calls, errors: prev.errors + c.errors });
    }
  }
  windowStart = windowEnd;
}
setInterval(flush, 60_000).unref?.();
```

Then at every provider call site (or in one shared fetch wrapper):

```js
const res = await fetch(insightlyUrl, opts);
countApiCall("insightly", res.ok);
```

## Python

```python
import os, threading, datetime, requests
from collections import defaultdict

_counters = defaultdict(lambda: {"calls": 0, "errors": 0})
_window_start = datetime.datetime.now(datetime.timezone.utc).isoformat()

def count_api_call(provider: str, ok: bool):
    c = _counters[provider.lower()]
    c["calls"] += 1
    if not ok:
        c["errors"] += 1

def _flush():
    global _window_start
    end = datetime.datetime.now(datetime.timezone.utc).isoformat()
    for provider in list(_counters):
        c = _counters.pop(provider)
        try:
            requests.post(
                "https://awmappmonitor.ascotwm.com/api/ingest/usage",
                headers={"Authorization": f"Bearer {os.environ['MONITORING_INGEST_TOKEN']}"},
                json={"provider": provider, **c, "window_start": _window_start, "window_end": end},
                timeout=10,
            )
        except Exception:
            back = _counters[provider]
            back["calls"] += c["calls"]; back["errors"] += c["errors"]
    _window_start = end
    threading.Timer(60, _flush).start()

threading.Timer(60, _flush).start()
```

## Where it shows up

**https://awmappmonitor.ascotwm.com/#/reports → API usage**: per provider — calls today, 7-day
totals, 7-day errors, which apps are consuming it, and a 14-day trend. Provider **quota
warnings** (rate-limit headers) live separately on the integration monitors and don't require
this middleware.

## Rules

- Counters and flushes must **never block or crash the app** — fire-and-forget, short timeouts.
- Flush every 1–5 minutes; don't report per request.
- Use consistent lowercase provider names — they're the grouping key across the whole org.
