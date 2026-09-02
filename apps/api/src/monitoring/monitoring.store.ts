import { randomBytes, randomUUID } from "node:crypto";

import { Injectable } from "@nestjs/common";
import type {
  AlertRuleConditions,
  CheckResultStatus,
  IncidentStatus,
  MaintenanceScope,
  MonitorType,
  NotificationChannelType,
  Severity,
} from "@awm/shared";

import { env, seedDemoData } from "../config/env";

/**
 * Sample-mode store for the monitoring core. Same seam pattern as the
 * workflow-events store: swap for a Prisma implementation when DATABASE_URL
 * is set (interface extraction tracked in docs/CONTINUATION.md).
 *
 * Seeded monitors point at the platform itself and public endpoints, so real
 * check results flow with zero external dependencies.
 */

export interface EnvironmentRecord {
  id: string;
  name: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  slug: string;
  environments: EnvironmentRecord[];
  isDeleted: boolean;
}

export interface MonitorRecord {
  id: string;
  name: string;
  description: string | null;
  projectId: string;
  environmentId: string;
  monitorType: MonitorType;
  checkIntervalMinutes: number;
  timeoutMs: number;
  retryCount: number;
  severity: Severity;
  tags: string[];
  enabled: boolean;
  /** Unmasked; sensitive fields are masked at the DTO boundary. */
  configuration: Record<string, unknown>;
  heartbeatToken: string | null;
  createdAt: string;
  isDeleted: boolean;
  // Runtime (scheduler + engine state; lives in Redis/DB later)
  nextDueAt: number;
  consecutiveFails: number;
  lastHeartbeatAt: number | null;
  lastMissedEmitAt: number | null;
}

export interface MonitorResultRecord {
  id: string;
  monitorId: string;
  status: CheckResultStatus;
  success: boolean;
  responseTimeMs: number | null;
  statusCode: number | null;
  failureReason: string | null;
  metadata: Record<string, unknown> | null;
  checkedAt: string;
}

export interface IncidentEventRecord {
  id: string;
  eventType: string;
  message: string | null;
  actor: string | null;
  createdAt: string;
}

export interface IncidentRecord {
  id: string;
  monitorId: string;
  status: IncidentStatus;
  severity: Severity;
  title: string;
  summary: string | null;
  failureReason: string | null;
  dedupSignature: string;
  occurrenceCount: number;
  startedAt: string;
  lastOccurrenceAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  assignee: string | null;
  events: IncidentEventRecord[];
}

export interface ChannelRecord {
  id: string;
  name: string;
  channelType: NotificationChannelType;
  /** Unmasked (AES-encrypted in the DB later); masked at the DTO boundary. */
  config: Record<string, string>;
  enabled: boolean;
  isDeleted: boolean;
}

export interface AlertRuleRecord {
  id: string;
  name: string;
  channelId: string;
  conditions: AlertRuleConditions;
  escalationDelaySeconds: number | null;
  priority: number;
  enabled: boolean;
  isDeleted: boolean;
}

export interface MaintenanceWindowRecord {
  id: string;
  name: string;
  scope: MaintenanceScope;
  projectId: string | null;
  environmentId: string | null;
  monitorId: string | null;
  startsAt: string;
  endsAt: string;
  muteExisting: boolean;
  isDeleted: boolean;
}

export interface AuditRecord {
  id: string;
  action: string;
  actor: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const RESULT_RING_CAP = 300;

function nowIso(): string {
  return new Date().toISOString();
}

@Injectable()
export class MonitoringStore {
  readonly mode = "sample" as const;

  readonly projects: ProjectRecord[] = [];
  readonly monitors = new Map<string, MonitorRecord>();
  readonly results = new Map<string, MonitorResultRecord[]>();
  readonly incidents = new Map<string, IncidentRecord>();
  readonly channels: ChannelRecord[] = [];
  readonly alertRules: AlertRuleRecord[] = [];
  readonly maintenanceWindows: MaintenanceWindowRecord[] = [];
  readonly auditLog: AuditRecord[] = [];

  constructor() {
    this.seed();
  }

  // --- helpers ---------------------------------------------------------

