import { randomBytes } from "node:crypto";

import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import {
  MONITOR_CONFIG_SCHEMAS,
  type MaintenanceWindowCreateBody,
  type MaintenanceWindowDto,
  type MonitorCreateBody,
  type MonitorDetailResponse,
  type MonitorDto,
  type MonitorListItem,
  type MonitorResultDto,
  type MonitorUpdateBody,
  type ProjectCreateBody,
  type ProjectDto,
  type UptimeReportResponse,
  type UptimeReportRow,
} from "@awm/shared";

import {
  MonitoringStore,
  type MonitorRecord,
  type MonitorResultRecord,
} from "./monitoring.store";

const DAY_MS = 24 * 60 * 60 * 1000;
const SENSITIVE_KEYS = new Set(["password", "token", "headerValue", "apiKey", "secret"]);

@Injectable()
export class MonitoringService {
  constructor(private readonly store: MonitoringStore) {}

  // --- projects ----------------------------------------------------------

  listProjects(): ProjectDto[] {
    return this.store.projects
      .filter((p) => !p.isDeleted)
      .map((p) => ({ id: p.id, name: p.name, slug: p.slug, environments: p.environments }));
  }

  createProject(body: ProjectCreateBody, actor: string): ProjectDto {
    const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const project = {
      id: this.store.newId("proj"),
      name: body.name,
      slug,
      environments: body.environments.map((name) => ({ id: this.store.newId("env"), name })),
      isDeleted: false,
    };
    this.store.projects.push(project);
    this.store.audit("project_created", actor, "project", project.id, { name: body.name });
    return { id: project.id, name: project.name, slug: project.slug, environments: project.environments };
  }

  // --- monitors ----------------------------------------------------------

  listMonitors(): MonitorListItem[] {
    return this.store.activeMonitors().map((m) => this.toListItem(m));
  }

  getMonitorDetail(id: string): MonitorDetailResponse {
    const monitor = this.mustGetMonitor(id);
    const recent = [...this.store.resultsFor(id)].slice(-50).reverse();
    return {
      monitor: this.toListItem(monitor),
      recentResults: recent.map(toResultDto),
    };
  }

  createMonitor(body: MonitorCreateBody, actor: string): MonitorDto {
    this.validateConfig(body.monitorType, body.configuration);
    const project = this.store.project(body.projectId);
    if (project === undefined) throw new BadRequestException("Unknown project");
    if (!project.environments.some((e) => e.id === body.environmentId)) {
      throw new BadRequestException("Environment does not belong to that project");
    }
    const monitor: MonitorRecord = {
      id: this.store.newId("mon"),
      name: body.name,
      description: body.description ?? null,
      projectId: body.projectId,
      environmentId: body.environmentId,
      monitorType: body.monitorType,
      checkIntervalMinutes: body.checkIntervalMinutes,
      timeoutMs: body.timeoutMs,
      retryCount: body.retryCount,
      severity: body.severity,
      tags: body.tags,
      enabled: body.enabled,
      configuration: body.configuration,
      heartbeatToken:
        body.monitorType === "heartbeat" ? `hb_${randomBytes(16).toString("base64url")}` : null,
      createdAt: new Date().toISOString(),
      isDeleted: false,
      nextDueAt: Date.now(),
      consecutiveFails: 0,
      lastHeartbeatAt: null,
      lastMissedEmitAt: null,
    };
    this.store.monitors.set(monitor.id, monitor);
    this.store.audit("monitor_created", actor, "monitor", monitor.id, { name: monitor.name });
    return this.toDto(monitor);
  }

  updateMonitor(id: string, body: MonitorUpdateBody, actor: string): MonitorDto {
    const monitor = this.mustGetMonitor(id);
    const nextType = body.monitorType ?? monitor.monitorType;
    if (body.configuration !== undefined) this.validateConfig(nextType, body.configuration);
    Object.assign(monitor, {
      ...body,
      description: body.description === undefined ? monitor.description : (body.description ?? null),
    });
    if (body.checkIntervalMinutes !== undefined || body.enabled !== undefined) {
      monitor.nextDueAt = Date.now(); // reschedule immediately on cadence/enable changes
    }
    this.store.audit("monitor_changed", actor, "monitor", monitor.id, { fields: Object.keys(body) });
    return this.toDto(monitor);
  }

  deleteMonitor(id: string, actor: string): void {
    const monitor = this.mustGetMonitor(id);
    monitor.isDeleted = true;
    monitor.enabled = false;
    this.store.audit("monitor_deleted", actor, "monitor", monitor.id, null);
  }

