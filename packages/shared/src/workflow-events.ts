import { z } from "zod";

import {
  WorkflowEventType,
  WorkflowPlatform,
  type IngestChannel,
  type WorkflowEventStatus,
} from "./enums";

/**
 * A proposed repair to the workflow itself, generated from the workflow
 * definition + error context. Applying it updates the workflow on the
 * platform (n8n: PUT /workflows/{id}) and retries with the fixed version —
 * always behind explicit human approval.
 */
export interface WorkflowFixSuggestion {
  summary: string;
  changes: string[];
  /** What applying actually does on the platform, shown to the user. */
  mechanism: string;
}

/**
 * One row in the Workflow Failure Inbox — a failed execution, deactivated
 * workflow, or halted task pushed to us by N8N/Zapier (or caught by the
 * reconciliation sweep). Mirrors `awm_monitoring.workflow_failure_events`.
 */
export interface WorkflowFailureEvent {
  id: string;
  platform: WorkflowPlatform;
  eventType: WorkflowEventType;
  status: WorkflowEventStatus;
  /** Display name of the connected source, e.g. "AWM n8n". */
  sourceName: string;
  workflowExternalId: string;
  workflowName: string;
  /** Null for trigger-node failures and deactivations — nothing executed. */
  executionExternalId: string | null;
  /** Deep link into the platform (n8n execution URL / Zap History). */
  executionUrl: string | null;
  errorMessage: string;
  errorNode: string | null;
  errorStack: string | null;
  /** When the platform says it broke (Zapier can report up to ~10.5h late). */
  occurredAt: string;
  /** When our ingest endpoint received it. */
  receivedAt: string;
  ingestChannel: IngestChannel;
  assignee: string | null;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  /** Set after a successful n8n API retry. */
  retryExecutionId: string | null;
  /** True only for n8n events with a saved execution (public retry API). */
  canRetry: boolean;
  /** Trigger data that fed the failed run, when captured. */
  inputPayload: Record<string, unknown> | null;
  /**
   * True when the workflow is webhook-triggered and the input was captured,
   * so an edited payload can be re-injected (n8n webhook URL / Zapier catch
   * URL) without opening the platform.
   */
  canResubmit: boolean;
  /** Proposed workflow repair (n8n only — Zapier has no workflow-edit API). */
  fixSuggestion: WorkflowFixSuggestion | null;
  /** Truncated platform payload passthrough. */
  rawPayload: Record<string, unknown>;
}

export interface WorkflowEventsStats {
  /** new + acknowledged + investigating. */
  needsAttention: number;
  failures24h: number;
  deactivatedWorkflows: number;
  retriedToday: number;
  sourcesConnected: number;
}

export interface WorkflowSourceSummary {
  id: string;
  name: string;
  platform: WorkflowPlatform;
  /** Whether the reconciliation sweep runs for this source (n8n only). */
  sweepEnabled: boolean;
}

/** Response contract for `GET /api/workflow-events`. */
export interface WorkflowEventsResponse {
  /** "sample" = in-memory fixture store; "live" = Prisma against the shared DB. */
  mode: "sample" | "live";
  stats: WorkflowEventsStats;
  sources: WorkflowSourceSummary[];
  events: WorkflowFailureEvent[];
}

/**
 * Envelope accepted by `POST /api/ingest/workflow-events`. Senders (the n8n
 * error-handler workflow, Zapier Manager webhooks, the reconciliation sweep)
 * normalize their platform payloads into this shape at the edge.
 */
export const WorkflowEventEnvelope = z.object({
  platform: WorkflowPlatform,
  event_type: WorkflowEventType,
  workflow: z.object({
    external_id: z.string().min(1),
    name: z.string().min(1),
  }),
  execution: z
    .object({
      external_id: z.string().min(1).nullish(),
      url: z.string().url().nullish(),
      retry_of: z.string().nullish(),
    })
    .nullish(),
  error: z.object({
    message: z.string().min(1).max(4000),
    node: z.string().nullish(),
    stack: z.string().max(20_000).nullish(),
  }),
  input_payload: z.record(z.unknown()).nullish(),
  resubmit_url: z.string().url().nullish(),
  occurred_at: z.string().datetime({ offset: true }),
  raw: z.record(z.unknown()).optional(),
});
export type WorkflowEventEnvelope = z.infer<typeof WorkflowEventEnvelope>;

/** Response of `POST /api/ingest/workflow-events`. */
export interface WorkflowEventIngestResult {
  id: string;
  /** True when the envelope matched an already-ingested event (idempotent replay). */
  duplicate: boolean;
}

export const WorkflowEventAssignBody = z.object({
  assignee: z.string().min(1).max(120).nullable(),
});
export type WorkflowEventAssignBody = z.infer<typeof WorkflowEventAssignBody>;

export const WorkflowEventResubmitBody = z.object({
  payload: z.record(z.unknown()),
});
export type WorkflowEventResubmitBody = z.infer<typeof WorkflowEventResubmitBody>;

/** Response of every `POST /api/workflow-events/:id/<action>` endpoint. */
export interface WorkflowEventActionResult {
  event: WorkflowFailureEvent;
  /** Human-readable outcome for the UI toast (e.g. what sample mode simulated). */
  note: string | null;
}

/** Body of `POST /api/workflow-sources` — connect a new app/platform to the inbox. */
export const WorkflowSourceCreateBody = z.object({
  name: z.string().min(2).max(80),
  platform: WorkflowPlatform,
  baseUrl: z.string().url().nullish(),
});
export type WorkflowSourceCreateBody = z.infer<typeof WorkflowSourceCreateBody>;

/** Response of `POST /api/workflow-sources`. */
export interface WorkflowSourceCreateResult {
  source: WorkflowSourceSummary;
  /**
   * The sender's bearer token for the ingest endpoint. Returned exactly once —
   * only its SHA-256 hash is stored, so it cannot be recovered later.
   */
  ingestToken: string;
  note: string | null;
}
