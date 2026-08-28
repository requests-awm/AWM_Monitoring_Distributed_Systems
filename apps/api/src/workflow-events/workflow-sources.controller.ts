import { BadRequestException, Body, Controller, Post } from "@nestjs/common";
import { WorkflowSourceCreateBody, type WorkflowSourceCreateResult } from "@awm/shared";

import { WorkflowEventsService } from "./workflow-events.service";

@Controller("workflow-sources")
export class WorkflowSourcesController {
  constructor(private readonly workflowEvents: WorkflowEventsService) {}

  /**
   * Connects a new app/platform to the failure inbox. Returns the ingest
   * bearer token exactly once — only its hash is stored.
   */
  @Post()
  create(@Body() body: unknown): Promise<WorkflowSourceCreateResult> {
    const parsed = WorkflowSourceCreateBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Source validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    return this.workflowEvents.createSource(parsed.data);
  }
}
