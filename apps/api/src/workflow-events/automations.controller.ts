import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  N8nWorkflowToggleBody,
  ZapInventoryPushBody,
  type AutomationInventoryResponse,
  type N8nInsightsResponse,
  type N8nWorkflowInspection,
  type N8nWorkflowToggleResult,
} from "@awm/shared";
import { Query } from "@nestjs/common";

import { MinRole, RolesGuard, currentUser } from "../auth/roles.guard";
import { env } from "../config/env";
import { AutomationsService } from "./automations.service";
import { N8nInsightsService } from "./n8n-insights.service";

@Controller()
@UseGuards(RolesGuard)
export class AutomationsController {
  constructor(
    private readonly automations: AutomationsService,
    private readonly n8nInsights: N8nInsightsService,
  ) {}

  /** n8n execution overview (prod executions, failure rate, runtime, per-day). */
  @Get("n8n/insights")
  insights(@Query("days") days: string | undefined): Promise<N8nInsightsResponse> {
    const window = days === "30" ? 30 : 7;
    return this.n8nInsights.insights(window);
  }

  /** In-app troubleshooting: recent executions + failing-node tally for one workflow. */
  @Get("n8n/workflows/:workflowId/inspect")
  inspect(@Param("workflowId") workflowId: string): Promise<N8nWorkflowInspection> {
    return this.n8nInsights.inspect(workflowId);
  }

  /** Retry one n8n execution straight from the inspector. */
  @Post("n8n/executions/:executionId/retry")
  @MinRole("operator")
  @HttpCode(200)
  retryExecution(@Param("executionId") executionId: string): Promise<{ retryExecutionId: string }> {
    return this.n8nInsights.retryExecution(executionId);
  }

  /** Inventory of every workflow/Zap across connected sources, with failure counts. */
  @Get("automations")
  inventory(): Promise<AutomationInventoryResponse> {
    return this.automations.inventory();
  }

  /** Turn an n8n workflow on/off from the dashboard (real write to the instance). */
  @Post("automations/n8n/:workflowId/toggle")
  @MinRole("operator")
  @HttpCode(200)
  toggle(
    @Param("workflowId") workflowId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ): Promise<N8nWorkflowToggleResult> {
    const parsed = N8nWorkflowToggleBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException("Body must be { active: boolean }");
    }
    return this.automations.toggleN8nWorkflow(workflowId, parsed.data.active, currentUser(req).email);
  }

  /** Zap-list snapshot push (Zapier has no customer-facing list API). Worker-token auth. */
  @Post("internal/zap-inventory")
  @HttpCode(200)
  pushZaps(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ): { stored: number } {
    if (authorization !== `Bearer ${env.WORKER_TOKEN}`) {
      throw new UnauthorizedException("Invalid worker token");
    }
    const parsed = ZapInventoryPushBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Zap inventory validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    return this.automations.storeZapSnapshot(parsed.data);
  }
}
