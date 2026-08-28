import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { MonitorJob, MonitorResultReport } from "@awm/shared";

import { env } from "../config/env";
import { executeJob } from "./executors";

/**
 * Pulls due checks from the API and reports results back. Interval-based for
 * the MVP; becomes a BullMQ repeatable-job consumer in M2 once Redis is
 * provisioned (claiming already happens API-side, so replicas won't double-run).
 */
@Injectable()
export class CheckPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CheckPollerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  onModuleInit(): void {
    this.logger.log(`check poller started — polling ${env.API_BASE_URL} every ${env.POLL_INTERVAL_MS}ms`);
    this.timer = setInterval(() => void this.tick(), env.POLL_INTERVAL_MS);
    void this.tick();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // don't stack ticks when checks run long
    this.running = true;
    try {
      const jobs = await this.fetchDue();
      if (jobs.length > 0) {
        this.logger.log(`executing ${jobs.length} due check(s)`);
        await Promise.allSettled(jobs.map((job) => this.runAndReport(job)));
      }
    } catch (error) {
      this.logger.warn(`poll failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async fetchDue(): Promise<MonitorJob[]> {
    const res = await fetch(`${env.API_BASE_URL}/api/internal/monitors/due`, {
      headers: { authorization: `Bearer ${env.WORKER_TOKEN}` },
    });
    if (!res.ok) throw new Error(`due endpoint returned ${res.status}`);
    return (await res.json()) as MonitorJob[];
  }

  private async runAndReport(job: MonitorJob): Promise<void> {
    const outcome = await executeJob(job);
    const report: MonitorResultReport = { monitorId: job.id, ...outcome };
    const res = await fetch(`${env.API_BASE_URL}/api/internal/monitor-results`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.WORKER_TOKEN}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(report),
    });
    if (!res.ok) {
      this.logger.warn(`result report rejected`, { monitorId: job.id, status: res.status });
    }
  }
}
