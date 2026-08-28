import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import { config as loadDotenvFile } from "dotenv";
import { z } from "zod";

/**
 * Load secrets from .env files into process.env. Precedence (highest first):
 * real environment variables → the app's own .env → the workspace-root .env.
 * dotenv never overrides values that are already set, so exporting a variable
 * in the shell always wins. Server-side only — the dashboard must never load
 * this (Vite exposes only VITE_-prefixed values to the browser, and secrets
 * must never carry that prefix).
 */
export function loadEnvFiles(cwd: string = process.cwd()): void {
  loadDotenvFile({ path: join(cwd, ".env") });
  let dir = cwd;
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) {
      loadDotenvFile({ path: join(dir, ".env") });
      return;
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

/**
 * Validate a process environment against a zod schema, failing fast with a
 * readable message. Use at the top of each app's bootstrap.
 */
export function parseEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: Record<string, string | undefined> = process.env,
): z.infer<T> {
  // Blank values (e.g. the empty placeholder lines in .env) count as unset,
  // so optional secrets stay optional until a real value is pasted in.
  const cleaned = Object.fromEntries(
    Object.entries(source).filter(([, value]) => value !== undefined && value.trim() !== ""),
  );
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}
