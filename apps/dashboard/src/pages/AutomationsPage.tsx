import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  AutomationInventoryResponse,
  N8nInsightsDay,
  N8nInsightsResponse,
  N8nWorkflowToggleResult,
  WorkflowPlatform,
} from "@awm/shared";

import { Toast, type ToastState } from "../components/Toast";
import { ActionButton, ExternalLink, PlatformChip } from "../components/WorkflowBadges";
import { WorkflowInspectorDrawer } from "../components/WorkflowInspectorDrawer";
import { apiGet, apiSend } from "../lib/api";
import { timeAgo } from "../lib/time";

type PlatformFilter = "all" | WorkflowPlatform;

// ---------------------------------------------------------------------------
// n8n execution overview (n8n-style Insights, computed from the executions API)
// ---------------------------------------------------------------------------

function pctDelta(current: number, previous: number): number | null {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function InsightTile({
  label,
  value,
  unit,
  delta,
  deltaUnit,
  higherIsBad,
  note,
}: {
  label: string;
  value: string;
  unit?: string;
  delta?: number | null;
  deltaUnit?: string;
  higherIsBad?: boolean;
  note?: string;
}): JSX.Element {
  let deltaEl: JSX.Element | null = null;
  if (delta !== undefined) {
    if (delta === null || Math.abs(delta) < 0.05) {
      deltaEl = (
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {delta === null ? "no prior data" : "no change"}
        </span>
      );
    } else {
      const up = delta > 0;
      const bad = higherIsBad === true ? up : false;
      deltaEl = (
        <span
          className="text-xs font-medium tabular-nums"
          style={{ color: bad ? "var(--status-critical)" : higherIsBad === true ? "var(--status-good)" : "var(--ink-secondary)" }}
        >
          <span aria-hidden>{up ? "▲" : "▼"} </span>
          {Math.abs(delta).toFixed(1)}
          {deltaUnit ?? "%"}
        </span>
      );
    }
  }
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tabular-nums">{value}</span>
        {unit !== undefined ? (
          <span className="text-sm" style={{ color: "var(--ink-muted)" }}>{unit}</span>
        ) : null}
        <span className="ml-auto" />
        {deltaEl}
      </div>
      {note !== undefined ? (
        <div className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>{note}</div>
      ) : null}
    </div>
  );
}

