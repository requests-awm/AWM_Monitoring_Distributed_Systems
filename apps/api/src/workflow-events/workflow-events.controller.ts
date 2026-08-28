import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  WorkflowEventAssignBody,
  WorkflowEventResubmitBody,
  type WorkflowEventActionResult,
  type WorkflowEventsResponse,
} from "@awm/shared";

import { WorkflowEventsService } from "./workflow-events.service";

@Controller("workflow-events")
export class WorkflowEventsController {
  constructor(private readonly workflowEvents: WorkflowEventsService) {}

  @Get()
  getEvents(): Promise<WorkflowEventsResponse> {
    return this.workflowEvents.getEvents();
  }

  @Post(":id/acknowledge")
  @HttpCode(200)
  acknowledge(@Param("id") id: string): Promise<WorkflowEventActionResult> {
    return this.workflowEvents.acknowledge(id);
  }

  @Post(":id/resolve")
  @HttpCode(200)
  resolve(@Param("id") id: string): Promise<WorkflowEventActionResult> {
    return this.workflowEvents.resolve(id);
  }

  @Post(":id/ignore")
  @HttpCode(200)
  ignore(@Param("id") id: string): Promise<WorkflowEventActionResult> {
    return this.workflowEvents.ignore(id);
  }

  @Post(":id/assign")
  @HttpCode(200)
  assign(@Param("id") id: string, @Body() body: unknown): Promise<WorkflowEventActionResult> {
    const parsed = WorkflowEventAssignBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("assignee must be a non-empty string or null");
    }
    return this.workflowEvents.assign(id, parsed.data.assignee);
  }

  @Post(":id/retry")
  @HttpCode(200)
  retry(@Param("id") id: string): Promise<WorkflowEventActionResult> {
    return this.workflowEvents.retry(id);
  }

  @Post(":id/apply-fix")
  @HttpCode(200)
  applyFix(@Param("id") id: string): Promise<WorkflowEventActionResult> {
    return this.workflowEvents.applyFix(id);
  }

  @Post(":id/resubmit")
  @HttpCode(200)
  resubmit(@Param("id") id: string, @Body() body: unknown): Promise<WorkflowEventActionResult> {
    const parsed = WorkflowEventResubmitBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("payload must be a JSON object");
    }
    return this.workflowEvents.resubmit(id, parsed.data.payload);
  }
}
