import { BadGatewayException, Injectable, Logger } from "@nestjs/common";

import type { StoredWorkflowSource } from "./workflow-events.repository";

const SIMULATED_NOTE = "Simulated — connect the platform API to make this real";

/**
 * Thin HTTP client for the n8n public API plus generic webhook re-injection.
 * When a source has no base URL / API key configured (sample mode), calls are
 * simulated and say so in the returned note — the seam stays identical.
 */
@Injectable()
export class N8nGateway {
  private readonly logger = new Logger(N8nGateway.name);

  private isConfigured(source: StoredWorkflowSource): boolean {
    return source.baseUrl !== null && source.apiKey !== null;
  }

  async retryExecution(
    source: StoredWorkflowSource,
    executionId: string,
    loadWorkflow: boolean,
  ): Promise<{ retryExecutionId: string; note: string | null }> {
    if (!this.isConfigured(source)) {
      return {
        retryExecutionId: `sim-retry-${Date.now().toString().slice(-6)}`,
        note: SIMULATED_NOTE,
      };
    }
    const url = `${source.baseUrl}/api/v1/executions/${encodeURIComponent(executionId)}/retry`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-N8N-API-KEY": source.apiKey as string,
        "content-type": "application/json",
      },
      body: JSON.stringify({ loadWorkflow }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.error(`n8n retry failed`, { url, status: res.status, body: body.slice(0, 500) });
      throw new BadGatewayException(`n8n retry failed with status ${res.status}`);
    }
    const data = (await res.json()) as { id?: string | number };
    return { retryExecutionId: String(data.id ?? ""), note: null };
  }

  /** Re-inject an edited trigger payload into a webhook URL (n8n webhook or Zapier catch URL). */
  async resubmitPayload(
    resubmitUrl: string,
    payload: Record<string, unknown>,
    live: boolean,
  ): Promise<{ note: string | null }> {
    if (!live) {
      return { note: SIMULATED_NOTE };
    }
    const res = await fetch(resubmitUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      this.logger.error(`resubmit failed`, { resubmitUrl, status: res.status });
      throw new BadGatewayException(`Webhook re-injection failed with status ${res.status}`);
    }
    return { note: null };
  }
}
