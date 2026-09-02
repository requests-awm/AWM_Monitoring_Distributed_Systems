import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { env } from "../config/env";

const BOOT_DELAY_MS = 4 * 60_000;
/** Billing data moves slowly; the push replaces per-day rows so re-pulls are safe. */
const PULL_INTERVAL_MS = 6 * 60 * 60_000;
const LOOKBACK_DAYS = 7;
const FETCH_TIMEOUT_MS = 30_000;

interface DailyCost {
  provider: string;
  date: string;
  cost_usd: number;
  calls: number;
}

/**
 * Cost tracking seam: pulls daily spend from provider billing APIs and pushes
 * it to the usage store (replace semantics, so restarts never double-count).
 * Each provider activates only when its credentials exist — with none set the
 * service stays idle and logs why.
 */
@Injectable()
export class ProviderCostsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProviderCostsService.name);
  private bootTimer: NodeJS.Timeout | null = null;
  private runTimer: NodeJS.Timeout | null = null;

  onModuleInit(): void {
    const hasOpenAi = env.OPENAI_ADMIN_KEY !== undefined;
    const hasTwilio = env.TWILIO_ACCOUNT_SID !== undefined && env.TWILIO_AUTH_TOKEN !== undefined;
    if (!hasOpenAi && !hasTwilio) {
      this.logger.log(
        "provider-cost pulls idle — set OPENAI_ADMIN_KEY and/or TWILIO_ACCOUNT_SID+TWILIO_AUTH_TOKEN",
      );
      return;
    }
    this.bootTimer = setTimeout(() => void this.run(), BOOT_DELAY_MS);
    this.runTimer = setInterval(() => void this.run(), PULL_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.bootTimer !== null) clearTimeout(this.bootTimer);
    if (this.runTimer !== null) clearInterval(this.runTimer);
  }

  private async run(): Promise<void> {
    const costs: DailyCost[] = [];
    if (env.OPENAI_ADMIN_KEY !== undefined) {
      costs.push(...(await this.pullOpenAi()));
    }
    if (env.TWILIO_ACCOUNT_SID !== undefined && env.TWILIO_AUTH_TOKEN !== undefined) {
      costs.push(...(await this.pullTwilio()));
    }
    if (costs.length === 0) return;
    try {
      const res = await fetch(`${env.API_BASE_URL}/api/internal/provider-costs`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ app: "provider-billing", costs }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!res.ok) {
        this.logger.warn(`cost push rejected: ${res.status}`);
        return;
      }
      this.logger.log(`provider costs pushed`, { days: costs.length });
    } catch (error) {
      this.logger.warn(`cost push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async pullOpenAi(): Promise<DailyCost[]> {
    try {
      const startTime = Math.floor((Date.now() - LOOKBACK_DAYS * 86_400_000) / 1000);
      const res = await fetch(
        `https://api.openai.com/v1/organization/costs?start_time=${String(startTime)}&bucket_width=1d&limit=${String(LOOKBACK_DAYS + 1)}`,
        {
          headers: { authorization: `Bearer ${env.OPENAI_ADMIN_KEY as string}` },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        this.logger.warn(
          `OpenAI costs pull returned ${res.status}${res.status === 401 ? " — the key must be an ADMIN key, not a project key" : ""}`,
        );
        return [];
      }
      const body = (await res.json()) as {
        data?: { start_time?: number; results?: { amount?: { value?: number } }[] }[];
      };
      const out: DailyCost[] = [];
      for (const bucket of body.data ?? []) {
        if (bucket.start_time === undefined) continue;
        const total = (bucket.results ?? []).reduce((a, r) => a + (r.amount?.value ?? 0), 0);
        out.push({
          provider: "openai",
          date: new Date(bucket.start_time * 1000).toISOString().slice(0, 10),
          cost_usd: Math.round(total * 10_000) / 10_000,
          calls: 0,
        });
      }
      return out;
    } catch (error) {
      this.logger.warn(`OpenAI costs pull failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }

  private async pullTwilio(): Promise<DailyCost[]> {
    try {
      const sid = env.TWILIO_ACCOUNT_SID as string;
      const start = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString().slice(0, 10);
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Usage/Records/Daily.json?Category=totalprice&StartDate=${start}&PageSize=${String(LOOKBACK_DAYS + 1)}`,
        {
          headers: {
            authorization: `Basic ${Buffer.from(`${sid}:${env.TWILIO_AUTH_TOKEN as string}`).toString("base64")}`,
          },
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );
      if (!res.ok) {
        this.logger.warn(`Twilio usage pull returned ${res.status}`);
        return [];
      }
      const body = (await res.json()) as {
        usage_records?: { start_date?: string; price?: string | number; count?: string | number }[];
      };
      return (body.usage_records ?? [])
        .filter((r) => r.start_date !== undefined)
        .map((r) => ({
          provider: "twilio",
          date: r.start_date as string,
          cost_usd: Math.round(Number(r.price ?? 0) * 10_000) / 10_000,
          calls: Number(r.count ?? 0),
        }));
    } catch (error) {
      this.logger.warn(`Twilio usage pull failed: ${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  }
}
