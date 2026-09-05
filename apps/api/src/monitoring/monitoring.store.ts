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
 * In-memory working set for the monitoring core. In sample mode it is the
 * only store; in live mode MonitoringPersistence hydrates it from the DB at
 * boot and write-through keeps the DB in sync (monitoring.persistence.ts).
 *
 * Seeded monitors point at the platform itself and public endpoints, so real
 * check results flow with zero external dependencies. On a first live boot
 * against an empty schema the seeds are materialized into the DB.
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

  /**
   * Plain UUIDs: ids go into UUID columns in live mode, so no prefixes. The
   * prefix parameter is kept for call-site readability only.
   */
  newId(prefix: string): string {
    void prefix;
    return randomUUID();
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
    // Seed ids are generated UUIDs (not literals): in live mode a first boot
    // materializes these rows into UUID columns; lookups are by name/tag.
    const envPlatformProd = this.newId("env");
    const envTbProd = this.newId("env");
    const platform: ProjectRecord = {
      id: this.newId("proj"),
      name: "Monitoring Platform",
      slug: "monitoring-platform",
      environments: [{ id: envPlatformProd, name: "production" }],
      isDeleted: false,
    };
    const taskBooker: ProjectRecord = {
      id: this.newId("proj"),
      name: "AWM Task Booker",
      slug: "awm-task-booker",
      environments: [
        { id: envTbProd, name: "production" },
        { id: this.newId("env"), name: "staging" },
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
      id: this.newId("mon"),
      name: "Platform API health",
      description: "Self-monitoring: liveness endpoint of this API",
      projectId: platform.id,
      environmentId: envPlatformProd,
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
      id: this.newId("mon"),
      name: "Platform API port",
      description: "TCP reachability of the API listener",
      projectId: platform.id,
      environmentId: envPlatformProd,
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
      id: this.newId("mon"),
      name: "Example.com availability",
      description: "External HTTP reference check",
      projectId: taskBooker.id,
      environmentId: envTbProd,
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
      id: this.newId("mon"),
      name: "example.com certificate",
      description: "SSL validity and expiry",
      projectId: taskBooker.id,
      environmentId: envTbProd,
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
      id: this.newId("mon"),
      name: "Gmail SMTP reachability",
      description: "Email provider connectivity (implicit TLS)",
      projectId: taskBooker.id,
      environmentId: envTbProd,
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
      id: this.newId("mon"),
      name: "Insightly API (reference)",
      description: "Integration check with failure classification — placeholder endpoint until credentials arrive",
      projectId: taskBooker.id,
      environmentId: envTbProd,
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
    // Fed by the API-side anomaly detector (n8n insights comparison), never
    // by the worker — synthetic_workflow is skipped in the due endpoint.
    if (env.N8N_API_KEY !== undefined) {
      seedMonitor({
        id: this.newId("mon"),
        name: "n8n failure-rate anomaly",
        description:
          "Alerts when today's n8n failure rate runs more than 2× the 7-day baseline (with a 2% floor)",
        projectId: platform.id,
        environmentId: envPlatformProd,
        monitorType: "synthetic_workflow",
        checkIntervalMinutes: 15,
        timeoutMs: 30_000,
        retryCount: 0,
        severity: "high",
        tags: ["n8n", "anomaly"],
        enabled: true,
        configuration: { baselineDays: 7, multiplier: 2, floorPct: 2, minExecutionsToday: 20 },
        heartbeatToken: null,
      });
    }
    // The 1-minute demo heartbeat exists to show missed-job detection; on
    // real deployments (SEED_DEMO_DATA=false) it would just be a noise machine.
    if (seedDemoData) {
      seedMonitor({
        id: this.newId("mon"),
        name: "Demo cron heartbeat",
        description: "Missed-job detection demo — ping /api/heartbeats/{token} to recover it",
        projectId: platform.id,
        environmentId: envPlatformProd,
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
      id: this.newId("mon"),
      name: "Nightly Insightly sync",
      description: "Job execution tracking for the nightly sync",
      projectId: taskBooker.id,
      environmentId: envTbProd,
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

    const chanOpsWebhook = this.newId("chan");
    const chanOpsEmail = this.newId("chan");
    this.channels.push(
      {
        id: chanOpsWebhook,
        name: "Ops webhook (local sink)",
        channelType: "webhook",
        config: { url: `${base}/api/dev/webhook-sink` },
        enabled: true,
        isDeleted: false,
      },
      {
        id: chanOpsEmail,
        name: "Ops email",
        channelType: "email",
        config: { to: "operations.support@ascotwm.com" },
        enabled: true,
        isDeleted: false,
      },
    );
    this.alertRules.push(
      {
        id: this.newId("rule"),
        name: "Critical & high → Ops webhook",
        channelId: chanOpsWebhook,
        conditions: { severities: ["critical", "high"] },
        escalationDelaySeconds: 600,
        priority: 10,
        enabled: true,
        isDeleted: false,
      },
      {
        id: this.newId("rule"),
        name: "Everything → Ops email",
        channelId: chanOpsEmail,
        conditions: {},
        escalationDelaySeconds: null,
        priority: 0,
        enabled: true,
        isDeleted: false,
      },
    );
  }
}
