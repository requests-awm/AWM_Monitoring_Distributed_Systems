import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { Request } from "express";
import {
  IncidentNoteBody,
  WorkflowEventAssignBody,
  type IncidentDetailResponse,
  type IncidentDto,
} from "@awm/shared";

import { MinRole, RolesGuard, currentUser } from "../auth/roles.guard";
import { IncidentsService } from "./incidents.service";

@Controller("incidents")
@UseGuards(RolesGuard)
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  list(): IncidentDto[] {
    return this.incidents.list();
  }

  @Get(":id")
  detail(@Param("id") id: string): IncidentDetailResponse {
    return this.incidents.detail(id);
  }

  @Post(":id/acknowledge")
  @MinRole("operator")
  @HttpCode(200)
  acknowledge(@Param("id") id: string, @Req() req: Request): IncidentDto {
    return this.incidents.acknowledge(id, currentUser(req).email);
  }

  @Post(":id/resolve")
  @MinRole("operator")
  @HttpCode(200)
  resolve(@Param("id") id: string, @Req() req: Request): IncidentDto {
    return this.incidents.resolve(id, currentUser(req).email);
  }

  @Post(":id/mute")
  @MinRole("operator")
  @HttpCode(200)
  mute(@Param("id") id: string, @Req() req: Request): IncidentDto {
    return this.incidents.mute(id, currentUser(req).email);
  }

  @Post(":id/assign")
  @MinRole("operator")
  @HttpCode(200)
  assign(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): IncidentDto {
    const parsed = WorkflowEventAssignBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException("assignee must be a string or null");
    return this.incidents.assign(id, parsed.data.assignee, currentUser(req).email);
  }

  @Post(":id/notes")
  @MinRole("operator")
  @HttpCode(200)
  note(@Param("id") id: string, @Body() body: unknown, @Req() req: Request): IncidentDto {
    const parsed = IncidentNoteBody.safeParse(body);
    if (!parsed.success) throw new BadRequestException("message is required");
    return this.incidents.addNote(id, parsed.data.message, currentUser(req).email);
  }
}
