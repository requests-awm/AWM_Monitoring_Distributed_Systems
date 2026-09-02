import { z } from "zod";

/**
 * Body of `POST /api/ingest/usage` — an app reports how many calls it made to
 * a third-party provider over a short window. Authenticated with the same
 * per-app ingest bearer token as failure reporting; the app identity comes
 * from the token, never from the body.
 */
export const UsageReportBody = z.object({
  /** Provider being consumed, lowercase: "insightly", "asana", "openai", "twilio", … */
  provider: z.string().min(2).max(60).transform((v) => v.toLowerCase()),
  /** Which automation/job inside the app made the calls, e.g. "lead-import". */
  automation: z.string().min(1).max(120).optional(),
  /** Calls made in the window. */
  calls: z.number().int().min(0),
  /** Calls that errored (4xx/5xx/timeouts), if tracked. */
  errors: z.number().int().min(0).default(0),
  /** Optional extra counters, e.g. { "tokens": 8123, "sms": 4 }. */
  units: z.record(z.number()).optional(),
  window_start: z.string().datetime({ offset: true }),
  window_end: z.string().datetime({ offset: true }),
});
export type UsageReportBody = z.infer<typeof UsageReportBody>;

export interface UsageIngestResult {
  ok: true;
  /** UTC day bucket the report was added to. */
  bucket: string;
}

export interface UsageDayRow {
  /** App name (from the ingest token's source). */
  app: string;
  provider: string;
  /** Automation/job inside the app, when the report attributed one. */
  automation: string | null;
  /** UTC calendar date, YYYY-MM-DD. */
  date: string;
  calls: number;
  errors: number;
  units: Record<string, number>;
}

/** "This automation talks to this provider" — derived, not counted. */
export interface ProviderReference {
  provider: string;
  /** Where the automation lives, e.g. "AWM n8n". */
  app: string;
  automation: string;
  externalId: string | null;
}

/** Response of `GET /api/usage`. */
export interface UsageResponse {
  generatedAt: string;
  /** Freshness / durability caveats shown on the page. */
  notes: string[];
  rows: UsageDayRow[];
  /** Static attribution (e.g. n8n workflow definitions scanned for provider nodes/URLs). */
  references: ProviderReference[];
}

/**
 * Body of `POST /api/internal/provider-costs` — worker pushes billing pulls
 * (OpenAI costs API, Twilio usage records). Replace semantics per
 * (provider, date): re-pushing a day overwrites it, never double-counts.
 */
export const ProviderCostsPushBody = z.object({
  app: z.string().min(1).max(80).default("provider-billing"),
  costs: z
    .array(
      z.object({
        provider: z.string().min(2).max(60).transform((v) => v.toLowerCase()),
        /** UTC calendar date, YYYY-MM-DD. */
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        cost_usd: z.number().min(0),
        calls: z.number().int().min(0).default(0),
      }),
    )
    .max(1000),
});
export type ProviderCostsPushBody = z.infer<typeof ProviderCostsPushBody>;

/** Body of `POST /api/internal/provider-references` — worker pushes the derived map. */
export const ProviderReferencesPushBody = z.object({
  app: z.string().min(1).max(80),
  references: z
    .array(
      z.object({
        provider: z.string().min(2).max(60),
        automation: z.string().min(1).max(200),
        external_id: z.string().max(200).nullish(),
      }),
    )
    .max(20000),
});
export type ProviderReferencesPushBody = z.infer<typeof ProviderReferencesPushBody>;
