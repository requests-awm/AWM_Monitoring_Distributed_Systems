import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type {
  N8nExecutionSummary,
  N8nInsightsDay,
  N8nInsightsPeriod,
  N8nInsightsResponse,
  N8nWorkflowInspection,
} from "@awm/shared";

import { env } from "../config/env";

const CACHE_TTL_MS = 5 * 60_000;
/** Hard cap on history fetched per refresh: 60 pages × 250 = 15k executions. */
const MAX_PAGES = 60;
/** Per-page fetch budget — a hung n8n must fail the page, not the dashboard. */
const FETCH_TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface N8nExecutionRow {
  id: string | number;
  mode?: string;
  status?: string;
  startedAt?: string;
  stoppedAt?: string;
}

/**
 * Rebuilds n8n's Insights numbers (prod executions, failure rate, avg runtime,
 * per-day breakdown) from the public executions API, which has no date filter —
 * we page newest-first and stop once past twice the window (for the
 * previous-period deltas) or at the fetch cap.
 *
 * "Time saved" is deliberately absent: n8n derives it from per-workflow
 * estimates that the public API does not expose.
 */
@Injectable()
export class N8nInsightsService {
  private readonly logger = new Logger(N8nInsightsService.name);
  private readonly cache = new Map<number, { at: number; value: N8nInsightsResponse }>();
  // Single-flight per window: the crawl takes seconds, and the dashboard's
  // retries must join the running refresh, not start parallel ones.
  private readonly inFlight = new Map<number, Promise<N8nInsightsResponse>>();