  /** Queue an immediate check — the worker picks it up on its next poll. */
  testMonitor(id: string): { note: string } {
    const monitor = this.mustGetMonitor(id);
    if (monitor.monitorType === "heartbeat") {
      throw new BadRequestException("Heartbeat monitors are pinged by the job itself");
    }
    monitor.nextDueAt = Date.now();
    return { note: "Check queued — the worker runs it within a few seconds" };
  }

  // --- maintenance windows ------------------------------------------------

  listMaintenanceWindows(): MaintenanceWindowDto[] {
    const now = Date.now();
    return this.store.maintenanceWindows
      .filter((w) => !w.isDeleted)
      .map((w) => ({
        id: w.id,
        name: w.name,
        scope: w.scope,
        projectId: w.projectId,
        environmentId: w.environmentId,
        monitorId: w.monitorId,
        startsAt: w.startsAt,
        endsAt: w.endsAt,
        muteExisting: w.muteExisting,
        active: now >= new Date(w.startsAt).getTime() && now <= new Date(w.endsAt).getTime(),
      }));
  }

  createMaintenanceWindow(body: MaintenanceWindowCreateBody, actor: string): MaintenanceWindowDto {
    if (new Date(body.endsAt).getTime() <= new Date(body.startsAt).getTime()) {
      throw new BadRequestException("endsAt must be after startsAt");
    }
    const record = {
      id: this.store.newId("mw"),
      name: body.name,
      scope: body.scope,
      projectId: body.projectId ?? null,
      environmentId: body.environmentId ?? null,
      monitorId: body.monitorId ?? null,
      startsAt: body.startsAt,
      endsAt: body.endsAt,
      muteExisting: body.muteExisting,
      isDeleted: false,
    };
    this.store.maintenanceWindows.push(record);
    this.store.audit("maintenance_created", actor, "maintenance_window", record.id, { name: body.name });
    return { ...record, active: Date.now() >= new Date(record.startsAt).getTime() && Date.now() <= new Date(record.endsAt).getTime() };
  }

  deleteMaintenanceWindow(id: string, actor: string): void {
    const record = this.store.maintenanceWindows.find((w) => w.id === id && !w.isDeleted);
    if (record === undefined) throw new NotFoundException(`Maintenance window ${id} not found`);
    record.isDeleted = true;
    this.store.audit("maintenance_deleted", actor, "maintenance_window", id, null);
  }

  // --- reports -------------------------------------------------------------

