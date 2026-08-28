# Performance Testing Plan — AWM Monitoring System

Companion to [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md). Defines NFRs, workload models,
tooling, environments, and CI integration for performance testing, adapted to the locked stack.

**Tooling decision: [k6](https://k6.io) (Grafana k6), not JMeter.**
Rationale: tests are written in JS/TS (matches the team and monorepo), k6 `thresholds` map
directly to our NFRs and fail the process (exit code ≠ 0) when breached — which is exactly
what a CI gate needs — and it runs as a single container with no Java runtime. JMeter remains
a fallback if we ever need protocol coverage k6 lacks; nothing else in this plan changes if so.

**Not adopted from the generic strategy (and why):**
- **Kubernetes/Helm** — we deploy to Render/Railway, not K8s. Docker Compose is the perf environment.
- **Testcontainers-per-test** — a dedicated `docker-compose.perf.yml` is simpler and closer to prod shape.
- **Datadog / JMeter PerfMon** — server-side metrics come from our own `/health` + `prom-client`
  metrics endpoints (we're building a monitoring platform; commandment 4 already requires structured
  observability). Prometheus + Grafana are optional add-ons, not prerequisites.

---

## 0. Non-negotiable rule

> **Performance tests never point at the AWM shared Supabase instance. Ever.**
> Load tests run against a local Postgres container (or, for low-rate smoke tests only, the
> dev Supabase project). The shared instance serves other AWM apps; saturating it is an outage
> we cause. This overrides anything else in this document.

---

## 1. NFRs / SLOs

Stored in `perf/nfrs.yaml` — the single source referenced by k6 thresholds, CI gates, and
(later) the platform's own self-monitoring alerts.

```yaml
# perf/nfrs.yaml
# All latencies in milliseconds. Percentiles measured under the stated workload model.
api:
  read_endpoints:            # GET /monitors, /incidents, /overview
    p95_ms: 300
    p99_ms: 800
    error_rate_max: 0.01
  write_endpoints:           # POST/PATCH monitors, ack/resolve incidents
    p95_ms: 500
    p99_ms: 1200
    error_rate_max: 0.01
  heartbeat_ingest:          # POST /api/heartbeats/{token} — highest-volume public endpoint
    p95_ms: 150
    p99_ms: 400
    error_rate_max: 0.001
    throughput_rps_min: 100
  sse:
    connect_p95_ms: 1000
    event_delivery_p95_ms: 2000   # worker result -> dashboard event
worker:
  check_execution:
    scheduled_to_started_p95_ms: 5000   # BullMQ queue latency at scale
    monitors_per_minute_min: 500        # sustained executor throughput
    missed_job_rate_max: 0.001
resources:                   # sampled during soak tests via /metrics + docker stats
  api_cpu_pct_max: 70
  worker_cpu_pct_max: 80
  memory_pct_max: 80
  memory_growth_soak: none   # no monotonic growth over a 2h soak = no leak
```

Numbers are initial targets — revisit after the first baseline run in M6 and tighten/loosen
with evidence, not guesses. Any change is a commit to this file with a reason.

## 2. Workload models

Modelled on what the platform actually does. The dominant load is **machine traffic**
(heartbeat ingest + worker check execution), not human dashboard users.

| Model | Shape | Purpose |
|---|---|---|
| **Smoke** | 5 VUs, 1 min, reads + 1 rps heartbeats | Regression gate on every PR |
| **Normal** | 20 dashboard VUs + 50 rps heartbeats + 200 active monitors, 10 min | Everyday load |
| **Peak** | 50 VUs + 150 rps heartbeats + 1000 active monitors, 15 min | Launch-scale target |
| **Spike** | Normal → 10× heartbeat rate for 2 min → normal | Mass-outage burst (every client's jobs fail at once — our worst realistic case) |
| **Soak** | Normal load, 2 hours | Leaks, result-table write degradation, Redis growth |

All five live in one k6 project as [scenarios](https://grafana.com/docs/k6/latest/using-k6/scenarios/),
selected via `--env SCENARIO=`:

```
/perf
  nfrs.yaml
  k6/
    lib/config.js        # loads nfrs.yaml -> k6 thresholds
    lib/auth.js          # get JWT for test user once, share across VUs
    scenarios/
      api-read.js        # dashboard browse journey
      api-write.js       # monitor CRUD + incident ack/resolve
      heartbeat.js       # POST /api/heartbeats/{token} at target rps
      sse.js             # connect, hold, measure event latency
    main.js              # scenario definitions: smoke|normal|peak|spike|soak
  seed/seed-perf-data.ts # creates org, users, N monitors, heartbeat tokens
  compare-runs.ts        # baseline comparison (see §7)
  results/               # gitignored k6 summary JSON per run
```

Skeleton of `main.js` (pattern — full journeys land with M6):

```js
import { getThresholds, scenario } from './lib/config.js';

export const options = {
  scenarios: scenario(__ENV.SCENARIO || 'smoke', {
    smoke:  { executor: 'constant-vus', vus: 5, duration: '1m' },
    normal: { executor: 'ramping-vus', stages: [
      { duration: '2m', target: 20 }, { duration: '8m', target: 20 } ] },
    peak:   { executor: 'ramping-vus', stages: [
      { duration: '3m', target: 50 }, { duration: '12m', target: 50 } ] },
    spike:  { executor: 'ramping-arrival-rate', startRate: 50, timeUnit: '1s', stages: [
      { duration: '1m', target: 50 }, { duration: '30s', target: 500 },
      { duration: '2m', target: 500 }, { duration: '1m', target: 50 } ],
      preAllocatedVUs: 200 },
    soak:   { executor: 'constant-vus', vus: 20, duration: '2h' },
  }),
  thresholds: getThresholds(),   // built from perf/nfrs.yaml, e.g.:
  // 'http_req_duration{group:reads}':  ['p(95)<300', 'p(99)<800'],
  // 'http_req_failed{group:reads}':    ['rate<0.01'],
};
```

Worker throughput (`monitors_per_minute_min`) isn't driven by k6 — the seed script enables
N monitors at 1-minute intervals and a checker script reads `monitor_results` counts +
BullMQ queue depth over the run window.

## 3. Test environment

`docker-compose.perf.yml` at repo root: `api` + `worker` (production Dockerfile builds,
prod-like resource limits via `deploy.resources`), `redis`, and **local `postgres`** with the
Prisma schema applied and seeded. Same images CI deploys, `NODE_ENV=production`.

- Resource limits set to match (or a documented fraction of) the Render/Railway plan sizes,
  so results translate. Record the ratio in `perf/nfrs.yaml` comments.
- Seed via `pnpm perf:seed` before any run; the DB is disposable and reset between runs.
- Dashboard is not part of the perf environment — it's static assets; API + SSE are what we load.

## 4. Shift-left / CI integration (GitHub Actions)

Two tiers, per the M6 pipeline:

1. **PR smoke gate** — every PR: spin up `docker-compose.perf.yml`, seed, run
   `SCENARIO=smoke`. k6 exits non-zero on any threshold breach → pipeline fails. ~3 min total.
2. **Nightly full run** — scheduled workflow: `normal` + `peak` + `spike` sequentially,
   `soak` weekly (Sunday). Summary JSON uploaded as artifact; `compare-runs.ts` diffs against
   the stored baseline and fails the job on regression (§7).

```yaml
# .github/workflows/perf-smoke.yml (job excerpt)
perf-smoke:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v4
    - run: docker compose -f docker-compose.perf.yml up -d --wait
    - run: pnpm perf:seed
    - name: k6 smoke (fails on NFR breach)
      run: >
        docker run --rm --network host -v ./perf:/perf grafana/k6 run
        /perf/k6/main.js --env SCENARIO=smoke
        --summary-export /perf/results/smoke-${{ github.sha }}.json
    - uses: actions/upload-artifact@v4
      if: always()
      with: { name: perf-smoke, path: perf/results/ }
```

The nightly workflow is the same shape with `schedule:` cron, the bigger scenarios, and the
compare step.

## 5. Percentile analysis & reporting

- k6 reports avg/med/p90/p95/p99 per metric out of the box; `--summary-export` writes the
  JSON we archive and compare. Tag requests by group (`reads`, `writes`, `heartbeat`, `sse`)
  so percentiles are per-endpoint-class, not blended.
- Optional (post-MVP): k6 → Prometheus remote-write → Grafana dashboard for time-series
  views of long soak runs. Not a gate dependency — the JSON summaries are.

## 6. Server-side monitoring during tests

We are building a monitoring platform — it monitors itself under test:

- **`/metrics`** (prom-client) on api and worker from M6: event-loop lag, heap, GC,
  BullMQ queue depth/latency, Prisma pool usage, per-route histograms. This is the same
  observability commandment 4 already requires — perf tests just consume it.
- `docker stats --format json` sampled to a file during runs for container CPU/memory
  (checked against `resources.*` NFRs, mainly on soak).
- Correlation: every k6 run and metrics sample is stamped with the run id
  (`{scenario}-{git sha}-{timestamp}`), so a latency spike in k6 lines up with queue depth
  or heap growth on the server side.

## 7. Bottleneck loop

1. **Baseline** — first green full run per scenario is committed as
   `perf/baselines/{scenario}.json`.
2. **Compare** — `perf/compare-runs.ts` (Node/TS, run with `tsx`) diffs a new summary against
   the baseline: any p95/p99 regression > 15% or throughput drop > 10% → non-zero exit →
   nightly job fails. Output is a markdown table (posted to the job summary).
3. **Diagnose** — with the run id, pull the correlated `/metrics` + docker-stats samples.
   Usual suspects for this system, in order: `monitor_results` write path (indexes,
   partitioning — see IMPLEMENTATION_PLAN §6), BullMQ/Redis queue latency, Prisma pool
   exhaustion, SSE fan-out, event-loop blocking in executors.
4. **Fix and re-run the identical scenario** — same seed, same env. Improvement is only real
   if the same test shows it.
5. **Re-baseline** deliberately (commit the new JSON with the reason) — never automatically.

## 8. Sequencing into the milestones

| When | What lands |
|---|---|
| **Now (M1)** | `perf/nfrs.yaml` committed; `docker-compose.perf.yml` stub; this doc |
| **M2** | Seed script + first k6 script (HTTP monitor CRUD + reads) usable manually |
| **M6** | `/metrics` endpoints; PR smoke gate in CI; nightly normal+peak; first baselines |
| **Sprint 10** | Spike + soak in rotation; full bottleneck loop drives the planned "performance optimisation" work; Grafana view if wanted |

NFR breaches found before M6 are logged, not blocking; from M6 the smoke gate is enforced.
