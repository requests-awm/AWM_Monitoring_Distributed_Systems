import { createHash } from "node:crypto";

import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { HeartbeatPingBody, MonitorResultReport } from "@awm/shared";

import { MonitoringStore, type IncidentRecord, type MonitorRecord } from "./monitoring.store";
import { NotificationDispatcher } from "./notification.dispatcher";

const HEARTBEAT_SWEEP_MS = 30_000;

/**
 * The incident pipeline (spec Tasks 10.1/10.2, 11.x): result → retry counting →
 * dedup → incident create/increment → alert-rule dispatch → auto-recovery.
 * Maintenance windows suppress incident creation but never result recording.
 */
@Injectable()
export class IncidentEngine implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IncidentEngine.name);
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private readonly escalationTimers = new Set<NodeJS.Timeout>();

  constructor(
    private readonly store: MonitoringStore,
    private readonly dispatcher: NotificationDispatcher,
  ) {}

  onModuleInit(): void {
    this.heartbeatTimer = setInterval(() => this.sweepMissedHeartbeats(), HEARTBEAT_SWEEP_MS);
  }

  onModuleDestroy(): void {
    if (this.heartbeatTimer !== null) clearInterval(this.heartbeatTimer);
    for (const t of this.escalationTimers) clearTimeout(t);
  }

  /** Entry point for every check result (worker reports, heartbeat pings, missed-job synthetics). */
  processResult(monitor: MonitorRecord, report: Omit<MonitorResultReport, "monitorId">): void {
    this.store.pushResult({
      id: this.store.newId("res"),
      monitorId: monitor.id,
      status: report.status,
      success: report.success,
      responseTimeMs: report.responseTimeMs ?? null,
      statusCode: report.statusCode ?? null,
      failureReason: report.failureReason ?? null,
      metadata: (report.metadata ?? null) as Record<string, unknown> | null,
      checkedAt: report.checkedAt,
    });

    if (report.status === "success") {
      monitor.consecutiveFails = 0;
      this.autoResolve(monitor);
      return;
    }

    monitor.consecutiveFails += 1;
    if (monitor.consecutiveFails <= monitor.retryCount) {
      return; // still inside the retry budget — no incident yet
    }
    if (this.store.inMaintenance(monitor)) {
      return; // results collected, incidents suppressed (spec Task 12.1)
    }
    this.raise(monitor, report);
  }

  recordHeartbeatPing(monitor: MonitorRecord, ping: HeartbeatPingBody): void {
    monitor.lastHeartbeatAt = Date.now();
    monitor.lastMissedEmitAt = null;
    const failed = ping.event_type === "failure";
    this.processResult(monitor, {
      status: failed ? "failure" : "success",
      success: !failed,
      responseTimeMs: ping.duration_ms ?? null,
      statusCode: null,
      failureReason: failed ? (ping.error_message ?? "Job reported failure") : null,
      metadata: {
        eventType: ping.event_type,
        jobName: ping.job_name,
        recordsProcessed: ping.records_processed,
        recordsFailed: ping.records_failed,
      },
      checkedAt: new Date().toISOString(),
    });
  }

  // --- incident lifecycle ------------------------------------------------

  private raise(monitor: MonitorRecord, report: Omit<MonitorResultReport, "monitorId">): void {
    const errorType = classify(report.statusCode ?? null, report.failureReason ?? null, report.status);
    const reason = report.failureReason ?? errorType;
    const signature = createHash("sha256")
      .update(`${monitor.id}|${errorType}|${normalize(reason)}`)
      .digest("hex")
      .slice(0, 24);

    const existing = [...this.store.incidents.values()].find(
      (i) => i.dedupSignature === signature && i.status !== "resolved",
    );
    if (existing !== undefined) {
      existing.occurrenceCount += 1;
      existing.lastOccurrenceAt = new Date().toISOString();
      return;
    }

    const incident: IncidentRecord = {
      id: this.store.newId("inc"),
      monitorId: monitor.id,
      status: "open",
      severity: monitor.severity,
      title: `${monitor.name}: ${ERROR_TYPE_LABEL[errorType] ?? errorType}`,
      summary: null,
      failureReason: reason,
      dedupSignature: signature,
      occurrenceCount: 1,
      startedAt: new Date().toISOString(),
      lastOccurrenceAt: new Date().toISOString(),
      acknowledgedAt: null,
      resolvedAt: null,
      assignee: null,
      events: [
        {
          id: this.store.newId("iev"),
          eventType: "created",
          message: reason,
          actor: null,
          createdAt: new Date().toISOString(),
        },
      ],
    };
    this.store.incidents.set(incident.id, incident);
    this.logger.warn(`incident created`, { monitor: monitor.name, title: incident.title });
    void this.dispatchAlerts(monitor, incident, "created");
    this.scheduleEscalations(monitor, incident);
  }

  private autoResolve(monitor: MonitorRecord): void {
    for (const incident of this.store.openIncidentsFor(monitor.id)) {
      incident.status = "resolved";
      incident.resolvedAt = new Date().toISOString();
      incident.events.push({
        id: this.store.newId("iev"),
        eventType: "resolved",
        message: "Auto-resolved: monitor recovered",
        actor: null,
        createdAt: new Date().toISOString(),
      });
      void this.dispatchAlerts(monitor, incident, "resolved");
    }
  }

  private scheduleEscalations(monitor: MonitorRecord, incident: IncidentRecord): void {
    for (const rule of this.matchingRules(monitor)) {
      if (rule.escalationDelaySeconds === null || rule.escalationDelaySeconds <= 0) continue;
      const timer = setTimeout(() => {
        this.escalationTimers.delete(timer);
        const current = this.store.incidents.get(incident.id);
        // Escalation stops on acknowledge or resolve (spec Task 11.2).
        if (current === undefined || current.status !== "open" || current.acknowledgedAt !== null) return;
        current.events.push({
          id: this.store.newId("iev"),
          eventType: "escalated",
          message: `Unacknowledged after ${String(rule.escalationDelaySeconds)}s`,
          actor: null,
          createdAt: new Date().toISOString(),
        });
        void this.dispatchAlerts(monitor, current, "escalated");
      }, rule.escalationDelaySeconds * 1000);
      this.escalationTimers.add(timer);
    }
  }

  private matchingRules(monitor: MonitorRecord) {
    return this.store.alertRules.filter((rule) => {
      if (rule.isDeleted || !rule.enabled) return false;
      const c = rule.conditions;
      if (c.severities !== undefined && c.severities.length > 0 && !c.severities.includes(monitor.severity)) return false;
      if (c.projectIds !== undefined && c.projectIds.length > 0 && !c.projectIds.includes(monitor.projectId)) return false;
      if (c.environmentIds !== undefined && c.environmentIds.length > 0 && !c.environmentIds.includes(monitor.environmentId)) return false;
      if (c.monitorTypes !== undefined && c.monitorTypes.length > 0 && !c.monitorTypes.includes(monitor.monitorType)) return false;
      return true;
    });
  }

  private async dispatchAlerts(
    monitor: MonitorRecord,
    incident: IncidentRecord,
    kind: "created" | "escalated" | "resolved",
  ): Promise<void> {
    const channelIds = new Set(this.matchingRules(monitor).map((r) => r.channelId));
    const project = this.store.project(monitor.projectId);
    const subjectPrefix = kind === "resolved" ? "RESOLVED" : kind === "escalated" ? "ESCALATION" : "ALERT";
    const subject = `[${subjectPrefix}] ${incident.title}`;
    const body = [
      `Project: ${project?.name ?? monitor.projectId} / ${this.store.environmentName(monitor.projectId, monitor.environmentId)}`,
      `Severity: ${incident.severity}`,
      `Reason: ${incident.failureReason ?? "—"}`,
      `Occurrences: ${String(incident.occurrenceCount)}`,
    ].join("\n");

    for (const channelId of channelIds) {
      const channel = this.store.channels.find((ch) => ch.id === channelId && !ch.isDeleted && ch.enabled);
      if (channel === undefined) continue;
      const outcome = await this.dispatcher.send(channel, subject, body, {
        incidentId: incident.id,
        monitorId: monitor.id,
        kind,
      });
      incident.events.push({
        id: this.store.newId("iev"),
        eventType: "notified",
        message: `${channel.name} (${channel.channelType}): ${outcome.ok ? "sent" : "FAILED"} — ${outcome.detail}`,
        actor: null,
        createdAt: new Date().toISOString(),
      });
    }
  }

  // --- missed-heartbeat detection ----------------------------------------

  private sweepMissedHeartbeats(): void {
    const now = Date.now();
    for (const monitor of this.store.activeMonitors()) {
      if (monitor.monitorType !== "heartbeat" || !monitor.enabled) continue;
      const cfg = monitor.configuration as { expectedIntervalMinutes?: number; graceMinutes?: number };
      const expectedMs = (cfg.expectedIntervalMinutes ?? 60) * 60_000;
      const graceMs = (cfg.graceMinutes ?? 0) * 60_000;
      const baseline = monitor.lastHeartbeatAt ?? new Date(monitor.createdAt).getTime();
      if (now - baseline <= expectedMs + graceMs) continue;
      // Emit at most one synthetic failure per expected interval while overdue.
      if (monitor.lastMissedEmitAt !== null && now - monitor.lastMissedEmitAt < expectedMs) continue;
      monitor.lastMissedEmitAt = now;
      const overdueMin = Math.round((now - baseline) / 60_000);
      this.processResult(monitor, {
        status: "failure",
        success: false,
        responseTimeMs: null,
        statusCode: null,
        failureReason: `Missed heartbeat — last seen ${String(overdueMin)}m ago (expected every ${String(cfg.expectedIntervalMinutes ?? 60)}m)`,
        metadata: { missed: true },
        checkedAt: new Date().toISOString(),
      });
    }
  }
}

