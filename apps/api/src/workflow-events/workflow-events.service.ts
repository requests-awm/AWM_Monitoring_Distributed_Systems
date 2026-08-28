import { createHash, randomBytes } from "node:crypto";

import { BadRequestException, Inject, Injectable, NotFoundException } from "@nestjs/common";
import type {
  IngestChannel,
  WorkflowEventActionResult,
  WorkflowEventEnvelope,
  WorkflowEventIngestResult,
  WorkflowEventsResponse,
  WorkflowEventsStats,
  WorkflowFailureEvent,
  WorkflowSourceCreateBody,
  WorkflowSourceCreateResult,
} from "@awm/shared";

import { sha256Hex } from "../lib/secrets";

import { N8nGateway } from "./n8n.gateway";
import {
  WORKFLOW_EVENTS_REPOSITORY,
  type StoredWorkflowEvent,
  type StoredWorkflowSource,
  type WorkflowEventsRepository,
} from "./workflow-events.repository";

const DAY_MS = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = new Set(["new", "acknowledged", "investigating"]);

@Injectable()
export class WorkflowEventsService {
  constructor(
    @Inject(WORKFLOW_EVENTS_REPOSITORY) private readonly repo: WorkflowEventsRepository,
    private readonly n8n: N8nGateway,
  ) {}

  async getEvents(): Promise<WorkflowEventsResponse> {
    const [sources, events] = await Promise.all([this.repo.listSources(), this.repo.listEvents()]);
    return {
      mode: this.repo.mode,
      stats: deriveStats(events, sources.length),
      sources: sources.map((s) => ({
        id: s.id,
        name: s.name,
        platform: s.platform,
        sweepEnabled: s.sweepEnabled,
      })),
      events: events.map(toPublic),
    };
  }

  async acknowledge(id: string): Promise<WorkflowEventActionResult> {
    const event = await this.mustGet(id);
    if (event.status !== "new") {
      return { event: toPublic(event), note: `Already ${event.status} — nothing changed` };
    }
    const updated = await this.repo.patchEvent(id, {
      status: "acknowledged",
      acknowledgedAt: new Date().toISOString(),
    });
    return { event: toPublic(updated), note: this.sampleNote() };
  }

  async resolve(id: string): Promise<WorkflowEventActionResult> {
    const event = await this.mustGet(id);
    if (event.status === "resolved") {
      return { event: toPublic(event), note: "Already resolved — nothing changed" };
    }
    const updated = await this.repo.patchEvent(id, {
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    });
    return { event: toPublic(updated), note: this.sampleNote() };
  }

  async ignore(id: string): Promise<WorkflowEventActionResult> {
    const event = await this.mustGet(id);
    if (event.status === "ignored") {
      return { event: toPublic(event), note: "Already ignored — nothing changed" };
    }
    const updated = await this.repo.patchEvent(id, { status: "ignored" });
    return { event: toPublic(updated), note: this.sampleNote() };
  }

  async assign(id: string, assignee: string | null): Promise<WorkflowEventActionResult> {
    await this.mustGet(id);
    const updated = await this.repo.patchEvent(id, { assignee });
    return { event: toPublic(updated), note: this.sampleNote() };
  }

  async retry(id: string): Promise<WorkflowEventActionResult> {
    const event = await this.mustGet(id);
    if (!event.canRetry || event.executionExternalId === null) {
      throw new BadRequestException("This event has no retryable execution");
    }
    const source = await this.mustGetSource(event.sourceId);
    const result = await this.n8n.retryExecution(source, event.executionExternalId, false);
    const updated = await this.repo.patchEvent(id, {
      status: "retried",
      retryExecutionId: result.retryExecutionId,
    });
    return { event: toPublic(updated), note: result.note };
  }

  async applyFix(id: string): Promise<WorkflowEventActionResult> {
    const event = await this.mustGet(id);
    if (event.fixSuggestion === null) {
      throw new BadRequestException("This event has no fix suggestion");
    }
    const source = await this.mustGetSource(event.sourceId);
    // TODO(phase-b): apply the generated workflow patch via PUT /api/v1/workflows/{id}
    // (with a version check) before retrying. Until then the retry runs with the
    // current workflow version (loadWorkflow: true picks up any manual fix too).
    let retryExecutionId: string | null = null;
    let note: string | null;
    if (event.executionExternalId !== null && event.canRetry) {
      const result = await this.n8n.retryExecution(source, event.executionExternalId, true);
      retryExecutionId = result.retryExecutionId;
      note = result.note ?? "Retried with the current workflow version — automatic patch application lands in Phase B";
    } else {
      note = this.sampleNote() ?? "Fix recorded — no execution to retry";
    }
    const updated = await this.repo.patchEvent(id, {
      status: "retried",
      retryExecutionId,
    });
    return { event: toPublic(updated), note };
  }

