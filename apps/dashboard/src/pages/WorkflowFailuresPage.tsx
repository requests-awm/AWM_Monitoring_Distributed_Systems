import { useCallback, useMemo, useState } from "react";
import {
  WorkflowEventStatus,
  WorkflowPlatform,
  type WorkflowFailureEvent,
  type WorkflowSourceSummary,
} from "@awm/shared";

import { ConnectAppDialog } from "../components/ConnectAppDialog";
import { Toast, type ToastState } from "../components/Toast";
import { ActionButton, PlatformChip } from "../components/WorkflowBadges";
import { WorkflowEventDrawer } from "../components/WorkflowEventDrawer";
import { WorkflowEventsTable } from "../components/WorkflowEventsTable";
import { StatTile } from "../components/StatTile";
import { timeAgo } from "../lib/time";
import { EVENT_STATUS_META, OPEN_STATUSES, PLATFORM_LABEL } from "../lib/workflowMeta";
import { useWorkflowEvents } from "../lib/useWorkflowEvents";
import {
  useWorkflowEventAction,
  type WorkflowEventActionName,
} from "../lib/useWorkflowEventActions";

type View = "attention" | "all";
type PlatformFilter = "all" | WorkflowPlatform;
type StatusFilter = "all" | WorkflowEventStatus;

const DAY_MS = 24 * 60 * 60 * 1000;

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: string;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      style={{
        background: active ? "var(--surface-inset)" : "transparent",
        color: active ? "var(--ink-primary)" : "var(--ink-muted)",
      }}
    >
      {children}
    </button>
  );
}

interface ConnectedAppRow {
  source: WorkflowSourceSummary;
  open: number;
  last24h: number;
  lastReportAt: string | null;
}

