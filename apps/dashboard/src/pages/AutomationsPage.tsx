import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AutomationInventoryResponse,
  N8nWorkflowToggleResult,
  WorkflowPlatform,
} from "@awm/shared";

import { Toast, type ToastState } from "../components/Toast";
import { ActionButton, ExternalLink, PlatformChip } from "../components/WorkflowBadges";
import { apiGet, apiSend } from "../lib/api";
import { timeAgo } from "../lib/time";

type PlatformFilter = "all" | WorkflowPlatform;

export default function AutomationsPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["automations"],
    queryFn: () => apiGet<AutomationInventoryResponse>("/api/automations"),
    refetchInterval: 60_000,
  });
  const queryClient = useQueryClient();
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const toggleN8n = (workflowId: string, name: string, active: boolean): void => {
    if (!active && !window.confirm(`Turn OFF “${name}” on n8n? It will stop running until switched back on.`)) {
      return;
    }
    setTogglingId(workflowId);
    apiSend<N8nWorkflowToggleResult>(`/api/automations/n8n/${encodeURIComponent(workflowId)}/toggle`, "POST", {
      active,
    })
      .then((r) => {
        setToast({ id: Date.now(), message: `“${name}” turned ${r.active ? "on" : "off"} on n8n` });
        void queryClient.invalidateQueries({ queryKey: ["automations"] });
      })
      .catch((e: Error) => setToast({ id: Date.now(), message: `Failed: ${e.message}` }))
      .finally(() => setTogglingId(null));
  };

  const rows = useMemo(() => {
    const all = query.data?.rows ?? [];
    const term = search.trim().toLowerCase();
    return all.filter((r) => {
      if (platform !== "all" && r.platform !== platform) return false;
      if (problemsOnly && !(r.recentFailures > 0 || (r.active && r.hasErrorHandler === false) || !r.active)) {
        return false;
      }
      if (term !== "" && !r.name.toLowerCase().includes(term)) return false;
      return true;
    });
  }, [query.data, platform, problemsOnly, search]);

  const platforms = useMemo(() => {
    const seen = new Set((query.data?.rows ?? []).map((r) => r.platform));
    return [...seen];
  }, [query.data]);

  if (query.isPending) {
    return <p className="px-6 py-10 text-sm" style={{ color: "var(--ink-muted)" }}>Loading automations…</p>;
  }
  if (query.isError) {
    return <p className="px-6 py-10 text-sm" style={{ color: "var(--status-critical)" }}>Could not reach the monitoring API.</p>;
  }

  const data = query.data;
  const active = rows.filter((r) => r.active).length;
  const uncovered = rows.filter((r) => r.active && r.hasErrorHandler === false).length;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <header className="mb-5">
        <h1 className="text-lg font-semibold">Automations</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
          Every workflow and Zap across connected sources — state, error-handler coverage, and recent failures.
        </p>
        {data.notes.map((note) => (
          <p key={note} className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
            {note}
          </p>
        ))}
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--hairline)" }} role="group" aria-label="Filter by platform">
          <button
            type="button"
            onClick={() => setPlatform("all")}
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ background: platform === "all" ? "var(--surface-inset)" : "transparent", color: platform === "all" ? "var(--ink-primary)" : "var(--ink-muted)" }}
          >
            All ({(data.rows ?? []).length})
          </button>
          {platforms.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPlatform(p)}
              className="rounded-md px-3 py-1.5 text-xs font-medium"
              style={{ background: platform === p ? "var(--surface-inset)" : "transparent", color: platform === p ? "var(--ink-primary)" : "var(--ink-muted)" }}
            >
              {p === "n8n" ? "n8n" : p === "zapier" ? "Zapier" : p}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-xs font-medium" style={{ color: "var(--ink-secondary)" }}>
          <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} />
          Problems only (failing, off, or no error handler)
        </label>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search automations…"
          aria-label="Search automations"
          className="ml-auto w-72 max-w-full rounded-lg border px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          style={{ borderColor: "var(--hairline)", background: "var(--surface-card)", color: "var(--ink-primary)" }}
        />
      </div>

      <p className="mb-3 text-xs" style={{ color: "var(--ink-muted)" }}>
        Showing {rows.length} · {active} switched on
        {uncovered > 0 ? (
          <span style={{ color: "var(--status-warning)" }}> · {uncovered} active without an error handler</span>
        ) : null}
      </p>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                <th className="px-4 py-2.5 font-medium">Automation</th>
                <th className="px-4 py-2.5 font-medium">Platform</th>
                <th className="px-4 py-2.5 font-medium">State</th>
                <th className="px-4 py-2.5 font-medium">Error handler</th>
                <th className="px-4 py-2.5 text-right font-medium">Failures</th>
                <th className="px-4 py-2.5 text-right font-medium">Last failure</th>
                <th className="px-4 py-2.5 text-right font-medium">Links</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.platform}-${r.externalId}`} className="border-t" style={{ borderColor: "var(--hairline)" }}>
                  <td className="max-w-[420px] px-4 py-2.5">
                    <div className="truncate font-medium">{r.name}</div>
                    {r.lastEditedBy !== null ? (
                      <div className="truncate text-xs" style={{ color: "var(--ink-muted)" }}>
                        last edited by {r.lastEditedBy}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5"><PlatformChip platform={r.platform} /></td>
                  <td className="px-4 py-2.5">
                    <span className="inline-flex items-center gap-1.5 font-medium">
                      <span aria-hidden style={{ color: r.active ? "var(--status-good)" : "var(--ink-muted)" }}>
                        {r.active ? "●" : "○"}
                      </span>
                      {r.stateLabel}
                    </span>
                  </td>
                  <td className="px-4 py-2.5">
                    {r.hasErrorHandler === null ? (
                      <span style={{ color: "var(--ink-muted)" }}>—</span>
                    ) : r.hasErrorHandler ? (
                      <span style={{ color: "var(--status-good)" }}>✓ attached</span>
                    ) : (
                      <span className="font-medium" style={{ color: r.active ? "var(--status-warning)" : "var(--ink-muted)" }}>
                        ▲ none{r.active ? " — failures are silent" : ""}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span style={{ color: r.recentFailures > 0 ? "var(--status-critical)" : "var(--ink-primary)" }}>
                      {r.recentFailures}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums" style={{ color: "var(--ink-muted)" }}>
                    {r.lastFailureAt === null ? "—" : timeAgo(r.lastFailureAt)}
                  </td>
                  <td className="whitespace-nowrap px-4 py-2.5 text-right">
                    {r.platform === "n8n" ? (
                      <ActionButton
                        tone={r.active ? "default" : "accent"}
                        disabled={togglingId === r.externalId}
                        onClick={() => toggleN8n(r.externalId, r.name, !r.active)}
                      >
                        {togglingId === r.externalId ? "…" : r.active ? "Turn off" : "Turn on"}
                      </ActionButton>
                    ) : null}{" "}
                    {r.editorUrl !== null ? <ExternalLink href={r.editorUrl}>Editor</ExternalLink> : null}{" "}
                    {r.historyUrl !== null ? <ExternalLink href={r.historyUrl}>History</ExternalLink> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