function DayBreakdown({ days }: { days: N8nInsightsDay[] }): JSX.Element {
  const max = Math.max(1, ...days.map((d) => d.total));
  const labelEvery = Math.max(1, Math.ceil(days.length / 8));
  return (
    <div>
      <div className="mb-2 flex items-center gap-4 text-xs" style={{ color: "var(--ink-secondary)" }}>
        <span className="font-semibold" style={{ color: "var(--ink-primary)" }}>Breakdown by day</span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--accent)" }} />
          Succeeded
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: "var(--status-critical)" }} />
          Failed
        </span>
      </div>
      <div className="flex items-end gap-[3px]" style={{ height: 120 }} role="img" aria-label="Executions per day, failed highlighted">
        {days.map((d) => {
          const succeeded = d.total - d.failed;
          const totalPx = Math.round((d.total / max) * 112);
          const failedPx = d.total === 0 ? 0 : Math.max(d.failed > 0 ? 2 : 0, Math.round((d.failed / max) * 112));
          const succeededPx = Math.max(succeeded > 0 ? 2 : 0, totalPx - failedPx);
          const label = `${d.date} · ${d.total} execution${d.total === 1 ? "" : "s"} · ${d.failed} failed${d.avgRunMs !== null ? ` · avg ${(d.avgRunMs / 1000).toFixed(2)}s` : ""}`;
          return (
            <div key={d.date} className="flex min-w-0 flex-1 flex-col items-stretch justify-end" title={label}>
              {succeeded > 0 ? (
                <div style={{ height: succeededPx, background: "var(--accent)", borderRadius: "3px 3px 0 0" }} />
              ) : null}
              {d.failed > 0 ? (
                <div
                  style={{
                    height: failedPx,
                    background: "var(--status-critical)",
                    marginTop: succeeded > 0 ? 2 : 0,
                    borderRadius: succeeded > 0 ? 0 : "3px 3px 0 0",
                  }}
                />
              ) : null}
              {d.total === 0 ? (
                <div style={{ height: 2, background: "var(--surface-inset)" }} />
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="mt-1 flex gap-[3px] text-[10px] tabular-nums" style={{ color: "var(--ink-muted)" }}>
        {days.map((d, i) => (
          <div key={d.date} className="min-w-0 flex-1 truncate text-center">
            {i % labelEvery === 0 ? d.date.slice(5) : ""}
          </div>
        ))}
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
          Data table
        </summary>
        <div className="mt-1.5 overflow-x-auto">
          <table className="w-full text-xs tabular-nums">
            <thead>
              <tr className="text-left uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                <th className="py-1 pr-4 font-medium">Date</th>
                <th className="py-1 pr-4 text-right font-medium">Executions</th>
                <th className="py-1 pr-4 text-right font-medium">Failed</th>
                <th className="py-1 text-right font-medium">Avg run</th>
              </tr>
            </thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.date} className="border-t" style={{ borderColor: "var(--hairline)" }}>
                  <td className="py-1 pr-4">{d.date}</td>
                  <td className="py-1 pr-4 text-right">{d.total}</td>
                  <td className="py-1 pr-4 text-right" style={{ color: d.failed > 0 ? "var(--status-critical)" : undefined }}>{d.failed}</td>
                  <td className="py-1 text-right">{d.avgRunMs === null ? "—" : `${(d.avgRunMs / 1000).toFixed(2)}s`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function N8nExecutionOverview(): JSX.Element {
  const [days, setDays] = useState<7 | 30>(7);
  const query = useQuery({
    queryKey: ["n8n-insights", days],
    queryFn: () => apiGet<N8nInsightsResponse>(`/api/n8n/insights?days=${days}`),
    refetchInterval: 5 * 60_000,
  });

  if (query.isError) {
    return (
      <p className="mb-6 text-xs" style={{ color: "var(--ink-muted)" }}>
        n8n execution overview unavailable — {query.error.message}
      </p>
    );
  }

  const d = query.data;
  return (
    <section className="mb-8">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <h2 className="text-sm font-semibold">n8n execution overview</h2>
        <div className="inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--hairline)" }} role="group" aria-label="Overview range">
          {([7, 30] as const).map((w) => (
            <button
              key={w}
              type="button"
              onClick={() => setDays(w)}
              aria-pressed={days === w}
              className="rounded-md px-3 py-1 text-xs font-medium"
              style={{ background: days === w ? "var(--surface-inset)" : "transparent", color: days === w ? "var(--ink-primary)" : "var(--ink-muted)" }}
            >
              Last {w} days
            </button>
          ))}
        </div>
        {d?.truncated === true ? (
          <span className="text-xs" style={{ color: "var(--status-warning)" }}>
            based on the most recent {d.sampleSize.toLocaleString()} executions — older history not fetched
          </span>
        ) : null}
      </div>
      {d === undefined ? (
        <p className="text-xs" style={{ color: "var(--ink-muted)" }}>Loading execution data…</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <InsightTile
              label="Prod. executions"
              value={d.current.prodExecutions.toLocaleString()}
              delta={pctDelta(d.current.prodExecutions, d.previous.prodExecutions)}
            />
            <InsightTile
              label="Failed prod. executions"
              value={d.current.failedExecutions.toLocaleString()}
              delta={pctDelta(d.current.failedExecutions, d.previous.failedExecutions)}
              higherIsBad
            />
            <InsightTile
              label="Failure rate"
              value={d.current.failureRatePct === null ? "—" : d.current.failureRatePct.toFixed(1)}
              unit="%"
              delta={
                d.current.failureRatePct === null || d.previous.failureRatePct === null
                  ? null
                  : d.current.failureRatePct - d.previous.failureRatePct
              }
              deltaUnit="pp"
              higherIsBad
            />
            <InsightTile label="Time saved" value="—" note="not exposed by n8n's public API" />
            <InsightTile
              label="Run time (avg.)"
              value={d.current.avgRunMs === null ? "—" : (d.current.avgRunMs / 1000).toFixed(2)}
              unit="s"
              delta={
                d.current.avgRunMs === null || d.previous.avgRunMs === null
                  ? null
                  : pctDelta(d.current.avgRunMs, d.previous.avgRunMs)
              }
              higherIsBad
            />
          </div>
          <div className="card px-4 py-3">
            <DayBreakdown days={d.byDay} />
          </div>
        </>
      )}
    </section>
  );
}

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
  const [inspectId, setInspectId] = useState<string | null>(null);

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

      <N8nExecutionOverview />

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
                      <>
                        <ActionButton
                          tone={r.recentFailures > 0 ? "accent" : "default"}
                          onClick={() => setInspectId(r.externalId)}
                        >
                          Inspect
                        </ActionButton>{" "}
                        <ActionButton
                          tone={r.active ? "default" : "accent"}
                          disabled={togglingId === r.externalId}
                          onClick={() => toggleN8n(r.externalId, r.name, !r.active)}
                        >
                          {togglingId === r.externalId ? "…" : r.active ? "Turn off" : "Turn on"}
                        </ActionButton>
                      </>
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

      {inspectId !== null ? (
        <WorkflowInspectorDrawer
          workflowId={inspectId}
          onClose={() => setInspectId(null)}
          onToast={(message) => setToast({ id: Date.now(), message })}
        />
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
