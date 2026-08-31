import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import type { N8nInsightsDay, N8nInsightsPeriod, N8nInsightsResponse } from "@awm/shared";

import { env } from "../config/env";

const CACHE_TTL_MS = 5 * 60_000;
/** Hard cap on history fetched per refresh: 60 pages × 250 = 15k executions. */
const MAX_PAGES = 60;
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

  async insights(days: number): Promise<N8nInsightsResponse> {
    if (env.N8N_BASE_URL === undefined || env.N8N_API_KEY === undefined) {
      throw new BadRequestException("n8n is not connected — set N8N_BASE_URL and N8N_API_KEY");
    }
    const cached = this.cache.get(days);
    if (cached !== undefined && Date.now() - cached.at < CACHE_TTL_MS) {
      return cached.value;
    }

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

  private async fetchSince(sinceMs: number): Promise<{ rows: N8nExecutionRow[]; truncated: boolean }> {
    const rows: N8nExecutionRow[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const url = `${env.N8N_BASE_URL as string}/api/v1/executions?limit=250${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const res = await fetch(url, { headers: { "X-N8N-API-KEY": env.N8N_API_KEY as string } });
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