function ConnectedApps({
  rows,
  selected,
  onSelect,
}: {
  rows: ConnectedAppRow[];
  selected: string | null;
  onSelect: (name: string | null) => void;
}): JSX.Element {
  return (
    <section className="mb-6 overflow-hidden rounded-xl border" style={{ borderColor: "var(--hairline)" }}>
      <div className="flex items-center justify-between px-4 py-2.5">
        <h2 className="text-sm font-semibold">Connected apps</h2>
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {selected === null
            ? "Click an app to filter the events below"
            : `Showing events from ${selected}`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
              <th className="px-4 py-2 font-medium">App</th>
              <th className="px-4 py-2 font-medium">Platform</th>
              <th className="px-4 py-2 text-right font-medium">Open failures</th>
              <th className="px-4 py-2 text-right font-medium">Failures · 24h</th>
              <th className="px-4 py-2 text-right font-medium">Last report</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ source, open, last24h, lastReportAt }) => {
              const active = selected === source.name;
              return (
                <tr
                  key={source.id}
                  onClick={() => onSelect(active ? null : source.name)}
                  aria-selected={active}
                  className="cursor-pointer border-t transition-colors"
                  style={{
                    borderColor: "var(--hairline)",
                    background: active ? "var(--surface-inset)" : "transparent",
                  }}
                >
                  <td className="px-4 py-2.5">
                    <span className="font-medium">{source.name}</span>
                    {source.sweepEnabled ? (
                      <span className="ml-2 text-xs" style={{ color: "var(--ink-muted)" }}>
                        sweep
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2.5">
                    <PlatformChip platform={source.platform} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    <span style={{ color: open > 0 ? "var(--status-critical)" : "var(--status-good)" }}>
                      {open}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{last24h}</td>
                  <td className="px-4 py-2.5 text-right text-xs tabular-nums" style={{ color: "var(--ink-muted)" }}>
                    {lastReportAt === null ? "nothing reported yet" : timeAgo(lastReportAt)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CenterNote({ text, tone }: { text: string; tone?: "error" }): JSX.Element {
  return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <p
        className="text-sm"
        style={{ color: tone === "error" ? "var(--status-critical)" : "var(--ink-muted)" }}
      >
        {text}
      </p>
    </div>
  );
}

export default function WorkflowFailuresPage(): JSX.Element {
  const query = useWorkflowEvents();

  const [view, setView] = useState<View>("attention");
  const [platform, setPlatform] = useState<PlatformFilter>("all");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  const action = useWorkflowEventAction();

  const notify = useCallback((message: string): void => {
    setToast({ id: Date.now(), message });
  }, []);

  const run = useCallback(
    (id: string, name: WorkflowEventActionName, successMessage: string, body?: unknown): void => {
      action.mutate(
        { id, action: name, body },
        {
          onSuccess: (result) =>
            notify(result.note === null ? successMessage : `${successMessage} · ${result.note}`),
          onError: (error) => notify(`Failed: ${error.message}`),
        },
      );
    },
    [action, notify],
  );

  const events = useMemo<WorkflowFailureEvent[]>(() => {
    const rows = query.data?.events ?? [];
    // Newest arrivals first: receivedAt beats occurredAt so a just-detected
    // failure always tops the list, even when the sweep backfills older ones.
    return [...rows].sort(
      (a, b) =>
        new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime() ||
        new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime(),
    );
  }, [query.data]);

  // Derived client-side so cache patches from actions move the tiles instantly.
  const stats = useMemo(() => {
    const now = Date.now();
    return {
      needsAttention: events.filter((e) => OPEN_STATUSES.includes(e.status)).length,
      failures24h: events.filter((e) => now - new Date(e.occurredAt).getTime() < DAY_MS).length,
      deactivated: events.filter(
        (e) => e.eventType === "workflow_deactivated" && e.status !== "resolved",
      ).length,
      retried: events.filter((e) => e.retryExecutionId !== null).length,
    };
  }, [events]);

  const connectedApps = useMemo<ConnectedAppRow[]>(() => {
    const now = Date.now();
    const rows = (query.data?.sources ?? []).map((source) => {
      const own = events.filter((e) => e.sourceName === source.name);
      const last = own.reduce<string | null>(
        (acc, e) => (acc === null || e.occurredAt > acc ? e.occurredAt : acc),
        null,
      );
      return {
        source,
        open: own.filter((e) => OPEN_STATUSES.includes(e.status)).length,
        last24h: own.filter((e) => now - new Date(e.occurredAt).getTime() < DAY_MS).length,
        lastReportAt: last,
      };
    });
    return rows.sort((a, b) => b.open - a.open || a.source.name.localeCompare(b.source.name));
  }, [query.data, events]);

  const platforms = useMemo<WorkflowPlatform[]>(() => {
    const seen = new Set<WorkflowPlatform>(events.map((e) => e.platform));
    for (const source of query.data?.sources ?? []) seen.add(source.platform);
    return WorkflowPlatform.options.filter((p) => seen.has(p));
  }, [events, query.data]);

  const visibleApps = useMemo(
    () => (platform === "all" ? connectedApps : connectedApps.filter((r) => r.source.platform === platform)),
    [connectedApps, platform],
  );

  const choosePlatform = useCallback(
    (next: PlatformFilter): void => {
      setPlatform(next);
      if (next !== "all" && sourceFilter !== null) {
        const stillVisible = connectedApps.some(
          (r) => r.source.name === sourceFilter && r.source.platform === next,
        );
        if (!stillVisible) setSourceFilter(null);
      }
    },
    [connectedApps, sourceFilter],
  );

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return events.filter((e) => {
      if (view === "attention" && !OPEN_STATUSES.includes(e.status)) return false;
      if (platform !== "all" && e.platform !== platform) return false;
      if (sourceFilter !== null && e.sourceName !== sourceFilter) return false;
      if (view === "all" && status !== "all" && e.status !== status) return false;
      if (
        term !== "" &&
        !`${e.workflowName} ${e.errorMessage} ${e.errorNode ?? ""}`.toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [events, view, platform, sourceFilter, status, search]);

  const selected = events.find((e) => e.id === selectedId) ?? null;

  if (query.isPending) return <CenterNote text="Loading workflow failures…" />;
  if (query.isError) return <CenterNote text="Could not reach the monitoring API." tone="error" />;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Workflow failures</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
            Failed executions across every connected source — pushed by error handlers,
            reconciled by the sweep.
          </p>
        </div>
        <ActionButton tone="accent" onClick={() => setConnectOpen(true)}>
          + Connect app
        </ActionButton>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile
          label="Needs attention"
          value={stats.needsAttention}
          accent={stats.needsAttention > 0 ? "var(--status-critical)" : "var(--status-good)"}
        />
        <StatTile label="Failures · 24h" value={stats.failures24h} muted />
        <StatTile
          label="Workflows turned off"
          value={stats.deactivated}
          accent={stats.deactivated > 0 ? "var(--status-critical)" : "var(--status-good)"}
        />
        <StatTile label="Retried" value={stats.retried} muted />
      </div>


      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div
          className="inline-flex rounded-lg border p-0.5"
          style={{ borderColor: "var(--hairline)" }}
          role="group"
          aria-label="Filter by state"
        >
          <SegmentButton active={view === "attention"} onClick={() => setView("attention")}>
            Needs attention
          </SegmentButton>
          <SegmentButton active={view === "all"} onClick={() => setView("all")}>
            All events
          </SegmentButton>
        </div>

        <div
          className="inline-flex rounded-lg border p-0.5"
          style={{ borderColor: "var(--hairline)" }}
          role="group"
          aria-label="Filter by platform"
        >
          <SegmentButton active={platform === "all"} onClick={() => choosePlatform("all")}>
            All platforms
          </SegmentButton>
          {platforms.map((p) => (
            <SegmentButton key={p} active={platform === p} onClick={() => choosePlatform(p)}>
              {PLATFORM_LABEL[p]}
            </SegmentButton>
          ))}
        </div>

        {view === "all" ? (
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as StatusFilter)}
            aria-label="Filter by status"
            className="rounded-lg border px-2.5 py-1.5 text-xs font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            style={{
              borderColor: "var(--hairline)",
              background: "var(--surface-card)",
              color: "var(--ink-primary)",
            }}
          >
            <option value="all">Any status</option>
            {WorkflowEventStatus.options.map((s) => (
              <option key={s} value={s}>
                {EVENT_STATUS_META[s].label}
              </option>
            ))}
          </select>
        ) : null}

        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search workflow, error, node…"
          aria-label="Search failures"
          className="ml-auto w-72 max-w-full rounded-lg border px-3 py-1.5 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          style={{
            borderColor: "var(--hairline)",
            background: "var(--surface-card)",
            color: "var(--ink-primary)",
          }}
        />
      </div>

      {visibleApps.length > 0 ? (
        <ConnectedApps rows={visibleApps} selected={sourceFilter} onSelect={setSourceFilter} />
      ) : null}

      <WorkflowEventsTable
        events={visible}
        selectedId={selectedId}
        onSelect={setSelectedId}
        emptyText={
          view === "attention" && search === "" && platform === "all"
            ? "Nothing needs attention — all workflow failures are handled."
            : "No failures match these filters."
        }
      />

      {selected !== null ? (
        <WorkflowEventDrawer
          key={selected.id}
          event={selected}
          onClose={() => setSelectedId(null)}
          onAcknowledge={() =>
            run(selected.id, "acknowledge", `Acknowledged “${selected.workflowName}”`)
          }
          onResolve={() => run(selected.id, "resolve", `Resolved “${selected.workflowName}”`)}
          onIgnore={() => run(selected.id, "ignore", `Ignored “${selected.workflowName}”`)}
          onRetry={() =>
            run(selected.id, "retry", `Retry queued in n8n for “${selected.workflowName}”`)
          }
          onAssign={(assignee) =>
            run(
              selected.id,
              "assign",
              assignee === "" ? "Unassigned" : `Assigned to ${assignee}`,
              { assignee: assignee === "" ? null : assignee },
            )
          }
          onSuggestFix={() =>
            run(selected.id, "suggest-fix", `Fix suggestion generated for “${selected.workflowName}”`)
          }
          suggestingFix={
            action.isPending &&
            action.variables?.action === "suggest-fix" &&
            action.variables.id === selected.id
          }
          onApplyFix={() =>
            run(selected.id, "apply-fix", `Fix applied to “${selected.workflowName}” and retry queued`)
          }
          onResubmit={(payload) =>
            run(selected.id, "resubmit", `Payload re-injected into “${selected.workflowName}”`, {
              payload,
            })
          }
        />
      ) : null}

      {connectOpen ? (
        <ConnectAppDialog
          onClose={() => setConnectOpen(false)}
          onConnected={(sourceName) => {
            void query.refetch();
            notify(`Connected “${sourceName}” — copy the token before closing`);
          }}
        />
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
