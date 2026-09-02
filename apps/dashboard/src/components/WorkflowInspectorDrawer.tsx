import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { N8nExecutionSummary, N8nWorkflowInspection } from "@awm/shared";

import { apiGet, apiSend } from "../lib/api";
import { timeAgo } from "../lib/time";
import { ActionButton, ExternalLink } from "./WorkflowBadges";

const STATUS_META: Record<string, { dot: string; label: string }> = {
  success: { dot: "var(--status-good)", label: "Success" },
  error: { dot: "var(--status-critical)", label: "Error" },
  crashed: { dot: "var(--status-critical)", label: "Crashed" },
  waiting: { dot: "var(--status-warning)", label: "Waiting" },
  running: { dot: "var(--accent)", label: "Running" },
  canceled: { dot: "var(--ink-muted)", label: "Canceled" },
};

function ExecutionRow({
  execution,
  onRetried,
}: {
  execution: N8nExecutionSummary;
  onRetried: (message: string) => void;
}): JSX.Element {
  const [retrying, setRetrying] = useState(false);
  const meta = STATUS_META[execution.status] ?? { dot: "var(--ink-muted)", label: execution.status };
  const failed = execution.status === "error" || execution.status === "crashed";

  const retry = (): void => {
    setRetrying(true);
    apiSend<{ retryExecutionId: string }>(
      `/api/n8n/executions/${encodeURIComponent(execution.id)}/retry`,
      "POST",
      {},
    )
      .then((r) =>
        onRetried(
          r.retryExecutionId === ""
            ? "Retry started on n8n"
            : `Retry started on n8n — new execution #${r.retryExecutionId}`,
        ),
      )
      .catch((e: Error) => onRetried(`Retry failed: ${e.message}`))
      .finally(() => setRetrying(false));
  };

  return (
    <li className="border-t px-4 py-2.5" style={{ borderColor: "var(--hairline)" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium">
          <span aria-hidden style={{ color: meta.dot }}>●</span>
          {meta.label}
        </span>
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          #{execution.id} · {execution.mode}
          {execution.startedAt !== null ? ` · ${timeAgo(execution.startedAt)}` : ""}
          {execution.durationMs !== null ? ` · ${(execution.durationMs / 1000).toFixed(2)}s` : ""}
        </span>
        <span className="ml-auto inline-flex items-center gap-2">
          {failed ? (
            <ActionButton tone="accent" disabled={retrying} onClick={retry}>
              {retrying ? "Retrying…" : "Retry"}
            </ActionButton>
          ) : null}
          <ExternalLink href={execution.url}>Open</ExternalLink>
        </span>
      </div>
      {execution.errorMessage !== null ? (
        <div
          className="mt-1.5 rounded-md px-2.5 py-1.5 text-xs"
          style={{ background: "var(--surface-inset)", color: "var(--ink-secondary)" }}
        >
          {execution.errorNode !== null ? (
            <span className="font-semibold" style={{ color: "var(--status-critical)" }}>
              {execution.errorNode}:{" "}
            </span>
          ) : null}
          {execution.errorMessage}
        </div>
      ) : null}
    </li>
  );
}

/**
 * Slide-over troubleshooting view for one n8n workflow: recent executions with
 * error details on failures, per-node failure tally, and one-click retry —
 * everything short of editing the workflow, without leaving the dashboard.
 */
export function WorkflowInspectorDrawer({
  workflowId,
  onClose,
  onToast,
}: {
  workflowId: string;
  onClose: () => void;
  onToast: (message: string) => void;
}): JSX.Element {
  const query = useQuery({
    queryKey: ["n8n-inspect", workflowId],
    queryFn: () => apiGet<N8nWorkflowInspection>(`/api/n8n/workflows/${encodeURIComponent(workflowId)}/inspect`),
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const d = query.data;
  const failingNodes =
    d === undefined
      ? []
      : Object.entries(d.nodeFailureCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Workflow inspector">
      <button
        type="button"
        aria-label="Close inspector"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "rgba(15, 23, 42, 0.45)" }}
      />
      <aside
        className="relative flex h-full w-full max-w-[560px] flex-col overflow-y-auto shadow-xl"
        style={{ background: "var(--surface-card)" }}
      >
        <header className="sticky top-0 border-b px-5 py-4" style={{ borderColor: "var(--hairline)", background: "var(--surface-card)" }}>
          <div className="flex items-start gap-3">
            <div className="min-w-0">
              <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                Workflow inspector
              </div>
              <h2 className="truncate text-base font-semibold">{d?.name ?? workflowId}</h2>
              {d !== undefined ? (
                <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>
                  <span className="inline-flex items-center gap-1 font-medium" style={{ color: d.active ? "var(--status-good)" : "var(--ink-muted)" }}>
                    {d.active ? "● Active" : "○ Inactive"}
                  </span>
                  <span>{d.nodes.length} nodes</span>
                  <ExternalLink href={d.editorUrl}>Open in n8n</ExternalLink>
                </div>
              ) : null}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="ml-auto rounded-md px-2 py-1 text-sm font-medium hover:bg-[var(--surface-inset)]"
              style={{ color: "var(--ink-muted)" }}
            >
              ✕
            </button>
          </div>
        </header>

        {query.isPending ? (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--ink-muted)" }}>Loading executions from n8n…</p>
        ) : null}
        {query.isError ? (
          <p className="px-5 py-6 text-sm" style={{ color: "var(--status-critical)" }}>
            Could not inspect this workflow — {query.error.message}
          </p>
        ) : null}

        {d !== undefined ? (
          <>
            {failingNodes.length > 0 ? (
              <section className="border-b px-5 py-3" style={{ borderColor: "var(--hairline)" }}>
                <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                  Failing nodes (recent failures)
                </h3>
                <ul className="flex flex-wrap gap-1.5">
                  {failingNodes.map(([node, count]) => (
                    <li
                      key={node}
                      className="rounded-md px-2 py-1 text-xs font-medium"
                      style={{ background: "var(--surface-inset)", color: "var(--status-critical)" }}
                    >
                      {node} × {count}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            <section>
              <h3 className="px-5 pb-1 pt-3 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                Recent executions ({d.executions.length})
              </h3>
              {d.executions.length === 0 ? (
                <p className="px-5 py-4 text-sm" style={{ color: "var(--ink-muted)" }}>
                  No recorded executions for this workflow.
                </p>
              ) : (
                <ul>
                  {d.executions.map((execution) => (
                    <ExecutionRow key={execution.id} execution={execution} onRetried={onToast} />
                  ))}
                </ul>
              )}
            </section>

            <section className="border-t px-5 py-3" style={{ borderColor: "var(--hairline)" }}>
              <details>
                <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                  Nodes in this workflow ({d.nodes.length})
                </summary>
                <ul className="mt-2 space-y-1 text-xs" style={{ color: "var(--ink-secondary)" }}>
                  {d.nodes.map((n) => (
                    <li key={n.name} className="flex items-baseline gap-2">
                      <span className="font-medium" style={{ color: "var(--ink-primary)" }}>{n.name}</span>
                      <span style={{ color: "var(--ink-muted)" }}>{n.type}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
          </>
        ) : null}
      </aside>
    </div>
  );
}
