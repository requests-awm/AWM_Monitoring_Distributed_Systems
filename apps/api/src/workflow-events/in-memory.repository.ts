import { NotFoundException } from "@nestjs/common";

import { env, seedDemoData } from "../config/env";
import { sha256Hex } from "../lib/secrets";
import { buildWorkflowEventsFixture } from "./workflow-events.fixture";
import type {
  NewWorkflowEvent,
  NewWorkflowSource,
  StoredWorkflowEvent,
  StoredWorkflowSource,
  WorkflowEventPatch,
  WorkflowEventsRepository,
} from "./workflow-events.repository";

const SAMPLE_ORG = "org-sample";

const SAMPLE_RESUBMIT_URLS: Record<string, string> = {
  "evt-003": "https://awm.app.n8n.cloud/webhook/meeting-reminders",
  "evt-008": "https://hooks.zapier.com/hooks/catch/0000000/new-lead/",
};

/**
 * Sample-mode store: fixture-seeded, mutations persist for the process
 * lifetime so the UI behaves exactly like live mode. Swapped for the Prisma
 * repository the moment DATABASE_URL is configured.
 */
export class InMemoryWorkflowEventsRepository implements WorkflowEventsRepository {
  readonly mode = "sample" as const;

  private readonly sources: StoredWorkflowSource[] = [
    {
      id: "src-n8n",
      orgId: SAMPLE_ORG,
      name: "AWM n8n",
      platform: "n8n",
      sweepEnabled: true,
      baseUrl: null,
      apiKey: null,
      ingestTokenHash: sha256Hex(env.INGEST_TOKEN_N8N),
    },
    {
      id: "src-zapier",
      orgId: SAMPLE_ORG,
      name: "AWM Zapier",
      platform: "zapier",
      sweepEnabled: false,
      baseUrl: null,
      apiKey: null,
      ingestTokenHash: sha256Hex(env.INGEST_TOKEN_ZAPIER),
    },
    {
      id: "src-taskbooker",
      orgId: SAMPLE_ORG,
      name: "Task Booker Jobs",
      platform: "custom_app",
      sweepEnabled: false,
      baseUrl: null,
      apiKey: null,
      // Sample custom-app source; token documented in docs/CONTINUATION.md.
      ingestTokenHash: sha256Hex("dev-ingest-taskbooker-sample-token"),
    },
  ];

  // Real n8n failures arrive via the sweep once the instance is connected —
  // suppress the fake n8n demo rows then, so real and sample data never mix.
  // SEED_DEMO_DATA=false suppresses every fixture event (production deployments).
  private readonly events = new Map<string, StoredWorkflowEvent>(
    buildWorkflowEventsFixture()
      .filter((e) => seedDemoData && !(e.platform === "n8n" && env.N8N_API_KEY !== undefined))
      .map((e) => [
      e.id,
      {
        ...e,
        orgId: SAMPLE_ORG,
        sourceId:
          e.platform === "zapier"
            ? "src-zapier"
            : e.platform === "custom_app"
              ? "src-taskbooker"
              : "src-n8n",
        dedupKey: `${e.eventType}:${e.executionExternalId ?? e.id}`,
        resubmitUrl: SAMPLE_RESUBMIT_URLS[e.id] ?? null,
      },
    ]),
  );

  private seq = 0;

  listSources(): Promise<StoredWorkflowSource[]> {
    return Promise.resolve([...this.sources]);
  }

  listEvents(): Promise<StoredWorkflowEvent[]> {
    return Promise.resolve([...this.events.values()]);
  }

  getEvent(id: string): Promise<StoredWorkflowEvent | null> {
    return Promise.resolve(this.events.get(id) ?? null);
  }

  patchEvent(id: string, patch: WorkflowEventPatch): Promise<StoredWorkflowEvent> {
    const current = this.events.get(id);
    if (current === undefined) {
      throw new NotFoundException(`Workflow event ${id} not found`);
    }
    const updated: StoredWorkflowEvent = { ...current, ...patch };
    this.events.set(id, updated);
    return Promise.resolve(updated);
  }

  findSourceByTokenHash(tokenHash: string): Promise<StoredWorkflowSource | null> {
    return Promise.resolve(this.sources.find((s) => s.ingestTokenHash === tokenHash) ?? null);
  }

  insertEvent(record: NewWorkflowEvent): Promise<{ event: StoredWorkflowEvent; duplicate: boolean }> {
    const existing = [...this.events.values()].find(
      (e) => e.sourceId === record.sourceId && e.dedupKey === record.dedupKey,
    );
    if (existing !== undefined) {
      return Promise.resolve({ event: existing, duplicate: true });
    }
    const source = this.sources.find((s) => s.id === record.sourceId);
    this.seq += 1;
    const event: StoredWorkflowEvent = {
      id: `evt-ingested-${this.seq}`,
      platform: source?.platform ?? "other",
      eventType: record.eventType,
      status: "new",
      sourceName: source?.name ?? record.sourceId,
      workflowExternalId: record.workflowExternalId,
      workflowName: record.workflowName,
      executionExternalId: record.executionExternalId,
      executionUrl: record.executionUrl,
      errorMessage: record.errorMessage,
      errorNode: record.errorNode,
      errorStack: record.errorStack,
      occurredAt: record.occurredAt,
      receivedAt: new Date().toISOString(),
      ingestChannel: record.ingestChannel,
      assignee: null,
      acknowledgedAt: null,
      resolvedAt: null,
      retryExecutionId: null,
      canRetry: source?.platform === "n8n" && record.executionExternalId !== null,
      inputPayload: record.inputPayload,
      canResubmit: record.resubmitUrl !== null && record.inputPayload !== null,
      fixSuggestion: null,
      rawPayload: record.rawPayload,
      orgId: record.orgId,
      sourceId: record.sourceId,
      dedupKey: record.dedupKey,
      resubmitUrl: record.resubmitUrl,
    };
    this.events.set(event.id, event);
    return Promise.resolve({ event, duplicate: false });
  }

  createSource(record: NewWorkflowSource): Promise<StoredWorkflowSource> {
    const source: StoredWorkflowSource = {
      id: `src-custom-${this.sources.length + 1}`,
      orgId: SAMPLE_ORG,
      name: record.name,
      platform: record.platform,
      sweepEnabled: false,
      baseUrl: record.baseUrl,
      apiKey: null,
      ingestTokenHash: record.ingestTokenHash,
    };
    this.sources.push(source);
    return Promise.resolve(source);
  }
}
