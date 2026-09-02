import { loadEnvFiles, parseEnv } from "@awm/config";
import { z } from "zod";

loadEnvFiles();

const DEV_DEFAULTS = new Set([
  "dev-ingest-n8n-sample-token",
  "dev-ingest-zapier-sample-token",
  "dev-worker-token-sample",
]);

export const env = parseEnv(
  z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(3000),
    // Interim auth gate until Supabase Auth (M1): when set, every /api route except
    // health/ingest/heartbeats/internal requires the X-Access-Token header.
    ACCESS_TOKEN: z.string().min(24).optional(),
    // Built dashboard to serve as the SPA; defaults to apps/dashboard/dist when present.
    DASHBOARD_DIST: z.string().min(1).optional(),
    // When set (hostname only, e.g. awmappmonitor.ascotwm.com), page loads on any
    // other host 301 to it — keeps the dashboard on a single origin so the stored
    // access token is only ever needed in one place.
    CANONICAL_HOST: z.string().min(1).optional(),
    // Live mode switch: set → Prisma repository against the shared DB; unset → in-memory sample store.
    DATABASE_URL: z.string().url().optional(),
    // AES-256-GCM key (base64, 32 bytes) for secrets at rest (n8n API keys, channel credentials).
    ENCRYPTION_KEY: z.string().min(1).optional(),
    // Sample-mode ingest tokens; in live mode tokens are validated against workflow_sources.ingest_token_hash.
    INGEST_TOKEN_N8N: z.string().min(16).default("dev-ingest-n8n-sample-token"),
    INGEST_TOKEN_ZAPIER: z.string().min(16).default("dev-ingest-zapier-sample-token"),
    // Shared secret for the worker's internal endpoints (due checks + result reports).
    WORKER_TOKEN: z.string().min(16).default("dev-worker-token-sample"),
    // Twilio (SMS / WhatsApp channels send for real when all three are set).
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
    TWILIO_FROM: z.string().min(1).optional(),
    // "false" hides all sample/demo data (fixture workflow events and the demo
    // heartbeat monitor) — set on deployments where only real data should show.
    SEED_DEMO_DATA: z.string().optional(),
    // Public base URL of this API for the seeded self-monitoring checks; the
    // worker executes checks from its own container, so localhost would probe
    // the worker itself. Unset = localhost (correct for single-machine dev).
    SELF_BASE_URL: z
      .string()
      .url()
      .transform((u) => u.replace(/\/+$/, ""))
      .optional(),
    // Set for the worker sweep; the API reads it for the automations inventory
    // and to skip fake n8n seed data.
    N8N_BASE_URL: z
      .string()
      .url()
      .transform((u) => u.replace(/\/+$/, ""))
      .optional(),
    N8N_API_KEY: z.string().min(1).optional(),
    // OpenAI-compatible key/model for generated fix suggestions; unset = the
    // suggest-fix endpoint reports the feature as not configured.
    LLM_API_KEY: z.string().min(1).optional(),
    LLM_MODEL: z.string().min(1).default("gpt-5-mini"),
  }).superRefine((v, ctx) => {
    if (v.NODE_ENV !== "production") return;
    if (v.ACCESS_TOKEN === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ACCESS_TOKEN"],
        message: "required in production — interim auth gate until Supabase Auth lands (M1)",
      });
    }
    if (DEV_DEFAULTS.has(v.WORKER_TOKEN)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["WORKER_TOKEN"],
        message: "dev default is not allowed in production — generate a real secret",
      });
    }
    // Sample-mode ingest tokens are live credentials when there is no DB to validate against.
    if (v.DATABASE_URL === undefined) {
      for (const key of ["INGEST_TOKEN_N8N", "INGEST_TOKEN_ZAPIER"] as const) {
        if (DEV_DEFAULTS.has(v[key])) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: "dev default is not allowed in production sample mode — generate a real secret",
          });
        }
      }
    }
  }),
);

export const isLiveMode = env.DATABASE_URL !== undefined;
export const seedDemoData = env.SEED_DEMO_DATA !== "false";
