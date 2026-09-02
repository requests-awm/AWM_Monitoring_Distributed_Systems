import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from "@nestjs/common";
import type { WorkflowEventActionResult, WorkflowFixSuggestion } from "@awm/shared";

import { env } from "../config/env";
import {
  WORKFLOW_EVENTS_REPOSITORY,
  type StoredWorkflowEvent,
  type WorkflowEventsRepository,
} from "./workflow-events.repository";

const FETCH_TIMEOUT_MS = 20_000;
const LLM_TIMEOUT_MS = 60_000;

const SUMMARY_MAX = 600;
const CHANGE_MAX = 1200;
const CHANGES_MAX = 8;

interface SanitizedNode {
  name: string;
  type: string;
  parameters: unknown;
}

/**
 * Generates a WorkflowFixSuggestion for an n8n failure event by sending the
 * error context plus a credential-stripped view of the workflow definition to
 * an OpenAI-compatible model. The suggestion is advice only — nothing is
 * changed on the platform until a human acts on it.
 */
@Injectable()
export class FixSuggesterService {
  private readonly logger = new Logger(FixSuggesterService.name);
  private readonly inFlight = new Set<string>();

  constructor(
    @Inject(WORKFLOW_EVENTS_REPOSITORY) private readonly repo: WorkflowEventsRepository,
  ) {}

  async suggestFix(id: string): Promise<WorkflowEventActionResult> {
    const event = await this.repo.getEvent(id);
    if (event === null) throw new NotFoundException(`Workflow event ${id} not found`);
    if (event.platform !== "n8n") {
      throw new BadRequestException("Fix suggestions are only available for n8n workflows");
    }
    if (event.fixSuggestion !== null) {
      return { event: toPublic(event), note: "A suggestion already exists for this event" };
    }
    if (env.LLM_API_KEY === undefined) {
      throw new BadRequestException("Fix suggestions are not configured — set LLM_API_KEY");
    }
    if (this.inFlight.has(id)) {
      throw new BadRequestException("A suggestion is already being generated for this event");
    }

    this.inFlight.add(id);
    try {
      const workflow = await this.fetchSanitizedWorkflow(event.workflowExternalId);
      const suggestion = await this.callModel(event, workflow);
      const updated = await this.repo.patchEvent(id, { fixSuggestion: suggestion });
      return { event: toPublic(updated), note: `Suggestion generated with ${env.LLM_MODEL}` };
    } finally {
      this.inFlight.delete(id);
    }
  }

  /** Workflow structure only: node names/types/parameters — credentials, pin data and static data stripped. */
  private async fetchSanitizedWorkflow(
    workflowId: string,
  ): Promise<{ name: string; nodes: SanitizedNode[]; connections: unknown } | null> {
    if (env.N8N_BASE_URL === undefined || env.N8N_API_KEY === undefined) return null;
    try {
      const res = await fetch(
        `${env.N8N_BASE_URL}/api/v1/workflows/${encodeURIComponent(workflowId)}`,
        { headers: { "X-N8N-API-KEY": env.N8N_API_KEY }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) },
      );
      if (!res.ok) return null;
      const wf = (await res.json()) as {
        name?: string;
        nodes?: { name?: string; type?: string; parameters?: unknown }[];
        connections?: unknown;
      };
      return {
        name: wf.name ?? workflowId,
        nodes: (wf.nodes ?? []).map((n) => ({
          name: n.name ?? "?",
          type: n.type ?? "?",
          parameters: n.parameters ?? {},
        })),
        connections: wf.connections ?? {},
      };
    } catch (error) {
      this.logger.warn(
        `workflow fetch failed — suggesting from the error alone`,
        { workflowId, error: error instanceof Error ? error.message : String(error) },
      );
      return null;
    }
  }

  private async callModel(
    event: StoredWorkflowEvent,
    workflow: { name: string; nodes: SanitizedNode[]; connections: unknown } | null,
  ): Promise<WorkflowFixSuggestion> {
    const context = {
      workflow_name: event.workflowName,
      error_message: event.errorMessage,
      error_node: event.errorNode,
      error_stack: event.errorStack?.slice(0, 4000) ?? null,
      workflow_definition: workflow === null ? "unavailable" : truncateJson(workflow, 60_000),
    };
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.LLM_API_KEY as string}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: env.LLM_MODEL,
        response_format: { type: "json_object" },
        // Reasoning tokens count against this budget on gpt-5 models; too low
        // and the visible content comes back empty with finish_reason "length".
        max_completion_tokens: 8000,
        messages: [
          {
            role: "system",
            content:
              "You are an n8n workflow reliability engineer. Given a failed execution's error and the workflow definition, diagnose the most likely root cause and propose a concrete fix. " +
              'Respond with JSON only: {"summary": "<one-sentence diagnosis>", "changes": ["<specific edit to make in the workflow, naming the node and setting>", ...]}. ' +
              "1 to 8 changes, each independently actionable by a person editing the workflow in the n8n editor. Keep the summary to one sentence and each change under 350 characters — name the node and the setting, don't paste whole code blocks. " +
              "If the cause is external (expired credential, third-party outage, rate limit), say so in the summary and make the changes defensive (retry settings, error handling).",
          },
          { role: "user", content: JSON.stringify(context) },
        ],
      }),
      signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = (await res.text()).slice(0, 300);
      this.logger.warn(`LLM call failed`, { status: res.status, body });
      throw new BadRequestException(`Suggestion model returned ${res.status}`);
    }
    const completion = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = completion.choices?.[0]?.message?.content;
    if (content === undefined || content === "") {
      throw new BadRequestException("Suggestion model returned an empty response");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new BadRequestException("Suggestion model returned malformed JSON");
    }
    // Coerce rather than reject: a usable diagnosis that runs long is still a
    // usable diagnosis (models routinely blow through requested lengths).
    const suggestion = coerceSuggestion(parsed);
    if (suggestion === null) {
      this.logger.warn(`unusable suggestion shape`, { content: content.slice(0, 300) });
      throw new BadRequestException("Suggestion model response did not match the expected shape");
    }
    return suggestion;
  }
}

function coerceSuggestion(parsed: unknown): WorkflowFixSuggestion | null {
  if (parsed === null || typeof parsed !== "object") return null;
  const obj = parsed as Record<string, unknown>;
  const summaryRaw = obj["summary"] ?? obj["diagnosis"];
  if (typeof summaryRaw !== "string" || summaryRaw.trim() === "") return null;
  const changesRaw = Array.isArray(obj["changes"]) ? obj["changes"] : [];
  const changes = changesRaw
    .map((c) => (typeof c === "string" ? c : JSON.stringify(c)))
    .map((c) => c.trim())
    .filter((c) => c !== "")
    .slice(0, CHANGES_MAX)
    .map((c) => truncate(c, CHANGE_MAX));
  return {
    summary: truncate(summaryRaw.trim(), SUMMARY_MAX),
    changes: changes.length > 0 ? changes : ["No specific workflow edit proposed — see the summary."],
    mechanism:
      "Generated by AI from the error and workflow definition — apply the edits in the n8n editor, then retry",
  };
}

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

function toPublic(event: StoredWorkflowEvent): import("@awm/shared").WorkflowFailureEvent {
  const { orgId, sourceId, dedupKey, resubmitUrl, ...pub } = event;
  void orgId;
  void sourceId;
  void dedupKey;
  void resubmitUrl;
  return pub;
}

function truncateJson(value: unknown, maxChars: number): string {
  const json = JSON.stringify(value);
  return json.length <= maxChars ? json : `${json.slice(0, maxChars)}…(truncated)`;
}
