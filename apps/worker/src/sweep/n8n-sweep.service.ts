import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { WorkflowEventEnvelope } from "@awm/shared";

import { env } from "../config/env";

interface N8nExecution {
  id: string | number;
  status?: string;
  workflowId?: string | number;
  startedAt?: string;
  stoppedAt?: string;
  workflowData?: { name?: string };
}

interface N8nErrorDetail {
  message: string;
  node: string | null;
  stack: string | null;
}

/**
 * Reconciliation sweep: pulls failed/crashed executions from the n8n API and
 * pushes them through our own ingest endpoint (which is idempotent), so a lost
 * error-workflow push is recovered within one sweep interval. Crashed
 * executions never fire the error workflow, so the sweep is their only path in.
 *
 * Runs only when N8N_BASE_URL, N8N_API_KEY and INGEST_TOKEN_N8N are all
 * configured; otherwise it logs once and stays idle.
 */
@Injectable()
export class N8nSweepService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(N8nSweepService.name);
  private timer: NodeJS.Timeout | null = null;
  /**
   * Error-detail cache. Forwarding is idempotent and always happens (so a
   * restarted API store repopulates); only the expensive per-execution detail
   * fetch is cached.
   */
  private readonly detailCache = new Map<string, N8nErrorDetail | null>();

  onModuleInit(): void {
    if (
      env.N8N_BASE_URL === undefined ||
      env.N8N_API_KEY === undefined ||
      env.INGEST_TOKEN_N8N === undefined
    ) {
      this.logger.log("n8n sweep idle — set N8N_BASE_URL, N8N_API_KEY, INGEST_TOKEN_N8N to enable");
      return;
    }
    this.logger.log(`n8n sweep enabled — every ${env.SWEEP_INTERVAL_MS}ms against ${env.N8N_BASE_URL}`);
    void this.sweep();
    this.timer = setInterval(() => void this.sweep(), env.SWEEP_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  private async sweep(): Promise<void> {
    try {
      const [errored, crashed, workflowNames] = await Promise.all([
        this.fetchExecutions("error"),
        this.fetchExecutions("crashed"),
        this.fetchWorkflowNames(),
      ]);
      const executions = [...errored, ...crashed];
      let ingested = 0;
      for (const execution of executions) {
        const id = String(execution.id);
        let detail = this.detailCache.get(id);
        if (!this.detailCache.has(id)) {
          detail = await this.fetchErrorDetail(id);
          this.detailCache.set(id, detail ?? null);
          if (this.detailCache.size > 2000) {
            const oldest = this.detailCache.keys().next().value;
            if (oldest !== undefined) this.detailCache.delete(oldest);
          }
        }
        const ok = await this.forward(execution, workflowNames, detail ?? null);
        if (ok === true) ingested += 1;
      }
      this.logger.log(`sweep complete`, { fetched: executions.length, ingested });
    } catch (error) {
      this.logger.error(`sweep failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The executions list omits workflow names on some versions — resolve them once per sweep. */
  private async fetchWorkflowNames(): Promise<Map<string, string>> {
    const names = new Map<string, string>();
    let cursor: string | null = null;
    for (let page = 0; page < 10; page += 1) {
      const url = `${env.N8N_BASE_URL}/api/v1/workflows?limit=250${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const res = await fetch(url, { headers: { "X-N8N-API-KEY": env.N8N_API_KEY as string } });
      if (!res.ok) break;
      const body = (await res.json()) as {
        data?: { id: string | number; name?: string }[];
        nextCursor?: string | null;
      };
      for (const w of body.data ?? []) {
        if (w.name !== undefined) names.set(String(w.id), w.name);
      }
      cursor = body.nextCursor ?? null;
      if (cursor === null) break;
    }
    this.logger.log(`resolved ${names.size} workflow names`);
    return names;
  }

  /**
   * Pull ONLY the error object from the execution detail (message, failed
   * node, stack). Node input/output data may contain client information and
   * is never read or forwarded.
   */
  private async fetchErrorDetail(executionId: string): Promise<N8nErrorDetail | null> {
    try {
      const res = await fetch(
        `${env.N8N_BASE_URL}/api/v1/executions/${encodeURIComponent(executionId)}?includeData=true`,
        { headers: { "X-N8N-API-KEY": env.N8N_API_KEY as string } },
      );
      if (!res.ok) return null;
      const body = (await res.json()) as {
        id?: unknown;
        data?: {
          resultData?: {
            error?: { message?: unknown; description?: unknown; stack?: unknown; node?: { name?: unknown } };
            lastNodeExecuted?: unknown;
          };
        };
      };
      const resultData = body.data?.resultData;
      const error = resultData?.error;
      if (error === undefined) return null;
      const message = String(error.message ?? error.description ?? "Execution failed").slice(0, 3900);
      const node = error.node?.name ?? resultData?.lastNodeExecuted;
      return {
        message,
        node: typeof node === "string" ? node : null,
        stack: typeof error.stack === "string" ? error.stack.slice(0, 19_000) : null,
      };
    } catch {
      return null;
    }
  }

  private async fetchExecutions(status: "error" | "crashed"): Promise<N8nExecution[]> {
    const url = `${env.N8N_BASE_URL}/api/v1/executions?status=${status}&limit=100`;
    const res = await fetch(url, { headers: { "X-N8N-API-KEY": env.N8N_API_KEY as string } });
    if (!res.ok) {
      throw new Error(`n8n executions list (${status}) returned ${res.status}`);
    }
    const body = (await res.json()) as { data?: N8nExecution[] };
    return body.data ?? [];
  }

  /** Returns true = newly ingested, false = duplicate, null = delivery failed (retry next sweep). */
  private async forward(
    execution: N8nExecution,
    workflowNames: Map<string, string>,
    detail: N8nErrorDetail | null,
  ): Promise<boolean | null> {
    const workflowId = String(execution.workflowId ?? "unknown");
    const envelope: WorkflowEventEnvelope = {
      platform: "n8n",
      event_type: "execution_failed",
      workflow: {
        external_id: workflowId,
        name: execution.workflowData?.name ?? workflowNames.get(workflowId) ?? workflowId,
      },
      execution: {
        external_id: String(execution.id),
        url: `${env.N8N_BASE_URL}/workflow/${workflowId}/executions/${String(execution.id)}`,
      },
      error: {
        message:
          detail?.message ?? `Execution ${String(execution.id)} ${execution.status ?? "error"} (caught by sweep)`,
        node: detail?.node ?? null,
        stack: detail?.stack ?? null,
      },
      occurred_at: execution.stoppedAt ?? execution.startedAt ?? new Date().toISOString(),
      raw: {
        execution: { id: execution.id, status: execution.status, workflowId },
        error: detail ?? undefined,
      },
    };
    const res = await fetch(`${env.API_BASE_URL}/api/ingest/workflow-events`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.INGEST_TOKEN_N8N as string}`,
        "content-type": "application/json",
        "x-ingest-channel": "sweep",
      },
      body: JSON.stringify(envelope),
    });
    if (!res.ok) {
      this.logger.warn(`ingest rejected sweep event`, { executionId: execution.id, status: res.status });
      return null;
    }
    const result = (await res.json()) as { duplicate: boolean };
    return !result.duplicate;
  }
}
