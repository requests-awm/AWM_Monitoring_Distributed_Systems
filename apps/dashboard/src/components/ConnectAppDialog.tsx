import { useEffect, useRef, useState } from "react";
import type { WorkflowPlatform, WorkflowSourceCreateResult } from "@awm/shared";

import { apiSend } from "../lib/api";
import { ActionButton } from "./WorkflowBadges";

const PLATFORM_OPTIONS: { value: WorkflowPlatform; label: string }[] = [
  { value: "custom_app", label: "Custom app / script" },
  { value: "make", label: "Make.com" },
  { value: "n8n", label: "n8n (additional instance)" },
  { value: "zapier", label: "Zapier (additional account)" },
  { value: "other", label: "Other platform" },
];

function curlSnippet(token: string, platform: WorkflowPlatform): string {
  const origin = window.location.origin;
  return [
    `curl -X POST ${origin}/api/ingest/workflow-events \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{`,
    `    "platform": "${platform}",`,
    `    "event_type": "execution_failed",`,
    `    "workflow": { "external_id": "my-job", "name": "My Job" },`,
    `    "error": { "message": "what went wrong", "node": "step name" },`,
    `    "occurred_at": "'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'"`,
    `  }'`,
  ].join("\n");
}

function jsSnippet(token: string, platform: WorkflowPlatform): string {
  const origin = window.location.origin;
  return [
    `// call this from your job's catch block`,
    `await fetch("${origin}/api/ingest/workflow-events", {`,
    `  method: "POST",`,
    `  headers: {`,
    `    Authorization: "Bearer ${token}",`,
    `    "Content-Type": "application/json",`,
    `  },`,
    `  body: JSON.stringify({`,
    `    platform: "${platform}",`,
    `    event_type: "execution_failed",`,
    `    workflow: { external_id: "my-job", name: "My Job" },`,
    `    error: { message: error.message, stack: error.stack ?? null },`,
    `    occurred_at: new Date().toISOString(),`,
    `  }),`,
    `});`,
  ].join("\n");
}

function SnippetBlock({ label, text }: { label: string; text: string }): JSX.Element {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span
          className="text-xs font-medium uppercase tracking-wide"
          style={{ color: "var(--ink-muted)" }}
        >
          {label}
        </span>
        <ActionButton
          onClick={() => {
            navigator.clipboard
              .writeText(text)
              .then(() => setCopied(true))
              .catch(() => setCopied(false));
          }}
        >
          {copied ? "Copied" : "Copy"}
        </ActionButton>
      </div>
      <pre
        className="overflow-x-auto rounded-lg border px-3 py-2.5 font-mono text-xs leading-relaxed"
        style={{
          borderColor: "var(--hairline)",
          background: "var(--surface-inset)",
          color: "var(--ink-secondary)",
        }}
      >
        {text}
      </pre>
    </div>
  );
}

export function ConnectAppDialog({
  onClose,
  onConnected,
}: {
  onClose: () => void;
  onConnected: (sourceName: string) => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [platform, setPlatform] = useState<WorkflowPlatform>("custom_app");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<WorkflowSourceCreateResult | null>(null);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    firstFieldRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const submit = (): void => {
    if (name.trim().length < 2) {
      setError("Give the app a name (at least 2 characters).");
      return;
    }
    setSubmitting(true);
    setError(null);
    apiSend<WorkflowSourceCreateResult>("/api/workflow-sources", "POST", {
      name: name.trim(),
      platform,
    })
      .then((r) => {
        setResult(r);
        onConnected(r.source.name);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSubmitting(false));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0, 0, 0, 0.35)" }}
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Connect an app"
        className="relative max-h-[85vh] w-[640px] max-w-full overflow-y-auto rounded-xl border p-6"
        style={{ background: "var(--surface-card)", borderColor: "var(--hairline)" }}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold">Connect an app</h2>
            <p className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
              Anything that can make an HTTP POST can report failures to this inbox.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md px-2 py-1 text-sm transition-colors hover:bg-[var(--surface-inset)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            style={{ color: "var(--ink-muted)" }}
          >
            ✕
          </button>
        </div>

        {result === null ? (
          <div className="mt-4 flex flex-col gap-4">
            <label className="flex flex-col gap-1 text-sm font-medium">
              App name
              <input
                ref={firstFieldRef}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lead Portal Jobs"
                className="rounded-lg border px-3 py-2 text-sm font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                style={{
                  borderColor: "var(--hairline)",
                  background: "var(--surface-card)",
                  color: "var(--ink-primary)",
                }}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Platform
              <select
                value={platform}
                onChange={(e) => setPlatform(e.target.value as WorkflowPlatform)}
                className="rounded-lg border px-3 py-2 text-sm font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                style={{
                  borderColor: "var(--hairline)",
                  background: "var(--surface-card)",
                  color: "var(--ink-primary)",
                }}
              >
                {PLATFORM_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {error !== null ? (
              <p className="text-sm" style={{ color: "var(--status-critical)" }}>
                {error}
              </p>
            ) : null}
            <div className="flex gap-2">
              <ActionButton tone="accent" onClick={submit} disabled={submitting}>
                {submitting ? "Connecting…" : "Connect & get token"}
              </ActionButton>
              <ActionButton onClick={onClose}>Cancel</ActionButton>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-sm">
              <strong>{result.source.name}</strong> is connected. This token is shown{" "}
              <strong>once</strong> — only its hash is stored, so copy it into the app's secrets
              now.
            </p>
            <SnippetBlock label="Ingest token" text={result.ingestToken} />
            <SnippetBlock label="curl — test it now" text={curlSnippet(result.ingestToken, result.source.platform)} />
            <SnippetBlock label="JavaScript — drop into the app's error handler" text={jsSnippet(result.ingestToken, result.source.platform)} />
            <p className="text-xs" style={{ color: "var(--ink-muted)" }}>
              Duplicate sends are safe — the endpoint is idempotent per execution. For jobs that
              can fail silently, pair this with a heartbeat monitor once M4 lands.
              {result.note !== null ? ` ${result.note}.` : ""}
            </p>
            <div>
              <ActionButton tone="accent" onClick={onClose}>
                Done
              </ActionButton>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
