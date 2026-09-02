import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";

import { env } from "../config/env";

const CRAWL_INTERVAL_MS = 24 * 60 * 60 * 1000;
const BOOT_DELAY_MS = 2 * 60_000; // let the sweep's first pass finish first
// The API keeps references in memory, so a redeploy wipes them — re-push the
// cached crawl result often enough that the gap stays short.
const REPUSH_INTERVAL_MS = 15 * 60_000;

/** node.type substring → provider name (lowercase, matches usage reporting). */
const NODE_TYPE_PROVIDERS: [string, string][] = [
  ["asana", "asana"],
  ["openai", "openai"],
  ["twilio", "twilio"],
  ["supabase", "supabase"],
  ["slack", "slack"],
  ["gmail", "google"],
  ["googlesheets", "google"],
  ["googledrive", "google"],
  ["googlecalendar", "google"],
  ["microsoftoutlook", "msgraph"],
  ["microsoftteams", "msgraph"],
  ["xero", "xero"],
];

/** HTTP Request node URL hostname substring → provider. */
const URL_PROVIDERS: [string, string][] = [
  ["api.asana.com", "asana"],
  ["api.insightly.com", "insightly"],
  ["api.openai.com", "openai"],
  ["api.twilio.com", "twilio"],
  ["supabase.co", "supabase"],
  ["graph.microsoft.com", "msgraph"],
  ["api.xero.com", "xero"],
  ["hooks.slack.com", "slack"],
  ["googleapis.com", "google"],
];

interface N8nNode {
  type?: string;
  parameters?: { url?: unknown };
}

/**
 * Answers "which n8n workflows talk to which provider" without any middleware:
 * scans every workflow definition (node types + HTTP Request URLs) once a day
 * and pushes the provider→workflow map to the API for the usage report.
 * Read-only against n8n.
 */
@Injectable()
export class ProviderReferencesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProviderReferencesService.name);
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private repushTimer: NodeJS.Timeout | null = null;
  private lastReferences: { provider: string; automation: string; external_id: string }[] | null = null;

  onModuleInit(): void {
    if (
      env.N8N_BASE_URL === undefined ||
      env.N8N_API_KEY === undefined
    ) {
      this.logger.log("provider-reference crawl idle — n8n not configured");
      return;
    }
    this.bootTimer = setTimeout(() => void this.crawl(), BOOT_DELAY_MS);
    this.timer = setInterval(() => void this.crawl(), CRAWL_INTERVAL_MS);
    this.repushTimer = setInterval(() => void this.push(), REPUSH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
    if (this.bootTimer !== null) clearTimeout(this.bootTimer);
    if (this.repushTimer !== null) clearInterval(this.repushTimer);
  }

  private async push(): Promise<void> {
    if (this.lastReferences === null) return;
    try {
      const res = await fetch(`${env.API_BASE_URL}/api/internal/provider-references`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.WORKER_TOKEN}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ app: "AWM n8n", references: this.lastReferences }),
      });
      if (!res.ok) this.logger.warn(`reference push rejected: ${res.status}`);
    } catch (error) {
      this.logger.warn(`reference push failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async crawl(): Promise<void> {
    try {
      const workflows = await this.listWorkflows();
      const references: { provider: string; automation: string; external_id: string }[] = [];
      let scanned = 0;
      for (const wf of workflows) {
        const providers = await this.providersOf(wf.id);
        scanned += 1;
        for (const provider of providers) {
          references.push({ provider, automation: wf.name, external_id: wf.id });
        }
      }
      this.lastReferences = references;
      await this.push();
      this.logger.log(`provider-reference crawl complete`, {
        scanned,
        references: references.length,
      });
    } catch (error) {
      this.logger.warn(
        `provider-reference crawl failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private async listWorkflows(): Promise<{ id: string; name: string }[]> {
    const out: { id: string; name: string }[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 12; page += 1) {
      const url = `${env.N8N_BASE_URL as string}/api/v1/workflows?limit=250${cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`}`;
      const res = await fetch(url, { headers: { "X-N8N-API-KEY": env.N8N_API_KEY as string } });
      if (!res.ok) throw new Error(`workflows list returned ${res.status}`);
      const body = (await res.json()) as {
        data?: { id: string | number; name?: string }[];
        nextCursor?: string | null;
      };
      for (const w of body.data ?? []) out.push({ id: String(w.id), name: w.name ?? String(w.id) });
      cursor = body.nextCursor ?? null;
      if (cursor === null) break;
    }
    return out;
  }

  private async providersOf(workflowId: string): Promise<Set<string>> {
    const providers = new Set<string>();
    try {
      const res = await fetch(
        `${env.N8N_BASE_URL as string}/api/v1/workflows/${encodeURIComponent(workflowId)}`,
        { headers: { "X-N8N-API-KEY": env.N8N_API_KEY as string } },
      );
      if (!res.ok) return providers;
      const body = (await res.json()) as { nodes?: N8nNode[] };
      for (const node of body.nodes ?? []) {
        const type = (node.type ?? "").toLowerCase();
        for (const [needle, provider] of NODE_TYPE_PROVIDERS) {
          if (type.includes(needle)) providers.add(provider);
        }
        const url = typeof node.parameters?.url === "string" ? node.parameters.url.toLowerCase() : "";
        if (url !== "") {
          for (const [host, provider] of URL_PROVIDERS) {
            if (url.includes(host)) providers.add(provider);
          }
        }
      }
    } catch {
      // one broken workflow must not sink the crawl
    }
    return providers;
  }
}
