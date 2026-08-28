import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Request, Response } from "express";
import {
  AlertRuleCreateBody,
  ChannelCreateBody,
  MaintenanceWindowCreateBody,
  type AlertRuleDto,
  type MaintenanceWindowDto,
  type NotificationChannelDto,
  type UptimeReportResponse,
} from "@awm/shared";

import { MinRole, RolesGuard, currentUser } from "../auth/roles.guard";
import { MonitoringService } from "./monitoring.service";
import { SettingsService } from "./settings.service";

function parse<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: { path: (string | number)[]; message: string }[] } } }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data === undefined) {
    throw new BadRequestException({
      message: "Validation failed",
      issues: parsed.error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [],
    });
  }
  return parsed.data;
}

@Controller("channels")
@UseGuards(RolesGuard)
export class ChannelsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list(): NotificationChannelDto[] {
    return this.settings.listChannels();
  }

  @Post()
  @MinRole("administrator")
  create(@Body() body: unknown, @Req() req: Request): NotificationChannelDto {
    return this.settings.createChannel(parse(ChannelCreateBody, body), currentUser(req).email);
  }

  @Delete(":id")
  @MinRole("administrator")
  @HttpCode(204)
  remove(@Param("id") id: string, @Req() req: Request): void {
    this.settings.deleteChannel(id, currentUser(req).email);
  }
}

@Controller("alert-rules")
@UseGuards(RolesGuard)
export class AlertRulesController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  list(): AlertRuleDto[] {
    return this.settings.listRules();
  }

  @Post()
  @MinRole("administrator")
  create(@Body() body: unknown, @Req() req: Request): AlertRuleDto {
    return this.settings.createRule(parse(AlertRuleCreateBody, body), currentUser(req).email);
  }

  @Delete(":id")
  @MinRole("administrator")
  @HttpCode(204)
  remove(@Param("id") id: string, @Req() req: Request): void {
    this.settings.deleteRule(id, currentUser(req).email);
  }
}

@Controller("maintenance-windows")
@UseGuards(RolesGuard)
export class MaintenanceController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get()
  list(): MaintenanceWindowDto[] {
    return this.monitoring.listMaintenanceWindows();
  }

  @Post()
  @MinRole("operator")
  create(@Body() body: unknown, @Req() req: Request): MaintenanceWindowDto {
    return this.monitoring.createMaintenanceWindow(
      parse(MaintenanceWindowCreateBody, body),
      currentUser(req).email,
    );
  }

  @Delete(":id")
  @MinRole("operator")
  @HttpCode(204)
  remove(@Param("id") id: string, @Req() req: Request): void {
    this.monitoring.deleteMaintenanceWindow(id, currentUser(req).email);
  }
}

@Controller("reports")
@UseGuards(RolesGuard)
export class ReportsController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get("uptime")
  uptime(
    @Query("from") from: string | undefined,
    @Query("to") to: string | undefined,
    @Query("format") format: string | undefined,
    @Res({ passthrough: true }) res: Response,
  ): UptimeReportResponse | string {
    if (format === "csv") {
      res.setHeader("content-type", "text/csv");
      res.setHeader("content-disposition", 'attachment; filename="uptime-report.csv"');
      return this.monitoring.uptimeReportCsv(from, to);
    }
    return this.monitoring.uptimeReport(from, to);
  }
}
