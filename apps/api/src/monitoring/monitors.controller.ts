import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  MonitorCreateBody,
  MonitorUpdateBody,
  ProjectCreateBody,
  type MonitorDetailResponse,
  type MonitorDto,
  type MonitorListItem,
  type ProjectDto,
} from "@awm/shared";

import { MinRole, RolesGuard, currentUser } from "../auth/roles.guard";
import { MonitoringService } from "./monitoring.service";

function parseBody<T>(schema: { safeParse: (v: unknown) => { success: boolean; data?: T; error?: { issues: { path: (string | number)[]; message: string }[] } } }, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success || parsed.data === undefined) {
    throw new BadRequestException({
      message: "Validation failed",
      issues: parsed.error?.issues.map((i) => `${i.path.join(".")}: ${i.message}`) ?? [],
    });
  }
  return parsed.data;
}

@Controller("monitors")
@UseGuards(RolesGuard)
export class MonitorsController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get()
  list(): MonitorListItem[] {
    return this.monitoring.listMonitors();
  }

  @Get(":id")
  detail(@Param("id") id: string): MonitorDetailResponse {
    return this.monitoring.getMonitorDetail(id);
  }

  @Post()
  @MinRole("operator")
  create(@Body() body: unknown, @Req() req: Request): MonitorDto {
    return this.monitoring.createMonitor(parseBody(MonitorCreateBody, body), currentUser(req).email);
  }

  @Patch(":id")
  @MinRole("operator")
  update(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): MonitorDto {
    return this.monitoring.updateMonitor(id, parseBody(MonitorUpdateBody, body), currentUser(req).email);
  }

  @Delete(":id")
  @MinRole("administrator")
  @HttpCode(204)
  remove(@Param("id") id: string, @Req() req: Request): void {
    this.monitoring.deleteMonitor(id, currentUser(req).email);
  }

  @Post(":id/test")
  @MinRole("operator")
  @HttpCode(200)
  test(@Param("id") id: string): { note: string } {
    return this.monitoring.testMonitor(id);
  }
}

@Controller("projects")
@UseGuards(RolesGuard)
export class ProjectsController {
  constructor(private readonly monitoring: MonitoringService) {}

  @Get()
  list(): ProjectDto[] {
    return this.monitoring.listProjects();
  }

  @Post()
  @MinRole("administrator")
  create(@Body() body: unknown, @Req() req: Request): ProjectDto {
    return this.monitoring.createProject(parseBody(ProjectCreateBody, body), currentUser(req).email);
  }
}
