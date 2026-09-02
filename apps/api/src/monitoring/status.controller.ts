import { Controller, Get } from "@nestjs/common";
import type { PublicStatusMonitor, PublicStatusResponse } from "@awm/shared";

import { MonitoringService } from "./monitoring.service";
import { MonitoringStore } from "./monitoring.store";

/**
 * Unauthenticated status summary (excluded from the access gate): monitor
 * names, up/down state, and 24h uptime — never configuration, URLs, or hosts.
 */
@Controller("status")
export class StatusController {
  constructor(
    private readonly monitoring: MonitoringService,
    private readonly store: MonitoringStore,
  ) {}

  @Get()
  status(): PublicStatusResponse {
    const items = this.monitoring.listMonitors().filter((m) => m.enabled);
    const projects = new Map<string, PublicStatusMonitor[]>();
    let overall: PublicStatusResponse["overall"] = "operational";

    for (const m of items) {
      const status: PublicStatusMonitor["status"] = m.inMaintenance
        ? "maintenance"
        : m.lastStatus === null
          ? "pending"
          : m.lastStatus === "failure"
            ? "down"
            : m.lastStatus === "degraded"
              ? "degraded"
              : "operational";
      if (status === "down") {
        overall = m.severity === "critical" ? "critical" : overall === "critical" ? "critical" : "attention";
      } else if (status === "degraded" && overall === "operational") {
        overall = "attention";
      }
      const list = projects.get(m.projectName) ?? [];
      list.push({ name: m.name, status, uptime24hPct: m.uptime24hPct });
      projects.set(m.projectName, list);
    }
    // Open incidents count toward the roll-up even when the latest check recovered.
    if (overall === "operational") {
      const open = [...this.store.incidents.values()].filter(
        (i) => i.status !== "resolved" && i.status !== "muted",
      );
      if (open.some((i) => i.severity === "critical")) overall = "critical";
      else if (open.length > 0) overall = "attention";
    }

    return {
      generatedAt: new Date().toISOString(),
      overall,
      projects: [...projects.entries()].map(([name, monitors]) => ({ name, monitors })),
    };
  }
}