  uptimeReport(fromIso: string | undefined, toIso: string | undefined): UptimeReportResponse {
    const to = toIso !== undefined ? new Date(toIso).getTime() : Date.now();
    const from = fromIso !== undefined ? new Date(fromIso).getTime() : to - 7 * DAY_MS;
    const rows: UptimeReportRow[] = this.store.activeMonitors().map((m) => {
      const project = this.store.project(m.projectId);
      const inRange = this.store
        .resultsFor(m.id)
        .filter((r) => {
          const t = new Date(r.checkedAt).getTime();
          return t >= from && t <= to;
        });
      const failures = inRange.filter((r) => !r.success);
      const responseTimes = inRange
        .map((r) => r.responseTimeMs)
        .filter((v): v is number => v !== null);
      const incidents = [...this.store.incidents.values()].filter(
        (i) => i.monitorId === m.id && new Date(i.startedAt).getTime() >= from && new Date(i.startedAt).getTime() <= to,
      );
      const ackDeltas = incidents
        .filter((i) => i.acknowledgedAt !== null)
        .map((i) => (new Date(i.acknowledgedAt as string).getTime() - new Date(i.startedAt).getTime()) / 1000);
      const resolveDeltas = incidents
        .filter((i) => i.resolvedAt !== null)
        .map((i) => (new Date(i.resolvedAt as string).getTime() - new Date(i.startedAt).getTime()) / 1000);
      return {
        monitorId: m.id,
        monitorName: m.name,
        projectName: project?.name ?? m.projectId,
        environmentName: this.store.environmentName(m.projectId, m.environmentId),
        checks: inRange.length,
        uptimePct:
          inRange.length === 0
            ? null
            : Math.round(((inRange.length - failures.length) / inRange.length) * 10000) / 100,
        downtimeMinutes: failures.length * m.checkIntervalMinutes,
        incidentCount: incidents.length,
        avgResponseMs:
          responseTimes.length === 0
            ? null
            : Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length),
        slowestResponseMs: responseTimes.length === 0 ? null : Math.max(...responseTimes),
        mttaSeconds: avg(ackDeltas),
        mttrSeconds: avg(resolveDeltas),
      };
    });
    return { from: new Date(from).toISOString(), to: new Date(to).toISOString(), rows };
  }

  uptimeReportCsv(fromIso: string | undefined, toIso: string | undefined): string {
    const report = this.uptimeReport(fromIso, toIso);
    const header =
      "monitor,project,environment,checks,uptime_pct,downtime_minutes,incidents,avg_response_ms,slowest_ms,mtta_seconds,mttr_seconds";
    const lines = report.rows.map((r) =>
      [
        csv(r.monitorName),
        csv(r.projectName),
        csv(r.environmentName),
        r.checks,
        r.uptimePct ?? "",
        r.downtimeMinutes,
        r.incidentCount,
        r.avgResponseMs ?? "",
        r.slowestResponseMs ?? "",
        r.mttaSeconds ?? "",
        r.mttrSeconds ?? "",
      ].join(","),
    );
    return [header, ...lines].join("\n");
  }

  // --- mapping -------------------------------------------------------------

  mustGetMonitor(id: string): MonitorRecord {
    const monitor = this.store.monitors.get(id);
    if (monitor === undefined || monitor.isDeleted) {
      throw new NotFoundException(`Monitor ${id} not found`);
    }
    return monitor;
  }

  private validateConfig(type: string, configuration: Record<string, unknown>): void {
    const schema = MONITOR_CONFIG_SCHEMAS[type as keyof typeof MONITOR_CONFIG_SCHEMAS];
    if (schema === undefined) {
      throw new BadRequestException(`Monitor type ${type} is not supported yet`);
    }
    const parsed = schema.safeParse(configuration);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Configuration validation failed",
        issues: parsed.error.issues.map((i: { path: (string | number)[]; message: string }) => `${i.path.join(".")}: ${i.message}`),
      });
    }
  }

  toDto(m: MonitorRecord): MonitorDto {
    const project = this.store.project(m.projectId);
    return {
      id: m.id,
      name: m.name,
      description: m.description,
      projectId: m.projectId,
      projectName: project?.name ?? m.projectId,
      environmentId: m.environmentId,
      environmentName: this.store.environmentName(m.projectId, m.environmentId),
      monitorType: m.monitorType,
      checkIntervalMinutes: m.checkIntervalMinutes,
      timeoutMs: m.timeoutMs,
      retryCount: m.retryCount,
      severity: m.severity,
      tags: m.tags,
      enabled: m.enabled,
      configuration: maskConfig(m.configuration),
      heartbeatToken: m.heartbeatToken,
      createdAt: m.createdAt,
    };
  }

  toListItem(m: MonitorRecord): MonitorListItem {
    const ring = this.store.resultsFor(m.id);
    const last = ring.length > 0 ? ring[ring.length - 1] : undefined;
    const dayAgo = Date.now() - DAY_MS;
    const inDay = ring.filter((r) => new Date(r.checkedAt).getTime() >= dayAgo);
    return {
      ...this.toDto(m),
      lastStatus: last?.status ?? null,
      lastCheckedAt: last?.checkedAt ?? null,
      lastResponseTimeMs: last?.responseTimeMs ?? null,
      uptime24hPct:
        inDay.length === 0
          ? null
          : Math.round((inDay.filter((r) => r.success).length / inDay.length) * 10000) / 100,
      history: ring.slice(-24).map((r) => r.status),
      openIncidents: this.store.openIncidentsFor(m.id).length,
      inMaintenance: this.store.inMaintenance(m),
      lastHeartbeatAt: m.lastHeartbeatAt === null ? null : new Date(m.lastHeartbeatAt).toISOString(),
    };
  }
}

function toResultDto(r: MonitorResultRecord): MonitorResultDto {
  return {
    id: r.id,
    status: r.status,
    success: r.success,
    responseTimeMs: r.responseTimeMs,
    statusCode: r.statusCode,
    failureReason: r.failureReason,
    checkedAt: r.checkedAt,
  };
}

function maskConfig(config: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (SENSITIVE_KEYS.has(key)) {
      masked[key] = "•••";
    } else if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      masked[key] = maskConfig(value as Record<string, unknown>);
    } else {
      masked[key] = value;
    }
  }
  return masked;
}

function avg(values: number[]): number | null {
  return values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function csv(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