  async resubmit(id: string, payload: Record<string, unknown>): Promise<WorkflowEventActionResult> {
    const event = await this.mustGet(id);
    if (!event.canResubmit || event.resubmitUrl === null) {
      throw new BadRequestException("This event has no resubmit webhook");
    }
    const result = await this.n8n.resubmitPayload(event.resubmitUrl, payload, this.repo.mode === "live");
    const updated = await this.repo.patchEvent(id, { status: "retried", inputPayload: payload });
    return { event: toPublic(updated), note: result.note };
  }

  async ingest(
    source: StoredWorkflowSource,
    envelope: WorkflowEventEnvelope,
    channel: IngestChannel,
  ): Promise<WorkflowEventIngestResult> {
    const executionId = envelope.execution?.external_id ?? null;
    const dedupKey =
      executionId !== null
        ? `${envelope.event_type}:${executionId}`
        : `${envelope.event_type}:${payloadHash(envelope)}`;
    const { event, duplicate } = await this.repo.insertEvent({
      orgId: source.orgId,
      sourceId: source.id,
      eventType: envelope.event_type,
      workflowExternalId: envelope.workflow.external_id,
      workflowName: envelope.workflow.name,
      executionExternalId: executionId,
      executionUrl: envelope.execution?.url ?? null,
      errorMessage: envelope.error.message,
      errorNode: envelope.error.node ?? null,
      errorStack: envelope.error.stack ?? null,
      inputPayload: envelope.input_payload ?? null,
      resubmitUrl: envelope.resubmit_url ?? null,
      rawPayload: envelope.raw ?? {},
      dedupKey,
      occurredAt: envelope.occurred_at,
      ingestChannel: channel,
    });
    return { id: event.id, duplicate };
  }

  async createSource(input: WorkflowSourceCreateBody): Promise<WorkflowSourceCreateResult> {
    const ingestToken = `awm_ingest_${randomBytes(24).toString("base64url")}`;
    const source = await this.repo.createSource({
      name: input.name,
      platform: input.platform,
      baseUrl: input.baseUrl ?? null,
      ingestTokenHash: sha256Hex(ingestToken),
    });
    return {
      source: {
        id: source.id,
        name: source.name,
        platform: source.platform,
        sweepEnabled: source.sweepEnabled,
      },
      ingestToken,
      note: this.sampleNote(),
    };
  }

  private async mustGet(id: string): Promise<StoredWorkflowEvent> {
    const event = await this.repo.getEvent(id);
    if (event === null) {
      throw new NotFoundException(`Workflow event ${id} not found`);
    }
    return event;
  }

  private async mustGetSource(sourceId: string): Promise<StoredWorkflowSource> {
    const sources = await this.repo.listSources();
    const source = sources.find((s) => s.id === sourceId);
    if (source === undefined) {
      throw new NotFoundException(`Workflow source ${sourceId} not found`);
    }
    return source;
  }

  private sampleNote(): string | null {
    return this.repo.mode === "sample" ? "Sample mode — stored in memory only" : null;
  }
}

function toPublic(event: StoredWorkflowEvent): WorkflowFailureEvent {
  const { orgId, sourceId, dedupKey, resubmitUrl, ...pub } = event;
  void orgId;
  void sourceId;
  void dedupKey;
  void resubmitUrl;
  return pub;
}

function deriveStats(events: StoredWorkflowEvent[], sourcesConnected: number): WorkflowEventsStats {
  const now = Date.now();
  return {
    needsAttention: events.filter((e) => OPEN_STATUSES.has(e.status)).length,
    failures24h: events.filter((e) => now - new Date(e.occurredAt).getTime() < DAY_MS).length,
    deactivatedWorkflows: events.filter(
      (e) => e.eventType === "workflow_deactivated" && e.status !== "resolved",
    ).length,
    retriedToday: events.filter(
      (e) => e.retryExecutionId !== null && now - new Date(e.occurredAt).getTime() < DAY_MS,
    ).length,
    sourcesConnected,
  };
}

function payloadHash(envelope: WorkflowEventEnvelope): string {
  return createHash("sha256")
    .update(`${envelope.workflow.external_id}|${envelope.occurred_at}|${envelope.error.message}`)
    .digest("hex")
    .slice(0, 24);
}
