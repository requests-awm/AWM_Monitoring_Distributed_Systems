import { z } from "zod";

import type { WorkflowPlatform } from "./enums";

/** One automation (n8n workflow / Zap / connected app job) in the inventory. */
export interface AutomationRow {
  platform: WorkflowPlatform;
  externalId: string;
  name: string;
  /** Is it currently switched on / live. */
  active: boolean;
  stateLabel: string;
  /** n8n only: does it have an error workflow attached (null = not applicable). */
  hasErrorHandler: boolean | null;
  editorUrl: string | null;
  historyUrl: string | null;
  lastEditedBy: string | null;
  /** Failure events currently in the inbox for this automation. */
  recentFailures: number;
  lastFailureAt: string | null;
}

export interface AutomationInventoryResponse {
  fetchedAt: string;
  /** Freshness / coverage caveats, shown on the page. */
  notes: string[];
  rows: AutomationRow[];
}

/** One aggregation window of n8n execution metrics. */
export interface N8nInsightsPeriod {
  /** Executions in any non-manual mode (trigger, webhook, schedule, retry, …). */
  prodExecutions: number;
  failedExecutions: number;
  /** failed / prod, in percent. Null when there were no executions. */
  failureRatePct: number | null;
  /** Mean wall-clock runtime of finished executions. Null when none finished. */
  avgRunMs: number | null;
}

export interface N8nInsightsDay {
  /** UTC calendar date, YYYY-MM-DD. */
  date: string;
  total: number;
  failed: number;
  avgRunMs: number | null;
}

/** Response of `GET /api/n8n/insights?days=7|30`. */
export interface N8nInsightsResponse {
  days: number;
  generatedAt: string;
  /**
   * True when the execution history was longer than the fetch cap, so the
   * previous-period comparison (and possibly the window itself) is partial.
   */
  truncated: boolean;
  /** Executions fetched from n8n to build this response. */
  sampleSize: number;
  current: N8nInsightsPeriod;
  previous: N8nInsightsPeriod;
  byDay: N8nInsightsDay[];
}

export interface N8nExecutionSummary {
  id: string;
  status: string;
  mode: string;
  startedAt: string | null;
  stoppedAt: string | null;
  durationMs: number | null;
  /** Populated for recent failed executions (detail fetch, error object only). */
  errorMessage: string | null;
  errorNode: string | null;
  url: string;
}

/** Response of `GET /api/n8n/workflows/:id/inspect` — the in-app troubleshooting view. */
export interface N8nWorkflowInspection {
  workflowId: string;
  name: string;
  active: boolean;
  editorUrl: string;
  nodes: { name: string; type: string }[];
  /** Newest first, successes and failures interleaved. */
  executions: N8nExecutionSummary[];
  /** Failed-node tally across the inspected failures — often the diagnosis. */
  nodeFailureCounts: Record<string, number>;
  generatedAt: string;
}

/** Body of `POST /api/automations/n8n/:workflowId/toggle`. */
export const N8nWorkflowToggleBody = z.object({
  active: z.boolean(),
});
export type N8nWorkflowToggleBody = z.infer<typeof N8nWorkflowToggleBody>;

export interface N8nWorkflowToggleResult {
  workflowId: string;
  active: boolean;
  note: string | null;
}

/** Body of `POST /api/internal/zap-inventory` — a Zap list snapshot push. */
export const ZapInventoryPushBody = z.object({
  zaps: z.array(
    z.object({
      external_id: z.string().min(1),
      name: z.string().min(1),
      state: z.string().min(1),
      editor_url: z.string().url().nullish(),
      history_url: z.string().url().nullish(),
      last_edited_by: z.string().nullish(),
    }),
  ),
  source: z.string().min(1).default("zapier-mcp"),
});
export type ZapInventoryPushBody = z.infer<typeof ZapInventoryPushBody>;
