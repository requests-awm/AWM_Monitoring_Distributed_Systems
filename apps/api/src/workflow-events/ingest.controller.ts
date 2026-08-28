import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  UnauthorizedException,
} from "@nestjs/common";
import { WorkflowEventEnvelope, type WorkflowEventIngestResult } from "@awm/shared";

import { sha256Hex } from "../lib/secrets";
import { WorkflowEventsService } from "./workflow-events.service";
import {
  WORKFLOW_EVENTS_REPOSITORY,
  type WorkflowEventsRepository,
} from "./workflow-events.repository";
import { Inject } from "@nestjs/common";

@Controller("ingest")
export class IngestController {
  constructor(
    private readonly workflowEvents: WorkflowEventsService,
    @Inject(WORKFLOW_EVENTS_REPOSITORY) private readonly repo: WorkflowEventsRepository,
  ) {}

  /**
   * Receives normalized failure events from the n8n error-handler workflow,
   * Zapier Manager webhooks, and the reconciliation sweep. Authenticated by a
   * per-source bearer token; idempotent on (source, event_type, execution id).
   */
  @Post("workflow-events")
  @HttpCode(200)
  async ingest(
    @Headers("authorization") authorization: string | undefined,
    @Headers("x-ingest-channel") channelHeader: string | undefined,
    @Body() body: unknown,
  ): Promise<WorkflowEventIngestResult> {
    const token = extractBearer(authorization);
    const source = await this.repo.findSourceByTokenHash(sha256Hex(token));
    if (source === null) {
      throw new UnauthorizedException("Unknown ingest token");
    }
    const parsed = WorkflowEventEnvelope.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Envelope validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    if (parsed.data.platform !== source.platform) {
      throw new BadRequestException(
        `Envelope platform "${parsed.data.platform}" does not match source platform "${source.platform}"`,
      );
    }
    return this.workflowEvents.ingest(
      source,
      parsed.data,
      channelHeader === "sweep" ? "sweep" : "push",
    );
  }
}

function extractBearer(authorization: string | undefined): string {
  if (authorization === undefined || !authorization.toLowerCase().startsWith("bearer ")) {
    throw new UnauthorizedException("Missing bearer token");
  }
  const token = authorization.slice(7).trim();
  if (token.length === 0) {
    throw new UnauthorizedException("Missing bearer token");
  }
  return token;
}
