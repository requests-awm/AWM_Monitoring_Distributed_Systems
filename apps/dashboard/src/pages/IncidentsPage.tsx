import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { IncidentDetailResponse, IncidentDto, IncidentStatus } from "@awm/shared";

import { Toast, type ToastState } from "../components/Toast";
import { ActionButton } from "../components/WorkflowBadges";
import { SeverityBadge } from "../components/StatusBadge";
import { apiGet, apiSend } from "../lib/api";
import { timeAgo } from "../lib/time";
import { ASSIGNEES } from "../lib/workflowMeta";

const STATUS_META: Record<IncidentStatus, { label: string; color: string; symbol: string }> = {
  open: { label: "Open", color: "var(--status-critical)", symbol: "■" },
  acknowledged: { label: "Acknowledged", color: "var(--status-warning)", symbol: "▲" },
  investigating: { label: "Investigating", color: "var(--status-serious)", symbol: "◆" },
  resolved: { label: "Resolved", color: "var(--status-good)", symbol: "●" },
  muted: { label: "Muted", color: "var(--ink-muted)", symbol: "●" },
};

function IncidentDrawer({
  id,
  onClose,
  onAction,
}: {
  id: string;
  onClose: () => void;
  onAction: (message: string) => void;
}): JSX.Element {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ["incident", id],
    queryFn: () => apiGet<IncidentDetailResponse>(`/api/incidents/${id}`),
    refetchInterval: 10_000,
  });
  const [note, setNote] = useState("");
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = (path: string, message: string, body?: unknown): void => {
    apiSend(`/api/incidents/${id}${path}`, "POST", body)
      .then(() => {
        onAction(message);
        void queryClient.invalidateQueries({ queryKey: ["incidents"] });
        void queryClient.invalidateQueries({ queryKey: ["incident", id] });
      })
      .catch((e: Error) => onAction(`Failed: ${e.message}`));
  };

  const incident = query.data?.incident;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Incident details"
        className="absolute right-0 top-0 flex h-full w-[540px] max-w-full flex-col overflow-y-auto border-l"
        style={{ background: "var(--surface-card)", borderColor: "var(--hairline)" }}
      >
        <header className="sticky top-0 border-b px-5 py-4" style={{ background: "var(--surface-card)", borderColor: "var(--hairline)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {incident !== undefined ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <SeverityBadge severity={incident.severity} />
                    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                      <span aria-hidden style={{ color: STATUS_META[incident.status].color }}>
                        {STATUS_META[incident.status].symbol}
                      </span>
                      {STATUS_META[incident.status].label}
                    </span>
                    <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      ×{incident.occurrenceCount}
                    </span>
                  </div>
                  <h2 className="mt-1.5 text-base font-semibold">{incident.title}</h2>
                  <p className="mt-0.5 text-xs" style={{ color: "var(--ink-muted)" }}>
                    {incident.projectName} / {incident.environmentName} · started {timeAgo(incident.startedAt)}
                  </p>
                </>
              ) : (
                <h2 className="text-base font-semibold">Loading…</h2>
              )}
            </div>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              aria-label="Close details"
              className="rounded-md px-2 py-1 text-sm hover:bg-[var(--surface-inset)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              style={{ color: "var(--ink-muted)" }}
            >
              ✕
            </button>
          </div>
        </header>
        {incident !== undefined ? (
          <div className="flex flex-col gap-5 px-5 py-4">
            {incident.failureReason !== null ? (
              <div className="rounded-lg border px-4 py-3 text-sm" style={{ borderColor: "var(--hairline)", background: "var(--surface-inset)" }}>
                <span style={{ color: "var(--status-critical)" }}>{incident.failureReason}</span>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <ActionButton
                tone="accent"
                onClick={() => act("/acknowledge", "Incident acknowledged")}
                disabled={incident.acknowledgedAt !== null || incident.status === "resolved"}
              >
                Acknowledge
              </ActionButton>
              <ActionButton onClick={() => act("/resolve", "Incident resolved")} disabled={incident.status === "resolved"}>
                Resolve
              </ActionButton>
              <ActionButton onClick={() => act("/mute", "Incident muted")} disabled={incident.status === "muted" || incident.status === "resolved"}>
                Mute
              </ActionButton>
              <label className="ml-auto flex items-center gap-1.5 text-xs" style={{ color: "var(--ink-muted)" }}>
                Assignee
                <select
                  value={incident.assignee ?? ""}
                  onChange={(e) =>
                    act("/assign", e.target.value === "" ? "Unassigned" : `Assigned to ${e.target.value}`, {
                      assignee: e.target.value === "" ? null : e.target.value,
                    })
                  }
                  className="rounded-md border px-2 py-1.5 text-xs font-medium"
                  style={{ borderColor: "var(--hairline)", background: "var(--surface-card)", color: "var(--ink-primary)" }}
                >
                  <option value="">Unassigned</option>
                  {ASSIGNEES.map((name) => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
              </label>
            </div>

            <div className="flex gap-2">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note to the timeline…"
                className="flex-1 rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--hairline)", background: "var(--surface-card)", color: "var(--ink-primary)" }}
              />
              <ActionButton
                onClick={() => {
                  if (note.trim() !== "") {
                    act("/notes", "Note added", { message: note.trim() });
                    setNote("");
                  }
                }}
              >
                Add note
              </ActionButton>
            </div>

            <div>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                Timeline
              </h3>
              <ul className="flex flex-col gap-2">
                {(query.data?.events ?? []).map((e) => (
                  <li key={e.id} className="flex gap-2 text-sm">
                    <span className="w-16 shrink-0 text-xs tabular-nums" style={{ color: "var(--ink-muted)" }} title={e.createdAt}>
                      {timeAgo(e.createdAt)}
                    </span>
                    <div className="min-w-0">
                      <span className="font-medium">{e.eventType.replace(/_/g, " ")}</span>
                      {e.actor !== null ? <span style={{ color: "var(--ink-muted)" }}> · {e.actor}</span> : null}
                      {e.message !== null ? (
                        <div className="text-xs" style={{ color: "var(--ink-secondary)" }}>{e.message}</div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

export default function IncidentsPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["incidents"],
    queryFn: () => apiGet<IncidentDto[]>("/api/incidents"),
    refetchInterval: 15_000,
  });
  const [view, setView] = useState<"open" | "all">("open");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const incidents = useMemo(() => {
    const rows = query.data ?? [];
    return view === "open" ? rows.filter((i) => i.status !== "resolved" && i.status !== "muted") : rows;
  }, [query.data, view]);

  if (query.isPending) {
    return <p className="px-6 py-10 text-sm" style={{ color: "var(--ink-muted)" }}>Loading incidents…</p>;
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <header className="mb-5">
        <h1 className="text-lg font-semibold">Incidents</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
          One outage, one incident — deduplicated, auto-resolved on recovery, escalation stops on acknowledge.
        </p>
      </header>

      <div className="mb-4 inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--hairline)" }} role="group" aria-label="Filter incidents">
        {(["open", "all"] as const).map((v) => (
          <button
            key={v}
            type="button"
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ background: view === v ? "var(--surface-inset)" : "transparent", color: view === v ? "var(--ink-primary)" : "var(--ink-muted)" }}
          >
            {v === "open" ? "Open" : "All incidents"}
          </button>
        ))}
      </div>

      {incidents.length === 0 ? (
        <section className="card px-4 py-10 text-center">
          <p className="text-sm font-medium" style={{ color: "var(--status-good)" }}>
            <span aria-hidden>● </span>No {view === "open" ? "open " : ""}incidents.
          </p>
        </section>
      ) : (
        <section className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                  <th className="px-4 py-2.5 font-medium">Incident</th>
                  <th className="px-4 py-2.5 font-medium">Severity</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 text-right font-medium">Occurrences</th>
                  <th className="px-4 py-2.5 font-medium">Assignee</th>
                  <th className="px-4 py-2.5 text-right font-medium">Started</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((i) => (
                  <tr
                    key={i.id}
                    tabIndex={0}
                    onClick={() => setSelectedId(i.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        setSelectedId(i.id);
                      }
                    }}
                    className="cursor-pointer border-t hover:bg-[var(--surface-inset)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
                    style={{ borderColor: "var(--hairline)" }}
                  >
                    <td className="max-w-[420px] px-4 py-2.5">
                      <div className="truncate font-medium">{i.title}</div>
                      <div className="truncate text-xs" style={{ color: "var(--ink-muted)" }}>
                        {i.projectName} / {i.environmentName} · {i.failureReason ?? ""}
                      </div>
                    </td>
                    <td className="px-4 py-2.5"><SeverityBadge severity={i.severity} /></td>
                    <td className="px-4 py-2.5">
                      <span className="inline-flex items-center gap-1.5 font-medium">
                        <span aria-hidden style={{ color: STATUS_META[i.status].color }}>{STATUS_META[i.status].symbol}</span>
                        {STATUS_META[i.status].label}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{i.occurrenceCount}</td>
                    <td className="px-4 py-2.5" style={{ color: "var(--ink-secondary)" }}>{i.assignee ?? "—"}</td>
                    <td className="px-4 py-2.5 text-right text-xs tabular-nums" style={{ color: "var(--ink-muted)" }} title={i.startedAt}>
                      {timeAgo(i.startedAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {selectedId !== null ? (
        <IncidentDrawer id={selectedId} onClose={() => setSelectedId(null)} onAction={(m) => setToast({ id: Date.now(), message: m })} />
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
