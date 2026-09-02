import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Injectable,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import {
  ProviderReferencesPushBody,
  UsageReportBody,
  type ProviderReference,
  type UsageDayRow,
  type UsageIngestResult,
  type UsageResponse,
} from "@awm/shared";

import { RolesGuard } from "../auth/roles.guard";
import { env } from "../config/env";
import { sha256Hex } from "../lib/secrets";
import {
  WORKFLOW_EVENTS_REPOSITORY,
  type WorkflowEventsRepository,
} from "./workflow-events.repository";

const RETENTION_DAYS = 30;

/**
 * Per-app, per-provider API-usage counters, bucketed by UTC day. In-memory in
 * v1 (counters reset on API restart) — durable storage lands with the usage
 * table (tracked in docs/CONTINUATION.md). Apps report via the middleware in
 * docs/integrations/TRACK_API_USAGE.md.
 */
@Injectable()
export class UsageStore {
  /** key: `${app}|${provider}|${automation}|${date}` */
  private readonly buckets = new Map<string, UsageDayRow>();
  /** Derived provider→automation map, replaced whole per app on each push. */
  private readonly references = new Map<string, ProviderReference[]>();

  add(app: string, report: UsageReportBody): string {
    const date = report.window_end.slice(0, 10);
    const automation = report.automation ?? null;
    const key = `${app}|${report.provider}|${automation ?? ""}|${date}`;
    const row =
      this.buckets.get(key) ??
      ({ app, provider: report.provider, automation, date, calls: 0, errors: 0, units: {} } as UsageDayRow);
    row.calls += report.calls;
    row.errors += report.errors;
    for (const [name, value] of Object.entries(report.units ?? {})) {
      row.units[name] = (row.units[name] ?? 0) + value;
    }
    this.buckets.set(key, row);
    this.prune();
    return date;
  }

  rows(): UsageDayRow[] {
    return [...this.buckets.values()];
  }

  setReferences(app: string, refs: ProviderReference[]): number {
    this.references.set(app, refs);
    return refs.length;
  }

  allReferences(): ProviderReference[] {
    return [...this.references.values()].flat();
  }

  private prune(): void {
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const [key, row] of this.buckets) {
      if (row.date < cutoff) this.buckets.delete(key);
    }
  }
}

@Controller()
export class UsageController {
  constructor(
    private readonly store: UsageStore,
    @Inject(WORKFLOW_EVENTS_REPOSITORY) private readonly repo: WorkflowEventsRepository,
  ) {}

  /** Apps push usage counters here with their ingest bearer token. */
  @Post("ingest/usage")
  @HttpCode(200)
  async ingest(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ): Promise<UsageIngestResult> {
    if (authorization === undefined || !authorization.toLowerCase().startsWith("bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }
    const source = await this.repo.findSourceByTokenHash(sha256Hex(authorization.slice(7).trim()));
    if (source === null) {
      throw new UnauthorizedException("Unknown ingest token");
    }
    const parsed = UsageReportBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Usage report validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    return { ok: true, bucket: this.store.add(source.name, parsed.data) };
  }

  /** Worker pushes the derived provider→automation map (n8n workflow scan). */
  @Post("internal/provider-references")
  @HttpCode(200)
  references(
    @Headers("authorization") authorization: string | undefined,
    @Body() body: unknown,
  ): { stored: number } {
    if (authorization !== `Bearer ${env.WORKER_TOKEN}`) {
      throw new UnauthorizedException("Invalid worker token");
    }
    const parsed = ProviderReferencesPushBody.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        message: "Provider references validation failed",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
    }
    const refs = parsed.data.references.map((r) => ({
      provider: r.provider.toLowerCase(),
      app: parsed.data.app,
      automation: r.automation,
      externalId: r.external_id ?? null,
    }));
    return { stored: this.store.setReferences(parsed.data.app, refs) };
  }

  /** Aggregated usage for the dashboard. */
  @Get("usage")
  @UseGuards(RolesGuard)
  usage(): UsageResponse {
    return {
      generatedAt: new Date().toISOString(),
      notes: [
        "Counters are held in memory for 30 days and reset on API restarts — durable storage arrives with the usage table.",
      ],
      rows: this.store.rows(),
      references: this.store.allReferences(),
    };
  }
}
