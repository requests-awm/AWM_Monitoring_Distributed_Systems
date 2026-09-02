import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { env } from "../config/env";
import { N8nInsightsService } from "../workflow-events/n8n-insights.service";
import { IncidentEngine } from "./incident.engine";
import { MonitoringStore } from "./monitoring.store";

const MONITOR_ID = "mon-n8n-failure-rate";
/** Let the API finish booting (and the first dashboard insights call warm the cache) first. */
const BOOT_DELAY_MS = 3 * 60_000;
const RUN_INTERVAL_MS = 15 * 60_000;

interface AnomalyConfig {
  baselineDays?: number;
  multiplier?: number;
  floorPct?: number;
  minExecutionsToday?: number;
}

/**
 * Failure-rate anomaly detection for n8n (spec §synthetic monitoring, done
 * API-side because the signal lives in the insights crawl, not in a probe):
 * compares today's failure rate against the trailing-week baseline and feeds
 * the result through the normal incident pipeline — dedup, alert rules,
 * escalation, auto-resolve all apply unchanged.
 */
@Injectable()
export class AnomalyDetector implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnomalyDetector.name);
  private bootTimer: NodeJS.Timeout | null = null;
  private runTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly store: MonitoringStore,
    private readonly insights: N8nInsightsService,
    private readonly engine: IncidentEngine,
  ) {}

  onModuleInit(): void {
    if (env.N8N_API_KEY === undefined || env.N8N_BASE_URL === undefined) return;
    this.bootTimer = setTimeout(() => {
      void this.run();
      this.runTimer = setInterval(() => void this.run(), RUN_INTERVAL_MS);
    }, BOOT_DELAY_MS);
  }

  onModuleDestroy(): void {
    if (this.bootTimer !== null) clearTimeout(this.bootTimer);
    if (this.runTimer !== null) clearInterval(this.runTimer);
  }

  private async run(): Promise<void> {
    const monitor = this.store.monitors.get(MONITOR_ID);
    if (monitor === undefined || monitor.isDeleted || !monitor.enabled) return;
    const cfg = monitor.configuration as AnomalyConfig;
    const baselineDays = cfg.baselineDays ?? 7;
    const multiplier = cfg.multiplier ?? 2;
    const floorPct = cfg.floorPct ?? 2;
    const minToday = cfg.minExecutionsToday ?? 20;

    try {
      const data = await this.insights.insights(baselineDays);
      const today = data.byDay[data.byDay.length - 1];
      const baseline = data.byDay.slice(0, -1).filter((d) => d.total > 0);
      if (today === undefined || baseline.length === 0) return;

      const baselineTotal = baseline.reduce((a, d) => a + d.total, 0);
      const baselineFailed = baseline.reduce((a, d) => a + d.failed, 0);
      const baselinePct = baselineTotal === 0 ? 0 : (baselineFailed / baselineTotal) * 100;
      const todayPct = today.total === 0 ? 0 : (today.failed / today.total) * 100;

      const anomalous =
        today.total >= minToday && todayPct >= floorPct && todayPct > baselinePct * multiplier;

      this.engine.processResult(monitor, {
        status: anomalous ? "failure" : "success",
        success: !anomalous,
        responseTimeMs: null,
        statusCode: null,
        failureReason: anomalous
          ? `n8n failure rate ${todayPct.toFixed(1)}% today (${String(today.failed)}/${String(today.total)}) vs ${baselinePct.toFixed(1)}% ${String(baselineDays)}-day baseline — over ${String(multiplier)}× threshold`
          : null,
        metadata: {
          todayFailureRatePct: Math.round(todayPct * 10) / 10,
          baselineFailureRatePct: Math.round(baselinePct * 10) / 10,
          todayExecutions: today.total,
          todayFailed: today.failed,
        },
        checkedAt: new Date().toISOString(),
      });
      if (anomalous) {
        this.logger.warn(`n8n failure-rate anomaly`, { todayPct, baselinePct });
      }
    } catch (error) {
      // An unreachable n8n is the integration monitor's problem, not an anomaly.
      this.logger.warn(
        `anomaly check skipped — insights unavailable`,
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
  }
}
