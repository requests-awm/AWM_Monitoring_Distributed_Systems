import type {
  IngestChannel,
  WorkflowEventType,
  WorkflowFailureEvent,
  WorkflowPlatform,
  WorkflowSourceSummary,
} from "@awm/shared";

/** Event as stored, with server-only fields the contract never exposes. */
export interface StoredWorkflowEvent extends WorkflowFailureEvent {
  orgId: string;
  sourceId: string;
  dedupKey: string;
  resubmitUrl: string | null;
}

/** Source as stored, including auth material (never returned to the frontend). */
export interface StoredWorkflowSource extends WorkflowSourceSummary {
  orgId: string;
  baseUrl: string | null;
  /** Decrypted platform API key; null in sample mode or when not configured. */
  apiKey: string | null;
  ingestTokenHash: string;
}

export interface NewWorkflowEvent {
  orgId: string;
  sourceId: string;
  eventType: WorkflowEventType;
  workflowExternalId: string;
  workflowName: string;
  executionExternalId: string | null;
  executionUrl: string | null;
  errorMessage: string;
  errorNode: string | null;
  errorStack: string | null;
  inputPayload: Record<string, unknown> | null;
  resubmitUrl: string | null;
  rawPayload: Record<string, unknown>;
  dedupKey: string;
  occurredAt: string;
  ingestChannel: IngestChannel;
}

export type WorkflowEventPatch = Partial<
  Pick<
    StoredWorkflowEvent,
    | "status"
    | "assignee"
    | "acknowledgedAt"
    | "resolvedAt"
    | "retryExecutionId"
    | "inputPayload"
  >
>;

/**
 * Storage seam for the failure inbox. Two implementations:
 * in-memory (sample mode, seeded from fixtures) and Prisma (live mode).
 * Selected in AppModule by whether DATABASE_URL is configured.
 */
export interface NewWorkflowSource {
  name: string;
  platform: WorkflowPlatform;
  baseUrl: string | null;
  ingestTokenHash: string;
}

export interface WorkflowEventsRepository {
  readonly mode: "sample" | "live";
  listSources(): Promise<StoredWorkflowSource[]>;
  listEvents(): Promise<StoredWorkflowEvent[]>;
  getEvent(id: string): Promise<StoredWorkflowEvent | null>;
  patchEvent(id: string, patch: WorkflowEventPatch): Promise<StoredWorkflowEvent>;
  findSourceByTokenHash(tokenHash: string): Promise<StoredWorkflowSource | null>;
  /** Idempotent on (sourceId, dedupKey): a replay returns the existing event. */
  insertEvent(record: NewWorkflowEvent): Promise<{ event: StoredWorkflowEvent; duplicate: boolean }>;
  createSource(record: NewWorkflowSource): Promise<StoredWorkflowSource>;
}

export const WORKFLOW_EVENTS_REPOSITORY = "WORKFLOW_EVENTS_REPOSITORY";
