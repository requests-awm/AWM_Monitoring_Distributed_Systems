import { BadGatewayException, BadRequestException, Inject, Injectable, Logger } from "@nestjs/common";
import type {
  AutomationInventoryResponse,
  AutomationRow,
  N8nWorkflowToggleResult,
  WorkflowPlatform,
  ZapInventoryPushBody,
} from "@awm/shared";

import { env } from "../config/env";
import {
  WORKFLOW_EVENTS_REPOSITORY,
  type WorkflowEventsRepository,
} from "./workflow-events.repository";

const N8N_CACHE_TTL_MS = 5 * 60_000;
/** Per-call budget for n8n API requests — hang the page, not the dashboard. */
const N8N_FETCH_TIMEOUT_MS = 15_000;
// A workflow counts as "failing" only while it has open (new/acknowledged)
// events this recent — resolving in the inbox or 7 days of silence clears it.
const FAILURE_WINDOW_MS = 7 * 24 * 60 * 60_000;

interface N8nWorkflowRow {
  id: string | number;
  name?: string;
  active?: boolean;
  settings?: { errorWorkflow?: string };
}

interface ZapSnapshot {
  pushedAt: string;
  source: string;
  zaps: ZapInventoryPushBody["zaps"];
}

interface FailureSummary {
  platform: WorkflowPlatform;
  externalId: string;
  name: string;
  count: number;
  lastAt: string;
  historyUrl: string | null;
}

function failureKey(platform: WorkflowPlatform, externalId: string): string {
  return `${platform}:${externalId}`;
}

@Injectable()
export class AutomationsService {
  private readonly logger = new Logger(AutomationsService.name);
  private n8nCache: { fetchedAt: number; rows: AutomationRow[] } | null = null;
  // Zapier has no customer-facing list API; the snapshot is pushed in (Zapier MCP
  // gateway / a scheduled Zap) until a server-side gateway exists.
  private zapSnapshot: ZapSnapshot | null = null;

  constructor(
    @Inject(WORKFLOW_EVENTS_REPOSITORY) private readonly repo: WorkflowEventsRepository,
  ) {}

  storeZapSnapshot(body: ZapInventoryPushBody): { stored: number } {
    this.zapSnapshot = { pushedAt: new Date().toISOString(), source: body.source, zaps: body.zaps };
    return { stored: body.zaps.length };
  }

  async inventory(): Promise<AutomationInventoryResponse> {
    const notes: string[] = [];
    const rows: AutomationRow[] = [];

    const failures = await this.failureIndex();

    // --- n8n: live from the instance API -------------------------------
    if (env.N8N_BASE_URL !== undefined && env.N8N_API_KEY !== undefined) {
      try {
        rows.push(...(await this.n8nRows()));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        if (this.n8nCache !== null) {
          rows.push(...this.n8nCache.rows);
          notes.push(
            `n8n list refresh failed (${reason}) — showing the cached inventory from ${new Date(this.n8nCache.fetchedAt).toISOString()}.`,
          );
        } else {
          notes.push(`n8n list unavailable: ${reason}`);
        }
      }
    } else {
      notes.push("n8n not connected — set N8N_BASE_URL and N8N_API_KEY.");
    }

    // --- Zapier: pushed snapshot ---------------------------------------
    if (this.zapSnapshot !== null) {
      notes.push(
        `Zapier list is a snapshot (${this.zapSnapshot.source}) from ${this.zapSnapshot.pushedAt}; live sync lands with the Zapier gateway.`,
      );
      for (const zap of this.zapSnapshot.zaps) {
        rows.push({
          platform: "zapier",
          externalId: zap.external_id,
          name: zap.name,
          active: zap.state === "on",
          stateLabel: zap.state,
          hasErrorHandler: null,
          editorUrl: zap.editor_url ?? null,
          historyUrl: zap.history_url ?? null,
          lastEditedBy: zap.last_edited_by ?? null,
          recentFailures: 0,
          lastFailureAt: null,
        });
      }
    } else {
      notes.push("No Zapier snapshot pushed yet — Zaps appear once the inventory push runs.");
    }

    for (const row of rows) {
      const f = failures.get(failureKey(row.platform, row.externalId));
      if (f !== undefined) {
        row.recentFailures = f.count;
        row.lastFailureAt = f.lastAt;
      }
    }

    // Custom apps (and any platform whose inventory is unavailable) have no
    // list API — the only thing we know about them is what they report, so
    // failing jobs are listed straight from the inbox.
    const inventoried = new Set(rows.map((r) => failureKey(r.platform, r.externalId)));
    let reportedOnly = 0;
    for (const [key, f] of failures) {
      if (inventoried.has(key)) continue;
      reportedOnly += 1;
      rows.push({
        platform: f.platform,
        externalId: f.externalId,
        name: f.name,
        active: true,
        stateLabel: "reporting",
        hasErrorHandler: null,
        editorUrl: null,
        historyUrl: f.historyUrl,
        lastEditedBy: null,
        recentFailures: f.count,
        lastFailureAt: f.lastAt,
      });
    }
    if (reportedOnly > 0) {
      notes.push(
        `${reportedOnly} job(s) listed from failure reports alone — no inventory API for that platform, so state is unknown.`,
      );
    }

    // This is a failing-automations list; once a workflow's open failures are
    // resolved (or age past the window) it has been taken care of — drop it.
    const visible = rows.filter((r) => r.recentFailures > 0);
    for (const platform of ["zapier", "n8n"] as const) {
      const cleared = rows.filter((r) => r.platform === platform && r.recentFailures === 0).length;
      if (cleared > 0) {
        notes.push(
          `${cleared} ${platform === "zapier" ? "Zap(s)" : "n8n workflow(s)"} hidden — no open failures in the last 7 days (resolved or gone quiet).`,
        );
      }
    }

    visible.sort((a, b) => b.recentFailures - a.recentFailures || a.name.localeCompare(b.name));
    return { fetchedAt: new Date().toISOString(), notes, rows: visible };
  }