  newId(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 8)}`;
  }

  audit(action: string, actor: string, entityType: string, entityId: string, metadata: Record<string, unknown> | null = null): void {
    this.auditLog.unshift({
      id: this.newId("aud"),
      action,
      actor,
      entityType,
      entityId,
      metadata,
      createdAt: nowIso(),
    });
    if (this.auditLog.length > 2000) this.auditLog.pop();
  }

  activeMonitors(): MonitorRecord[] {
    return [...this.monitors.values()].filter((m) => !m.isDeleted);
  }

  pushResult(result: MonitorResultRecord): void {
    const ring = this.results.get(result.monitorId) ?? [];
    ring.push(result);
    if (ring.length > RESULT_RING_CAP) ring.shift();
    this.results.set(result.monitorId, ring);
  }

  resultsFor(monitorId: string): MonitorResultRecord[] {
    return this.results.get(monitorId) ?? [];
  }

  openIncidentsFor(monitorId: string): IncidentRecord[] {
    return [...this.incidents.values()].filter(
      (i) => i.monitorId === monitorId && i.status !== "resolved" && i.status !== "muted",
    );
  }

  project(projectId: string): ProjectRecord | undefined {
    return this.projects.find((p) => p.id === projectId && !p.isDeleted);
  }

  environmentName(projectId: string, environmentId: string): string {
    return (
      this.project(projectId)?.environments.find((e) => e.id === environmentId)?.name ?? environmentId
    );
  }

  /** Active maintenance windows covering a monitor right now. */
  inMaintenance(monitor: MonitorRecord, at: number = Date.now()): boolean {
    return this.maintenanceWindows.some((w) => {
      if (w.isDeleted) return false;
      if (at < new Date(w.startsAt).getTime() || at > new Date(w.endsAt).getTime()) return false;
      switch (w.scope) {
        case "organisation":
          return true;
        case "project":
          return w.projectId === monitor.projectId;
        case "environment":
          return w.environmentId === monitor.environmentId;
        case "monitor":
          return w.monitorId === monitor.id;
        default:
          return false;
      }
    });
  }

  // --- seed ------------------------------------------------------------

  private seed(): void {
    const platform: ProjectRecord = {
      id: "proj-platform",
      name: "Monitoring Platform",
      slug: "monitoring-platform",
      environments: [{ id: "env-platform-prod", name: "production" }],
      isDeleted: false,
    };
    const taskBooker: ProjectRecord = {
      id: "proj-taskbooker",
      name: "AWM Task Booker",
      slug: "awm-task-booker",
      environments: [
        { id: "env-tb-prod", name: "production" },
        { id: "env-tb-staging", name: "staging" },
      ],
      isDeleted: false,
    };
    this.projects.push(platform, taskBooker);

    const base = env.SELF_BASE_URL ?? `http://localhost:${env.PORT}`;
    const baseUrl = new URL(base);
    const basePort = baseUrl.port !== "" ? Number(baseUrl.port) : baseUrl.protocol === "https:" ? 443 : 80;
    const seedMonitor = (m: Omit<MonitorRecord, "createdAt" | "isDeleted" | "nextDueAt" | "consecutiveFails" | "lastHeartbeatAt" | "lastMissedEmitAt">): void => {
      this.monitors.set(m.id, {
        ...m,
        createdAt: nowIso(),
        isDeleted: false,
        nextDueAt: Date.now(),
        consecutiveFails: 0,
        lastHeartbeatAt: null,
        lastMissedEmitAt: null,
      });
    };

