import { NotFoundException } from "@nestjs/common";
import {
  createPrismaClient,
  Prisma,
  type WorkflowFailureEvent as DbWorkflowFailureEvent,
  type WorkflowSource as DbWorkflowSource,
} from "@awm/db";
import type { WorkflowFixSuggestion } from "@awm/shared";

import { env } from "../config/env";
import { decryptSecret } from "../lib/secrets";
import type {
  NewWorkflowEvent,
  NewWorkflowSource,
  StoredWorkflowEvent,
  StoredWorkflowSource,
  WorkflowEventPatch,
  WorkflowEventsRepository,
} from "./workflow-events.repository";

type EventRow = DbWorkflowFailureEvent & { source: Pick<DbWorkflowSource, "name" | "platform"> };
type SourceRow = DbWorkflowSource;

const EVENT_INCLUDE = { source: { select: { name: true, platform: true } } };

/** Live-mode store against awm_monitoring (service-role connection). */
export class PrismaWorkflowEventsRepository implements WorkflowEventsRepository {
  readonly mode = "live" as const;

  private readonly prisma = createPrismaClient();

  private mapSource(row: SourceRow): StoredWorkflowSource {
    let apiKey: string | null = null;
    if (row.apiKeyEncrypted !== null && env.ENCRYPTION_KEY !== undefined) {
      apiKey = decryptSecret(row.apiKeyEncrypted, env.ENCRYPTION_KEY);
    }
    return {
      id: row.id,
      orgId: row.orgId,
      name: row.name,
      platform: row.platform,
      sweepEnabled: row.sweepEnabled,
      baseUrl: row.baseUrl,
      apiKey,
      ingestTokenHash: row.ingestTokenHash,
    };
  }

  private mapEvent(row: EventRow): StoredWorkflowEvent {
    const platform = row.source.platform as StoredWorkflowEvent["platform"];
    const inputPayload = (row.inputPayload ?? null) as Record<string, unknown> | null;
    return {
      id: row.id,
      platform,
      eventType: row.eventType,
      status: row.status,
      sourceName: row.source.name,
      workflowExternalId: row.workflowExternalId,
      workflowName: row.workflowName,
      executionExternalId: row.executionExternalId,
      executionUrl: row.executionUrl,
      errorMessage: row.errorMessage,
      errorNode: row.errorNode,
      errorStack: row.errorStack,
      occurredAt: row.occurredAt.toISOString(),
      receivedAt: row.receivedAt.toISOString(),
      ingestChannel: row.ingestChannel,
      assignee: row.assignee,
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
      retryExecutionId: row.retryExecutionId,
      canRetry: platform === "n8n" && row.executionExternalId !== null,
      inputPayload,
      canResubmit: row.resubmitUrl !== null && inputPayload !== null,
      fixSuggestion: (row.fixSuggestion ?? null) as WorkflowFixSuggestion | null,
      rawPayload: (row.rawPayload ?? {}) as Record<string, unknown>,
      orgId: row.orgId,
      sourceId: row.sourceId,
      dedupKey: row.dedupKey,
      resubmitUrl: row.resubmitUrl,
    };
  }

  async listSources(): Promise<StoredWorkflowSource[]> {
    const rows = await this.prisma.workflowSource.findMany({ where: { isDeleted: false } });
    return rows.map((r) => this.mapSource(r));
  }

  async listEvents(): Promise<StoredWorkflowEvent[]> {
    const rows = await this.prisma.workflowFailureEvent.findMany({
      where: { isDeleted: false },
      include: EVENT_INCLUDE,
      orderBy: { receivedAt: "desc" },
      take: 500,
    });
    return rows.map((r) => this.mapEvent(r));
  }

  async getEvent(id: string): Promise<StoredWorkflowEvent | null> {
    const row = await this.prisma.workflowFailureEvent.findFirst({
      where: { id, isDeleted: false },
      include: EVENT_INCLUDE,
    });
    return row === null ? null : this.mapEvent(row);
  }

  async patchEvent(id: string, patch: WorkflowEventPatch): Promise<StoredWorkflowEvent> {
    const existing = await this.prisma.workflowFailureEvent.findFirst({ where: { id, isDeleted: false } });
    if (existing === null) {
      throw new NotFoundException(`Workflow event ${id} not found`);
    }
    const row = await this.prisma.workflowFailureEvent.update({
      where: { id },
      data: {
        status: patch.status,
        assignee: patch.assignee,
        acknowledgedAt: patch.acknowledgedAt === undefined ? undefined : dateOrNull(patch.acknowledgedAt),
        resolvedAt: patch.resolvedAt === undefined ? undefined : dateOrNull(patch.resolvedAt),
        retryExecutionId: patch.retryExecutionId,
        inputPayload:
          patch.inputPayload === undefined
            ? undefined
            : ((patch.inputPayload ?? {}) as Prisma.InputJsonValue),
        fixSuggestion:
          patch.fixSuggestion === undefined
            ? undefined
            : patch.fixSuggestion === null
              ? Prisma.DbNull
              : (patch.fixSuggestion as unknown as Prisma.InputJsonValue),
      },
      include: EVENT_INCLUDE,
    });
    return this.mapEvent(row);
  }

  async findSourceByTokenHash(tokenHash: string): Promise<StoredWorkflowSource | null> {
    const row = await this.prisma.workflowSource.findFirst({
      where: { ingestTokenHash: tokenHash, isDeleted: false },
    });
    return row === null ? null : this.mapSource(row);
  }

  async insertEvent(record: NewWorkflowEvent): Promise<{ event: StoredWorkflowEvent; duplicate: boolean }> {
    const existing = await this.prisma.workflowFailureEvent.findUnique({
      where: { sourceId_dedupKey: { sourceId: record.sourceId, dedupKey: record.dedupKey } },
      include: EVENT_INCLUDE,
    });
    if (existing !== null) {
      return { event: this.mapEvent(existing), duplicate: true };
    }
    const row = await this.prisma.workflowFailureEvent.create({
      data: {
        orgId: record.orgId,
        sourceId: record.sourceId,
        eventType: record.eventType,
        workflowExternalId: record.workflowExternalId,
        workflowName: record.workflowName,
        executionExternalId: record.executionExternalId,
        executionUrl: record.executionUrl,
        errorMessage: record.errorMessage,
        errorNode: record.errorNode,
        errorStack: record.errorStack,
        inputPayload:
          record.inputPayload === null ? undefined : (record.inputPayload as Prisma.InputJsonValue),
        resubmitUrl: record.resubmitUrl,
        rawPayload: record.rawPayload as Prisma.InputJsonValue,
        dedupKey: record.dedupKey,
        occurredAt: new Date(record.occurredAt),
        ingestChannel: record.ingestChannel,
      },
      include: EVENT_INCLUDE,
    });
    return { event: this.mapEvent(row), duplicate: false };
  }

  async createSource(record: NewWorkflowSource): Promise<StoredWorkflowSource> {
    // TODO(m1): take the org from the authenticated user's context once RBAC lands.
    const org = await this.prisma.organisation.findFirst({ where: { isDeleted: false } });
    if (org === null) {
      throw new NotFoundException("No organisation exists yet — seed one before connecting sources");
    }
    const row = await this.prisma.workflowSource.create({
      data: {
        orgId: org.id,
        name: record.name,
        platform: record.platform,
        baseUrl: record.baseUrl,
        ingestTokenHash: record.ingestTokenHash,
      },
    });
    return this.mapSource(row);
  }
}

function dateOrNull(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}
