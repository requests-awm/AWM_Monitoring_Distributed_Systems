import { useEffect, useRef, useState, type ReactNode } from "react";
import type { WorkflowFailureEvent } from "@awm/shared";

import { fullTime, ingestLag, timeAgo } from "../lib/time";
import { ASSIGNEES, EVENT_TYPE_META } from "../lib/workflowMeta";
import {
  ActionButton,
  EventStatusBadge,
  ExternalLink,
  PlatformChip,
} from "./WorkflowBadges";

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <ActionButton
      onClick={() => {
        navigator.clipboard
          .writeText(text)
          .then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          })
          .catch(() => setCopied(false));
      }}
    >
      {copied ? "Copied ✓" : label}
    </ActionButton>
  );
}

/** Everything a person needs to paste into a troubleshooting chat or ticket. */
function errorClipboard(event: WorkflowFailureEvent): string {
  return [
    `Workflow: ${event.workflowName} (${event.platform})`,
    event.executionExternalId !== null ? `Execution: ${event.executionExternalId}` : null,
    event.executionUrl !== null ? `URL: ${event.executionUrl}` : null,
    `Occurred: ${event.occurredAt}`,
    event.errorNode !== null ? `Failed node: ${event.errorNode}` : null,
    ``,
    event.errorMessage,
    event.errorStack !== null ? `\n${event.errorStack}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}

function MetaItem({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <div>
      <dt
        className="text-xs font-medium uppercase tracking-wide"
        style={{ color: "var(--ink-muted)" }}
      >
        {label}
      </dt>
      <dd className="mt-0.5 text-sm" style={{ color: "var(--ink-secondary)" }}>
        {children}
      </dd>
    </div>
  );
}

export function WorkflowEventDrawer({
  event,
  onClose,
  onAcknowledge,
  onResolve,
  onIgnore,
  onRetry,
  onAssign,
  onApplyFix,
  onResubmit,
}: {
  event: WorkflowFailureEvent;
  onClose: () => void;
  onAcknowledge: () => void;
  onResolve: () => void;
  onIgnore: () => void;
  onRetry: () => void;
  onAssign: (assignee: string) => void;
  onApplyFix: () => void;
  onResubmit: (payload: Record<string, unknown>) => void;
}): JSX.Element {
  const closeRef = useRef<HTMLButtonElement>(null);
  const [panel, setPanel] = useState<"none" | "fix" | "resubmit">("none");
  const [draft, setDraft] = useState("");
  const [draftError, setDraftError] = useState<string | null>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const closed = event.status === "resolved" || event.status === "ignored";
  const lag = ingestLag(event.occurredAt, event.receivedAt);

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0, 0, 0, 0.35)" }}
        onClick={onClose}
        aria-hidden
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={`Failure details — ${event.workflowName}`}
        className="absolute right-0 top-0 flex h-full w-[540px] max-w-full flex-col overflow-y-auto border-l"
        style={{ background: "var(--surface-card)", borderColor: "var(--hairline)" }}
      >
        <header
          className="sticky top-0 border-b px-5 py-4"
          style={{ background: "var(--surface-card)", borderColor: "var(--hairline)" }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <PlatformChip platform={event.platform} />
                <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                  {EVENT_TYPE_META[event.eventType].label}
                </span>
                <EventStatusBadge status={event.status} />
              </div>
              <h2 className="mt-1.5 truncate text-base font-semibold">{event.workflowName}</h2>
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close details"
              className="rounded-md px-2 py-1 text-sm transition-colors hover:bg-[var(--surface-inset)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              style={{ color: "var(--ink-muted)" }}
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex flex-1 flex-col gap-5 px-5 py-4">
          <div
            className="rounded-lg border px-4 py-3 text-sm"
            style={{
              borderColor: "var(--hairline)",
              background: "var(--surface-inset)",
            }}
          >
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1 font-medium" style={{ color: "var(--status-critical)" }}>
                {event.errorMessage}
              </div>
              <CopyButton text={errorClipboard(event)} label="Copy error" />
            </div>
            {event.errorNode !== null ? (
              <div className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                Failed node: <span className="font-medium">{event.errorNode}</span>
              </div>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {event.canRetry ? (
              <ActionButton tone="accent" onClick={onRetry}>
                ↻ Retry execution
              </ActionButton>
            ) : null}
            {event.fixSuggestion !== null ? (
              <ActionButton
                tone="accent"
                aria-expanded={panel === "fix"}
                onClick={() => setPanel(panel === "fix" ? "none" : "fix")}
              >
                ✦ Suggest fix
              </ActionButton>
            ) : null}
            {event.canResubmit && event.inputPayload !== null ? (
              <ActionButton
                aria-expanded={panel === "resubmit"}
                onClick={() => {
                  if (panel !== "resubmit") {
                    setDraft(JSON.stringify(event.inputPayload, null, 2));
                    setDraftError(null);
                  }
                  setPanel(panel === "resubmit" ? "none" : "resubmit");
                }}
              >
                Edit &amp; resubmit
              </ActionButton>
            ) : null}
            {event.executionUrl !== null ? (
              <ExternalLink href={event.executionUrl}>
                {event.platform === "zapier" ? "Open Zap History" : "Open execution"}
              </ExternalLink>
            ) : null}
            {event.platform === "zapier" && /^\d+$/.test(event.workflowExternalId) ? (
              <ExternalLink href={`https://zapier.com/editor/${event.workflowExternalId}`}>
                Open Zap editor
              </ExternalLink>
            ) : null}
            <ActionButton onClick={onAcknowledge} disabled={event.status !== "new"}>
              Acknowledge
            </ActionButton>
            <ActionButton onClick={onResolve} disabled={closed}>
              Resolve
            </ActionButton>
            <ActionButton onClick={onIgnore} disabled={closed}>
              Ignore
            </ActionButton>
            <label className="ml-auto flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-muted)" }}>
              Assignee
              <select
                value={event.assignee ?? ""}
                onChange={(e) => onAssign(e.target.value)}
                className="rounded-md border px-2 py-1.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                style={{
                  borderColor: "var(--hairline)",
                  background: "var(--surface-card)",
                  color: "var(--ink-primary)",
                }}
              >
                <option value="">Unassigned</option>
                {ASSIGNEES.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {panel === "fix" && event.fixSuggestion !== null ? (
            <div
              className="rounded-lg border px-4 py-3"
              style={{ borderColor: "var(--accent)", background: "var(--surface-inset)" }}
            >
              <h3 className="text-sm font-semibold">{event.fixSuggestion.summary}</h3>
              <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm" style={{ color: "var(--ink-secondary)" }}>
                {event.fixSuggestion.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
              <p className="mt-2.5 text-xs" style={{ color: "var(--ink-muted)" }}>
                {event.fixSuggestion.mechanism}. Nothing changes until you apply.
              </p>
              <div className="mt-3 flex gap-2">
                <ActionButton
                  tone="accent"
                  onClick={() => {
                    setPanel("none");
                    onApplyFix();
                  }}
                >
                  Apply fix &amp; retry
                </ActionButton>
                <ActionButton onClick={() => setPanel("none")}>Dismiss</ActionButton>
              </div>
            </div>
          ) : null}

          {panel === "resubmit" ? (
            <div
              className="rounded-lg border px-4 py-3"
              style={{ borderColor: "var(--hairline)", background: "var(--surface-inset)" }}
            >
              <h3 className="text-sm font-semibold">Edit the trigger payload and re-inject it</h3>
              <p className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                {event.platform === "zapier"
                  ? "Re-posts to the Zap's catch URL — a fresh run with your corrected data."
                  : "Re-posts to the workflow's webhook — a fresh execution with your corrected data."}
              </p>
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDraftError(null);
                }}
                rows={9}
                spellCheck={false}
                aria-label="Trigger payload JSON"
                className="mt-2 w-full rounded-md border px-3 py-2 font-mono text-xs leading-relaxed focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                style={{
                  borderColor: draftError !== null ? "var(--status-critical)" : "var(--hairline)",
                  background: "var(--surface-card)",
                  color: "var(--ink-primary)",
                  resize: "vertical",
                }}
              />
              {draftError !== null ? (
                <p className="mt-1 text-xs" style={{ color: "var(--status-critical)" }}>
                  {draftError}
                </p>
              ) : null}
              <div className="mt-2 flex gap-2">
                <ActionButton
                  tone="accent"
                  onClick={() => {
                    try {
                      const parsed: unknown = JSON.parse(draft);
                      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
                        setDraftError("Payload must be a JSON object.");
                        return;
                      }
                      setPanel("none");
                      onResubmit(parsed as Record<string, unknown>);
                    } catch {
                      setDraftError("Invalid JSON — fix the highlighted payload and try again.");
                    }
                  }}
                >
                  Resubmit payload
                </ActionButton>
                <ActionButton onClick={() => setPanel("none")}>Cancel</ActionButton>
              </div>
            </div>
          ) : null}

          {event.platform === "zapier" && event.eventType === "execution_failed" ? (
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              Zapier has no retry or edit API — Autoreplay retries failed steps automatically, and
              manual replay lives in Zap History.
              {event.canResubmit
                ? " This Zap is webhook-triggered, so corrected data can be re-injected from here."
                : ""}
            </p>
          ) : null}

          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <MetaItem label="Occurred">
              <span title={fullTime(event.occurredAt)}>
                {timeAgo(event.occurredAt)} · {fullTime(event.occurredAt)}
              </span>
            </MetaItem>
            <MetaItem label="Received">
              <span title={fullTime(event.receivedAt)}>
                {timeAgo(event.receivedAt)}
                {lag !== null ? (
                  <span style={{ color: "var(--status-warning)" }}> · {lag}</span>
                ) : null}
              </span>
            </MetaItem>
            <MetaItem label="Source">{event.sourceName}</MetaItem>
            <MetaItem label="Ingest channel">
              {event.ingestChannel === "push" ? "Pushed by platform" : "Caught by sweep"}
            </MetaItem>
            <MetaItem label="Workflow ID">
              <span className="font-mono text-xs">{event.workflowExternalId}</span>
            </MetaItem>
            <MetaItem label="Execution ID">
              {event.executionExternalId !== null ? (
                <span className="font-mono text-xs">{event.executionExternalId}</span>
              ) : (
                "— (nothing executed)"
              )}
            </MetaItem>
            {event.retryExecutionId !== null ? (
              <MetaItem label="Retry execution">
                <span className="font-mono text-xs">{event.retryExecutionId}</span>
              </MetaItem>
            ) : null}
            {event.acknowledgedAt !== null ? (
              <MetaItem label="Acknowledged">{timeAgo(event.acknowledgedAt)}</MetaItem>
            ) : null}
            {event.resolvedAt !== null ? (
              <MetaItem label="Resolved">{timeAgo(event.resolvedAt)}</MetaItem>
            ) : null}
          </dl>

          {event.errorStack !== null ? (
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <h3
                  className="text-xs font-medium uppercase tracking-wide"
                  style={{ color: "var(--ink-muted)" }}
                >
                  Stack trace
                </h3>
                <CopyButton text={event.errorStack} />
              </div>
              <pre
                className="overflow-x-auto rounded-lg border px-3 py-2.5 font-mono text-xs leading-relaxed"
                style={{
                  borderColor: "var(--hairline)",
                  background: "var(--surface-inset)",
                  color: "var(--ink-secondary)",
                }}
              >
                {event.errorStack}
              </pre>
            </div>
          ) : null}

          {event.inputPayload !== null && !event.canResubmit ? (
            <details>
              <summary
                className="cursor-pointer text-xs font-medium uppercase tracking-wide"
                style={{ color: "var(--ink-muted)" }}
              >
                Input payload
              </summary>
              <div className="mt-1.5 flex justify-end">
                <CopyButton text={JSON.stringify(event.inputPayload, null, 2)} label="Copy JSON" />
              </div>
              <pre
                className="mt-1.5 overflow-x-auto rounded-lg border px-3 py-2.5 font-mono text-xs leading-relaxed"
                style={{
                  borderColor: "var(--hairline)",
                  background: "var(--surface-inset)",
                  color: "var(--ink-secondary)",
                }}
              >
                {JSON.stringify(event.inputPayload, null, 2)}
              </pre>
            </details>
          ) : null}

          <details>
            <summary
              className="cursor-pointer text-xs font-medium uppercase tracking-wide"
              style={{ color: "var(--ink-muted)" }}
            >
              Raw payload
            </summary>
            <div className="mt-1.5 flex justify-end">
              <CopyButton text={JSON.stringify(event.rawPayload, null, 2)} label="Copy JSON" />
            </div>
            <pre
              className="mt-1.5 overflow-x-auto rounded-lg border px-3 py-2.5 font-mono text-xs leading-relaxed"
              style={{
                borderColor: "var(--hairline)",
                background: "var(--surface-inset)",
                color: "var(--ink-secondary)",
              }}
            >
              {JSON.stringify(event.rawPayload, null, 2)}
            </pre>
          </details>
        </div>
      </aside>
    </div>
  );
}