    seedMonitor({
      id: "mon-api-health",
      name: "Platform API health",
      description: "Self-monitoring: liveness endpoint of this API",
      projectId: platform.id,
      environmentId: "env-platform-prod",
      monitorType: "http",
      checkIntervalMinutes: 1,
      timeoutMs: 10_000,
      retryCount: 1,
      severity: "critical",
      tags: ["self-monitoring"],
      enabled: true,
      configuration: {
        url: `${base}/api/health`,
        method: "get",
        validation: { expectedStatusCodes: [200], keyword: "ok", maxDurationMs: 2000 },
      },
      heartbeatToken: null,
    });
    seedMonitor({
      id: "mon-api-port",
      name: "Platform API port",
      description: "TCP reachability of the API listener",
      projectId: platform.id,
      environmentId: "env-platform-prod",
      monitorType: "tcp_port",
      checkIntervalMinutes: 1,
      timeoutMs: 5_000,
      retryCount: 1,
      severity: "critical",
      tags: ["self-monitoring"],
      enabled: true,
      configuration: { host: baseUrl.hostname, port: basePort },
      heartbeatToken: null,
    });
    seedMonitor({
      id: "mon-example-http",
      name: "Example.com availability",
      description: "External HTTP reference check",
      projectId: taskBooker.id,
      environmentId: "env-tb-prod",
      monitorType: "http",
      checkIntervalMinutes: 5,
      timeoutMs: 15_000,
      retryCount: 1,
      severity: "high",
      tags: ["external"],
      enabled: true,
      configuration: {
        url: "https://example.com/",
        method: "get",
        validation: { expectedStatusCodes: [200], keyword: "Example Domain" },
      },
      heartbeatToken: null,
    });
    seedMonitor({
      id: "mon-example-ssl",
      name: "example.com certificate",
      description: "SSL validity and expiry",
      projectId: taskBooker.id,
      environmentId: "env-tb-prod",
      monitorType: "ssl",
      checkIntervalMinutes: 60,
      timeoutMs: 10_000,
      retryCount: 0,
      severity: "high",
      tags: ["external", "tls"],
      enabled: true,
      configuration: { host: "example.com", port: 443, warnDays: [30, 14, 7, 1] },
      heartbeatToken: null,
    });
    seedMonitor({
      id: "mon-gmail-smtp",
      name: "Gmail SMTP reachability",
      description: "Email provider connectivity (implicit TLS)",
      projectId: taskBooker.id,
      environmentId: "env-tb-prod",
      monitorType: "email_provider",
      checkIntervalMinutes: 15,
      timeoutMs: 10_000,
      retryCount: 1,
      severity: "medium",
      tags: ["email"],
      enabled: true,
      configuration: { host: "smtp.gmail.com", port: 465, secure: true },
      heartbeatToken: null,
    });
    seedMonitor({
      id: "mon-integration-example",
      name: "Insightly API (reference)",
      description: "Integration check with failure classification — placeholder endpoint until credentials arrive",
      projectId: taskBooker.id,
      environmentId: "env-tb-prod",
      monitorType: "api_integration",
      checkIntervalMinutes: 10,
      timeoutMs: 15_000,
      retryCount: 1,
      severity: "high",
      tags: ["integration", "insightly"],
      enabled: true,
      configuration: {
        service: "Insightly",
        url: "https://example.com/",
        method: "get",
        validation: { expectedStatusCodes: [200] },
      },
      heartbeatToken: null,
    });
    // The 1-minute demo heartbeat exists to show missed-job detection; on
    // real deployments (SEED_DEMO_DATA=false) it would just be a noise machine.
    if (seedDemoData) {
      seedMonitor({
        id: "mon-heartbeat-demo",
        name: "Demo cron heartbeat",
        description: "Missed-job detection demo — ping /api/heartbeats/{token} to recover it",
        projectId: platform.id,
        environmentId: "env-platform-prod",
        monitorType: "heartbeat",
        checkIntervalMinutes: 1,
        timeoutMs: 5_000,
        retryCount: 0,
        severity: "medium",
        tags: ["demo", "cron"],
        enabled: true,
        configuration: { expectedIntervalMinutes: 1, graceMinutes: 0 },
        heartbeatToken: `hb_${randomBytes(16).toString("base64url")}`,
      });
    }
    seedMonitor({
      id: "mon-heartbeat-sync",
      name: "Nightly Insightly sync",
      description: "Job execution tracking for the nightly sync",
      projectId: taskBooker.id,
      environmentId: "env-tb-prod",
      monitorType: "heartbeat",
      checkIntervalMinutes: 30,
      timeoutMs: 5_000,
      retryCount: 0,
      severity: "high",
      tags: ["cron", "insightly"],
      enabled: true,
      configuration: { expectedIntervalMinutes: 30, graceMinutes: 5 },
      heartbeatToken: `hb_${randomBytes(16).toString("base64url")}`,
    });

    this.channels.push(
      {
        id: "chan-ops-webhook",
        name: "Ops webhook (local sink)",
        channelType: "webhook",
        config: { url: `${base}/api/dev/webhook-sink` },
        enabled: true,
        isDeleted: false,
      },
      {
        id: "chan-ops-email",
        name: "Ops email",
        channelType: "email",
        config: { to: "operations.support@ascotwm.com" },
        enabled: true,
        isDeleted: false,
      },
    );
    this.alertRules.push(
      {
        id: "rule-critical-webhook",
        name: "Critical & high → Ops webhook",
        channelId: "chan-ops-webhook",
        conditions: { severities: ["critical", "high"] },
        escalationDelaySeconds: 600,
        priority: 10,
        enabled: true,
        isDeleted: false,
      },
      {
        id: "rule-all-email",
        name: "Everything → Ops email",
        channelId: "chan-ops-email",
        conditions: {},
        escalationDelaySeconds: null,
        priority: 0,
        enabled: true,
        isDeleted: false,
      },
    );
  }
}