  /** Real write to n8n: POST /workflows/{id}/activate|deactivate. Audit lives with the caller. */
  async toggleN8nWorkflow(workflowId: string, active: boolean, actor: string): Promise<N8nWorkflowToggleResult> {
    if (env.N8N_BASE_URL === undefined || env.N8N_API_KEY === undefined) {
      throw new BadRequestException("n8n is not connected — set N8N_BASE_URL and N8N_API_KEY");
    }
    const url = `${env.N8N_BASE_URL}/api/v1/workflows/${encodeURIComponent(workflowId)}/${active ? "activate" : "deactivate"}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "X-N8N-API-KEY": env.N8N_API_KEY },
      signal: AbortSignal.timeout(N8N_FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.warn(`n8n toggle failed`, { workflowId, active, status: res.status, body: body.slice(0, 300) });
      throw new BadGatewayException(`n8n ${active ? "activate" : "deactivate"} returned ${res.status}`);
    }
    this.logger.log(`n8n workflow toggled`, { workflowId, active, actor });
    // Reflect the change in the cached inventory immediately.
    const cached = this.n8nCache?.rows.find((r) => r.externalId === workflowId);
    if (cached !== undefined) {
      cached.active = active;
      cached.stateLabel = active ? "on" : "off";
    }
    return { workflowId, active, note: null };
  }

  private async failureIndex(): Promise<Map<string, FailureSummary>> {
    const index = new Map<string, FailureSummary>();
    const cutoff = Date.now() - FAILURE_WINDOW_MS;
    for (const event of await this.repo.listEvents()) {
      if (event.status === "resolved" || event.status === "ignored") continue;
      if (new Date(event.occurredAt).getTime() < cutoff) continue;
      const key = failureKey(event.platform, event.workflowExternalId);
      const current = index.get(key);
      if (current === undefined) {
        index.set(key, {
          platform: event.platform,
          externalId: event.workflowExternalId,
          name: event.workflowName,
          count: 1,
          lastAt: event.occurredAt,
          historyUrl: event.executionUrl,
        });
      } else {
        current.count += 1;
        if (event.occurredAt > current.lastAt) {
          current.lastAt = event.occurredAt;
          current.name = event.workflowName;
          current.historyUrl = event.executionUrl ?? current.historyUrl;
        }
      }
    }
    return index;
  }

  private async n8nRows(): Promise<AutomationRow[]> {
    if (this.n8nCache !== null && Date.now() - this.n8nCache.fetchedAt < N8N_CACHE_TTL_MS) {
      return this.n8nCache.rows;
    }
    const base = env.N8N_BASE_URL as string;
    const rows: AutomationRow[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 12; page += 1) {
      const url = `${base}/api/v1/workflows?limit=250${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const res = await fetch(url, {
        headers: { "X-N8N-API-KEY": env.N8N_API_KEY as string },
        signal: AbortSignal.timeout(N8N_FETCH_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`n8n workflows returned ${res.status}`);
      const body = (await res.json()) as { data?: N8nWorkflowRow[]; nextCursor?: string | null };
      for (const w of body.data ?? []) {
        const id = String(w.id);
        rows.push({
          platform: "n8n",
          externalId: id,
          name: w.name ?? id,
          active: w.active === true,
          stateLabel: w.active === true ? "on" : "off",
          hasErrorHandler: typeof w.settings?.errorWorkflow === "string" && w.settings.errorWorkflow !== "",
          editorUrl: `${base}/workflow/${id}`,
          historyUrl: `${base}/workflow/${id}/executions`,
          lastEditedBy: null,
          recentFailures: 0,
          lastFailureAt: null,
        });
      }
      cursor = body.nextCursor ?? null;
      if (cursor === null) break;
    }
    this.n8nCache = { fetchedAt: Date.now(), rows };
    this.logger.log(`n8n inventory refreshed`, { workflows: rows.length });
    return rows;
  }
}
