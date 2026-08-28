import { Injectable } from "@nestjs/common";
import type {
  CheckResultStatus,
  DisplayStatus,
  IncidentRow,
  MonitorRow,
  OverviewResponse,
  SystemState,
} from "@awm/shared";

import { MonitoringStore } from "../monitoring/monitoring.store";

const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class OverviewService {
  constructor(private readonly store: MonitoringStore) {}

  getOverview(): OverviewResponse {
    const monitors = this.store.activeMonitors();
    const now = Date.now();

    const rows: MonitorRow[] = monitors.map((m) => {
      const ring = this.store.resultsFor(m.id);
      const last = ring.length > 0 ? ring[ring.length - 1] : undefined;
      const inDay = ring.filter((r) => new Date(r.checkedAt).getTime() >= now - DAY_MS);
      const status: DisplayStatus = this.store.inMaintenance(m)
        ? "maintenance"
        : displayStatus(last?.status ?? null);
      return {
        id: m.id,
        name: m.name,
        project: this.store.project(m.projectId)?.name ?? m.projectId,
        environment: this.store.environmentName(m.projectId, m.environmentId),
        type: m.monitorType,
        status,
        uptimePct:
          inDay.length === 0
            ? 100
            : Math.round((inDay.filter((r) => r.success).length / inDay.length) * 10000) / 100,
        responseMs: last?.responseTimeMs ?? null,
        lastCheck: last === undefined ? "never" : timeAgo(last.checkedAt),
        history: ring.slice(-24).map((r) => displayStatus(r.status)),
      };
    });

    const openIncidents = [...this.store.incidents.values()]
      .filter((i) => i.status !== "resolved" && i.status !== "muted")
      .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
    const attention: IncidentRow[] = openIncidents.slice(0, 10).map((i) => ({
      id: i.id,
      title: i.title,
      monitor: this.store.monitors.get(i.monitorId)?.name ?? i.monitorId,
      severity: i.severity,
      status: i.status,
      startedAgo: timeAgo(i.startedAt),
      failureReason: i.failureReason ?? "",
    }));

    const failed = rows.filter((r) => r.status === "failed").length;
    const warning = rows.filter((r) => r.status === "warning").length;
    const healthy = rows.filter((r) => r.status === "healthy").length;
    const responseTimes = rows.map((r) => r.responseMs).filter((v): v is number => v !== null);
    const uptimeValues = rows.map((r) => r.uptimePct);

    const hasCriticalOpen = openIncidents.some((i) => i.severity === "critical");
    const systemState: SystemState =
      failed > 0 && hasCriticalOpen
        ? "critical"
        : failed > 0 || warning > 0 || openIncidents.length > 0
          ? "attention"
          : "operational";

    const missedHeartbeats = monitors
      .filter((m) => m.monitorType === "heartbeat" && m.enabled)
      .filter((m) => {
        const cfg = m.configuration as { expectedIntervalMinutes?: number; graceMinutes?: number };
        const baseline = m.lastHeartbeatAt ?? new Date(m.createdAt).getTime();
        return now - baseline > ((cfg.expectedIntervalMinutes ?? 60) + (cfg.graceMinutes ?? 0)) * 60_000;
      })
      .map((m) => ({
        name: m.name,
        lastSeenAgo:
          m.lastHeartbeatAt === null ? "never" : timeAgo(new Date(m.lastHeartbeatAt).toISOString()),
      }));

    const certExpiries = monitors
      .filter((m) => m.monitorType === "ssl")
      .flatMap((m) => {
        const ring = this.store.resultsFor(m.id);
        const last = ring.length > 0 ? ring[ring.length - 1] : undefined;
        const days = (last?.metadata as { daysRemaining?: number } | null)?.daysRemaining;
        return days === undefined ? [] : [{ name: m.name, daysLeft: days }];
      });

    return {
      systemState,
      stats: {
        total: rows.length,
        healthy,
        warning,
        failed,
        activeIncidents: openIncidents.length,
        avgResponseMs:
          responseTimes.length === 0
            ? 0
            : Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length),
        uptimePct:
          uptimeValues.length === 0
            ? 100
            : Math.round((uptimeValues.reduce((a, b) => a + b, 0) / uptimeValues.length) * 100) / 100,
      },
      attention,
      monitors: rows,
      missedHeartbeats,
      certExpiries,
    };
  }
}

function displayStatus(status: CheckResultStatus | null): DisplayStatus {
  switch (status) {
    case "failure":
      return "failed";
    case "degraded":
      return "warning";
    default:
      return "healthy";
  }
}

function timeAgo(iso: string): string {
  const delta = Date.now() - new Date(iso).getTime();
  if (delta < 60_000) return "just now";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}
