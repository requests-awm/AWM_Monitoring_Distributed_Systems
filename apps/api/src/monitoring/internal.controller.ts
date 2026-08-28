import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import {
  HeartbeatPingBody,
  MonitorResultReport,
  type CurrentUserDto,
  type MonitorJob,
} from "@awm/shared";

import { currentUser } from "../auth/roles.guard";
import { env } from "../config/env";
import { IncidentEngine } from "./incident.engine";
import { MonitoringStore } from "./monitoring.store";

function assertWorker(authorization: string | undefined): void {
  if (authorization !== `Bearer ${env.WORKER_TOKEN}`) {
    throw new UnauthorizedException("Invalid worker token");
  }
}

/** Worker ↔ API contract: claim due checks, report results. */
@Controller("internal")
export class InternalController {
  constructor(
    private readonly store: MonitoringStore,
    private readonly engine: IncidentEngine,
  ) {}

  @Get("monitors/due")
  due(@Headers("authorization") authorization: string | undefined): MonitorJob[] {
    assertWorker(authorization);
    const now = Date.now();
    const jobs: MonitorJob[] = [];
    for (const monitor of this.store.activeMonitors()) {
      if (!monitor.enabled || monitor.monitorType === "heartbeat") continue;
      if (monitor.nextDueAt > now) continue;
      // Claim: advance the schedule so a second worker replica won't double-run it.
      monitor.nextDueAt = now + monitor.checkIntervalMinutes * 60_000;
      jobs.push({
        id: monitor.id,
        monitorType: monitor.monitorType,
        timeoutMs: monitor.timeoutMs,
        configuration: monitor.configuration,
      });
    }
    return jobs;
  }

  @Post("monitor-results")
  @HttpCode(200)
  report(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ): { ok: true } {
    assertWorker(authorization);
    const parsed = MonitorResultReport.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Result validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    const monitor = this.store.monitors.get(parsed.data.monitorId);
    if (monitor === undefined || monitor.isDeleted) {
      throw new NotFoundException(`Monitor ${parsed.data.monitorId} not found`);
    }
    const { monitorId, ...report } = parsed.data;
    void monitorId;
    this.engine.processResult(monitor, report);
    return { ok: true };
  }
}

/** Public heartbeat ingestion — jobs ping this on every run (spec Task 5.1). */
@Controller("heartbeats")
export class HeartbeatsController {
  constructor(
    private readonly store: MonitoringStore,
    private readonly engine: IncidentEngine,
  ) {}

  @Post(":token")
  @HttpCode(200)
  ping(@Param("token") token: string, @Body() body: unknown): { ok: true } {
    const monitor = this.store
      .activeMonitors()
      .find((m) => m.monitorType === "heartbeat" && m.heartbeatToken === token);
    if (monitor === undefined) {
      throw new NotFoundException("Unknown heartbeat token");
    }
    const parsed = HeartbeatPingBody.safeParse(body ?? {});
    this.engine.recordHeartbeatPing(monitor, parsed.success ? parsed.data : { event_type: "success" });
    return { ok: true };
  }
}

@Controller()
export class MiscController {
  private readonly logger = new Logger("WebhookSink");

  @Get("me")
  me(@Req() req: Request): CurrentUserDto {
    return currentUser(req);
  }

  /** Local delivery target for the sample webhook channel — logs and accepts. */
  @Post("dev/webhook-sink")
  @HttpCode(200)
  sink(@Body() body: unknown): { received: true } {
    this.logger.log(`webhook received`, { body: JSON.stringify(body).slice(0, 400) });
    return { received: true };
  }
}