const ERROR_TYPE_LABEL: Record<string, string> = {
  timeout: "Timeout",
  dns: "DNS failure",
  tls: "TLS/certificate problem",
  connection: "Connection refused",
  http_5xx: "Server error",
  http_4xx: "Client/auth error",
  rate_limit: "Rate limited",
  validation: "Response validation failed",
  performance: "Performance threshold exceeded",
  missed_heartbeat: "Missed job",
  job_failure: "Job failed",
  cert_expiry: "Certificate expiring",
  other: "Check failed",
};

function classify(statusCode: number | null, reason: string | null, status: string): string {
  const r = (reason ?? "").toLowerCase();
  if (r.includes("missed heartbeat")) return "missed_heartbeat";
  if (r.includes("job reported failure") || r.includes("job failed")) return "job_failure";
  if (r.includes("expires") || r.includes("expiring") || r.includes("expired")) return "cert_expiry";
  if (r.includes("timeout") || r.includes("timed out")) return "timeout";
  if (r.includes("enotfound") || r.includes("dns")) return "dns";
  if (r.includes("tls") || r.includes("certificate") || r.includes("ssl")) return "tls";
  if (r.includes("econnrefused") || r.includes("refused")) return "connection";
  if (statusCode !== null && statusCode === 429) return "rate_limit";
  if (statusCode !== null && statusCode >= 500) return "http_5xx";
  if (statusCode !== null && statusCode >= 400) return "http_4xx";
  if (status === "degraded" || r.includes("exceeded")) return "performance";
  if (r.includes("keyword") || r.includes("validation") || r.includes("expected")) return "validation";
  return "other";
}

function normalize(reason: string): string {
  return reason.toLowerCase().replace(/\d+/g, "#").slice(0, 80);
}
