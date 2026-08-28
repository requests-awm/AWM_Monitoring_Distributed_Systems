import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { MaintenanceScope, MaintenanceWindowDto, ProjectDto } from "@awm/shared";

import { Toast, type ToastState } from "../components/Toast";
import { ActionButton } from "../components/WorkflowBadges";
import { apiGet, apiSend } from "../lib/api";
import { fullTime } from "../lib/time";

const inputClass =
  "rounded-lg border px-3 py-2 text-sm font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]";
const inputStyle = {
  borderColor: "var(--hairline)",
  background: "var(--surface-card)",
  color: "var(--ink-primary)",
} as const;

function toLocalInput(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function MaintenancePage(): JSX.Element {
  const queryClient = useQueryClient();
  const windows = useQuery({
    queryKey: ["maintenance"],
    queryFn: () => apiGet<MaintenanceWindowDto[]>("/api/maintenance-windows"),
    refetchInterval: 30_000,
  });
  const projects = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<ProjectDto[]>("/api/projects"),
  });

  const [name, setName] = useState("");
  const [scope, setScope] = useState<MaintenanceScope>("project");
  const [projectId, setProjectId] = useState("");
  const [startsAt, setStartsAt] = useState(toLocalInput(new Date()));
  const [endsAt, setEndsAt] = useState(toLocalInput(new Date(Date.now() + 60 * 60 * 1000)));
  const [toast, setToast] = useState<ToastState | null>(null);
  const notify = (message: string): void => setToast({ id: Date.now(), message });

  const create = (): void => {
    apiSend("/api/maintenance-windows", "POST", {
      name,
      scope,
      projectId: scope === "project" ? (projectId === "" ? projects.data?.[0]?.id : projectId) : null,
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(endsAt).toISOString(),
      muteExisting: false,
    })
      .then(() => {
        notify(`Maintenance window “${name}” created — incidents suppressed while active`);
        setName("");
        void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      })
      .catch((e: Error) => notify(`Failed: ${e.message}`));
  };

  const remove = (id: string): void => {
    apiSend(`/api/maintenance-windows/${id}`, "DELETE")
      .then(() => {
        notify("Maintenance window removed");
        void queryClient.invalidateQueries({ queryKey: ["maintenance"] });
      })
      .catch((e: Error) => notify(`Failed: ${e.message}`));
  };

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <header className="mb-5">
        <h1 className="text-lg font-semibold">Maintenance windows</h1>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
          Checks keep running and results are stored, but no incidents or alerts fire while a window is active.
        </p>
      </header>

      <section className="card mb-6 px-5 py-4">
        <h2 className="text-sm font-semibold">Schedule a window</h2>
        <div className="mt-3 grid grid-cols-2 gap-4 md:grid-cols-5">
          <label className="col-span-2 flex flex-col gap-1 text-sm font-medium md:col-span-1">
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} style={inputStyle} placeholder="e.g. Supabase upgrade" />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Scope
            <select value={scope} onChange={(e) => setScope(e.target.value as MaintenanceScope)} className={inputClass} style={inputStyle}>
              <option value="organisation">Whole organisation</option>
              <option value="project">Project</option>
            </select>
          </label>
          {scope === "project" ? (
            <label className="flex flex-col gap-1 text-sm font-medium">
              Project
              <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass} style={inputStyle}>
                {(projects.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="flex flex-col gap-1 text-sm font-medium">
            Starts
            <input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} className={inputClass} style={inputStyle} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Ends
            <input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} className={inputClass} style={inputStyle} />
          </label>
        </div>
        <div className="mt-3">
          <ActionButton tone="accent" onClick={create} disabled={name.trim().length < 2}>
            Schedule window
          </ActionButton>
        </div>
      </section>

      <section className="card overflow-hidden">
        <header className="border-b px-4 py-3" style={{ borderColor: "var(--hairline)" }}>
          <h2 className="text-sm font-semibold">Scheduled windows</h2>
        </header>
        {(windows.data ?? []).length === 0 ? (
          <p className="px-4 py-6 text-sm" style={{ color: "var(--ink-muted)" }}>No maintenance windows scheduled.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                  <th className="px-4 py-2.5 font-medium">Window</th>
                  <th className="px-4 py-2.5 font-medium">Scope</th>
                  <th className="px-4 py-2.5 font-medium">From</th>
                  <th className="px-4 py-2.5 font-medium">Until</th>
                  <th className="px-4 py-2.5 font-medium">State</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {(windows.data ?? []).map((w) => (
                  <tr key={w.id} className="border-t" style={{ borderColor: "var(--hairline)" }}>
                    <td className="px-4 py-2.5 font-medium">{w.name}</td>
                    <td className="px-4 py-2.5" style={{ color: "var(--ink-secondary)" }}>{w.scope}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums" style={{ color: "var(--ink-secondary)" }}>{fullTime(w.startsAt)}</td>
                    <td className="px-4 py-2.5 text-xs tabular-nums" style={{ color: "var(--ink-secondary)" }}>{fullTime(w.endsAt)}</td>
                    <td className="px-4 py-2.5">
                      {w.active ? (
                        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
                          <span aria-hidden style={{ color: "var(--status-warning)" }}>◆</span>Active — alerts muted
                        </span>
                      ) : (
                        <span style={{ color: "var(--ink-muted)" }}>Scheduled</span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <ActionButton onClick={() => remove(w.id)}>Remove</ActionButton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
