import { loadEnvFiles, parseEnv } from "@awm/config";
import { z } from "zod";

loadEnvFiles();

export const env = parseEnv(
  z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // Minimal HTTP listener for container/platform health probes (GET /health).
    WORKER_PORT: z.coerce.number().int().positive().default(3001),
    REDIS_URL: z.string().url().default("redis://localhost:6379"),
    // Where the API lives (the worker talks to it for due checks, results, and sweep ingest).
    API_BASE_URL: z.string().url().default("http://localhost:3000"),
    // Shared secret for /api/internal endpoints — must match the API's WORKER_TOKEN.
    WORKER_TOKEN: z.string().min(16).default("dev-worker-token-sample"),
    // Check poll cadence. TODO(m2): replace with BullMQ repeatable jobs once Redis is provisioned.
    POLL_INTERVAL_MS: z.coerce.number().int().min(1000).default(10_000),
    // n8n reconciliation sweep — N8N_BASE_URL, N8N_API_KEY and INGEST_TOKEN_N8N must all be set.
    N8N_BASE_URL: z
      .string()
      .url()
      .transform((u) => u.replace(/\/+$/, ""))
      .optional(),
    N8N_API_KEY: z.string().min(1).optional(),
    INGEST_TOKEN_N8N: z.string().min(16).optional(),
    SWEEP_INTERVAL_MS: z.coerce.number().int().min(60_000).default(300_000),
    // Provider billing pulls (cost tracking) — each provider activates only
    // when its credentials are present. OpenAI costs need an ADMIN key
    // (api.openai.com/v1/organization/costs rejects project keys).
    OPENAI_ADMIN_KEY: z.string().min(1).optional(),
    TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
    TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  }).superRefine((v, ctx) => {
    if (v.NODE_ENV === "production" && v.WORKER_TOKEN === "dev-worker-token-sample") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["WORKER_TOKEN"],
        message: "dev default is not allowed in production — must match the API's WORKER_TOKEN",
      });
    }
  }),
);
