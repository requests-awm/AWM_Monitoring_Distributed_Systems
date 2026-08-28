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