  async insights(days: number): Promise<N8nInsightsResponse> {
    if (env.N8N_BASE_URL === undefined || env.N8N_API_KEY === undefined) {
      throw new BadRequestException("n8n is not connected — set N8N_BASE_URL and N8N_API_KEY");
    }
    const cached = this.cache.get(days);
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }
    const running = this.inFlight.get(days);
    if (running !== undefined) return running;
    const refresh = this.refresh(days).finally(() => this.inFlight.delete(days));
    this.inFlight.set(days, refresh);
    return refresh;
  }

  private async refresh(days: number): Promise<N8nInsightsResponse> {
    try {
      return await this.rebuild(days);
    } catch (error) {
      // Serve stale numbers over an error page while n8n has a bad moment.
      const stale = this.cache.get(days);
      if (stale !== undefined) {
        this.logger.warn(
          `insights refresh failed — serving stale data from ${stale.value.generatedAt}`,
          { days, error: error instanceof Error ? error.message : String(error) },
        );
        return stale.value;
      }
      throw error;
    }
  }

  private async rebuild(days: number): Promise<N8nInsightsResponse> {
    const now = Date.now();
    const currentStart = now - days * DAY_MS;
    const previousStart = now - 2 * days * DAY_MS;
    const { rows, truncated } = await this.fetchSince(previousStart);

    const current: N8nExecutionRow[] = [];
    const previous: N8nExecutionRow[] = [];
    for (const row of rows) {
      const started = row.startedAt === undefined ? NaN : new Date(row.startedAt).getTime();
      if (Number.isNaN(started) || row.mode === "manual") continue;
      if (started >= currentStart) current.push(row);
      else if (started >= previousStart) previous.push(row);
    }

    const value: N8nInsightsResponse = {
      days,
      generatedAt: new Date().toISOString(),
      truncated,
      sampleSize: rows.length,
      current: summarize(current),
      previous: summarize(previous),
      byDay: byDay(current, currentStart, now),
    };
    this.cache.set(days, { at: Date.now(), value });
    this.logger.log(`insights refreshed`, { days, sample: rows.length, truncated });
    return value;
  }

  /** In-app troubleshooting view: recent executions + node failure tally for one workflow. */
  async inspect(workflowId: string): Promise<N8nWorkflowInspection> {
    if (env.N8N_BASE_URL === undefined || env.N8N_API_KEY === undefined) {
      throw new BadRequestException("n8n is not connected — set N8N_BASE_URL and N8N_API_KEY");
    }
    const base = env.N8N_BASE_URL;
    const headers = { "X-N8N-API-KEY": env.N8N_API_KEY };

    const wfRes = await fetch(`${base}/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
      headers,
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (wfRes.status === 404) throw new NotFoundException(`n8n workflow ${workflowId} not found`);
    if (!wfRes.ok) throw new BadRequestException(`n8n workflow fetch returned ${wfRes.status}`);
    const wf = (await wfRes.json()) as {
      name?: string;
      active?: boolean;
      nodes?: { name?: string; type?: string }[];
    };

    const exRes = await fetch(
      `${base}/api/v1/executions?workflowId=${encodeURIComponent(workflowId)}&limit=40`,
      { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
    );
    if (!exRes.ok) throw new BadRequestException(`n8n executions fetch returned ${exRes.status}`);
    const exBody = (await exRes.json()) as { data?: N8nExecutionRow[] };

    const executions: N8nExecutionSummary[] = (exBody.data ?? []).map((row) => ({
      id: String(row.id),
      status: row.status ?? "unknown",
      mode: row.mode ?? "unknown",
      startedAt: row.startedAt ?? null,
      stoppedAt: row.stoppedAt ?? null,
      durationMs: runMs(row),
      errorMessage: null,
      errorNode: null,
      url: `${base}/workflow/${workflowId}/executions/${String(row.id)}`,
    }));

    // Error details for the most recent failures only — the error object, never node data.
    const nodeFailureCounts: Record<string, number> = {};
    const failed = executions.filter((e) => e.status === "error" || e.status === "crashed").slice(0, 10);
    for (const execution of failed) {
      try {
        const dRes = await fetch(
          `${base}/api/v1/executions/${encodeURIComponent(execution.id)}?includeData=true`,
          { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
        );
        if (!dRes.ok) continue;
        const detail = (await dRes.json()) as {
          data?: {
            resultData?: {
              error?: { message?: unknown; description?: unknown; node?: { name?: unknown } };
              lastNodeExecuted?: unknown;
            };
          };
        };
        const rd = detail.data?.resultData;
        if (rd?.error !== undefined) {
          execution.errorMessage = String(rd.error.message ?? rd.error.description ?? "Execution failed").slice(0, 500);
          const node = rd.error.node?.name ?? rd.lastNodeExecuted;
          execution.errorNode = typeof node === "string" ? node : null;
          if (execution.errorNode !== null) {
            nodeFailureCounts[execution.errorNode] = (nodeFailureCounts[execution.errorNode] ?? 0) + 1;
          }
        }
      } catch {
        // a broken execution record must not sink the inspection
      }
    }

    return {
      workflowId,
      name: wf.name ?? workflowId,
      active: wf.active === true,
      editorUrl: `${base}/workflow/${workflowId}`,
      nodes: (wf.nodes ?? []).map((n) => ({ name: n.name ?? "?", type: (n.type ?? "?").split(".").pop() ?? "?" })),
      executions,
      nodeFailureCounts,
      generatedAt: new Date().toISOString(),
    };
  }

  /** Direct retry for the inspector (event-less), same n8n endpoint the drawer uses. */
  async retryExecution(executionId: string): Promise<{ retryExecutionId: string }> {
    if (env.N8N_BASE_URL === undefined || env.N8N_API_KEY === undefined) {
      throw new BadRequestException("n8n is not connected");
    }
    const res = await fetch(
      `${env.N8N_BASE_URL}/api/v1/executions/${encodeURIComponent(executionId)}/retry`,
      {
        method: "POST",
        headers: { "X-N8N-API-KEY": env.N8N_API_KEY, "content-type": "application/json" },
        body: JSON.stringify({ loadWorkflow: true }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) throw new BadRequestException(`n8n retry returned ${res.status}`);
    const body = (await res.json()) as { id?: string | number };
    return { retryExecutionId: String(body.id ?? "") };
  }

  private async fetchSince(sinceMs: number): Promise<{ rows: N8nExecutionRow[]; truncated: boolean }> {
    const rows: N8nExecutionRow[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = `${env.N8N_BASE_URL as string}/api/v1/executions?limit=250${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const res = await fetch(url, {
        headers: { "X-N8N-API-KEY": env.N8N_API_KEY as string },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new BadRequestException(`n8n executions returned ${res.status}`);
      const body = (await res.json()) as { data?: N8nExecutionRow[]; nextCursor?: string | null };
      const batch = body.data ?? [];
      rows.push(...batch);
      const oldest = batch[batch.length - 1]?.startedAt;
      if (oldest !== undefined && new Date(oldest).getTime() < sinceMs) {
        return { rows, truncated: false };
      }
      cursor = body.nextCursor ?? null;
      if (cursor === null) return { rows, truncated: false };
    }
    return { rows, truncated: true };
  }
}

function isFailed(row: N8nExecutionRow): boolean {
  return row.status === "error" || row.status === "crashed";
}

function runMs(row: N8nExecutionRow): number | null {
  if (row.startedAt === undefined || row.stoppedAt === undefined || row.stoppedAt === null) return null;
  const ms = new Date(row.stoppedAt).getTime() - new Date(row.startedAt).getTime();
  return Number.isFinite(ms) && ms >= 0 ? ms : null;
}

function summarize(rows: N8nExecutionRow[]): N8nInsightsPeriod {
  const failed = rows.filter(isFailed).length;
  const runtimes = rows.map(runMs).filter((v): v is number => v !== null);
  return {
    prodExecutions: rows.length,
    failedExecutions: failed,
    failureRatePct: rows.length === 0 ? null : Math.round((failed / rows.length) * 1000) / 10,
    avgRunMs:
      runtimes.length === 0
        ? null
        : Math.round(runtimes.reduce((a, b) => a + b, 0) / runtimes.length),
  };
}

function byDay(rows: N8nExecutionRow[], startMs: number, endMs: number): N8nInsightsDay[] {
  const buckets = new Map<string, { total: number; failed: number; runtimes: number[] }>();
  for (let t = startMs; t <= endMs; t += DAY_MS) {
    buckets.set(new Date(t).toISOString().slice(0, 10), { total: 0, failed: 0, runtimes: [] });
  }
  for (const row of rows) {
    if (row.startedAt === undefined) continue;
    const key = row.startedAt.slice(0, 10);
    const bucket = buckets.get(key);
    if (bucket === undefined) continue;
    bucket.total += 1;
    if (isFailed(row)) bucket.failed += 1;
    const ms = runMs(row);
    if (ms !== null) bucket.runtimes.push(ms);
  }
  return [...buckets.entries()].map(([date, b]) => ({
    date,
    total: b.total,
    failed: b.failed,
    avgRunMs:
      b.runtimes.length === 0
        ? null
        : Math.round(b.runtimes.reduce((a, c) => a + c, 0) / b.runtimes.length),
  }));
}
