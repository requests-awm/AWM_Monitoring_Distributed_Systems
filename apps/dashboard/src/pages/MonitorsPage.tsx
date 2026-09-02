import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  MonitorDetailResponse,
  MonitorListItem,
  MonitorType,
  ProjectDto,
} from "@awm/shared";

import { Toast, type ToastState } from "../components/Toast";
import { ActionButton } from "../components/WorkflowBadges";
import { StatusBadge } from "../components/StatusBadge";
import { UptimeStrip } from "../components/UptimeStrip";
import { apiGet, apiSend } from "../lib/api";
import { timeAgo } from "../lib/time";
import type { DisplayStatus } from "../lib/status";

const TYPE_LABEL: Record<MonitorType, string> = {
  http: "HTTP",
  tcp_port: "TCP",
  heartbeat: "Heartbeat",
  ssl: "SSL",
  api_integration: "Integration",
  email_provider: "Email",
  email_canary: "Canary",
  synthetic_workflow: "Workflow",
};

function displayStatus(m: MonitorListItem): DisplayStatus {
  if (m.inMaintenance) return "maintenance";
  if (m.lastStatus === "failure") return "failed";
  if (m.lastStatus === "degraded") return "warning";
  return "healthy";
}

function Field({ label, children }: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      {children}
    </label>
  );
}

const inputClass =
  "rounded-lg border px-3 py-2 text-sm font-normal focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]";
const inputStyle = {
  borderColor: "var(--hairline)",
  background: "var(--surface-card)",
  color: "var(--ink-primary)",
} as const;

// ---------------------------------------------------------------------------
// Create dialog
// ---------------------------------------------------------------------------

function NewMonitorDialog({
  projects,
  onClose,
  onCreated,
}: {
  projects: ProjectDto[];
  onClose: () => void;
  onCreated: (name: string) => void;
}): JSX.Element {
  const [name, setName] = useState("");
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const project = projects.find((p) => p.id === projectId);
  const [environmentId, setEnvironmentId] = useState(project?.environments[0]?.id ?? "");
  const [type, setType] = useState<MonitorType>("http");
  const [interval, setIntervalMin] = useState(5);
  const [severity, setSeverity] = useState("medium");
  const [url, setUrl] = useState("https://");
  const [keyword, setKeyword] = useState("");
  const [maxDurationMs, setMaxDurationMs] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("443");
  const [expectedMinutes, setExpectedMinutes] = useState("60");
  const [service, setService] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setEnvironmentId(project?.environments[0]?.id ?? "");
  }, [projectId, project]);

  const buildConfiguration = (): Record<string, unknown> => {
    switch (type) {
      case "http":
      case "api_integration": {
        const validation: Record<string, unknown> = {};
        if (keyword.trim() !== "") validation.keyword = keyword.trim();
        if (maxDurationMs.trim() !== "") validation.maxDurationMs = Number(maxDurationMs);
        const config: Record<string, unknown> = { url, method: "get", validation };
        if (type === "api_integration") config.service = service.trim() === "" ? name : service.trim();
        return config;
      }
      case "tcp_port":
        return { host, port: Number(port) };
      case "ssl":
        return { host, port: Number(port) || 443, warnDays: [30, 14, 7, 1] };
      case "email_provider":
        return { host, port: Number(port) || 465, secure: true };
      case "heartbeat":
        return { expectedIntervalMinutes: Number(expectedMinutes) || 60, graceMinutes: 5 };
      default:
        return {};
    }
  };

  const submit = (): void => {
    setBusy(true);
    setError(null);
    apiSend("/api/monitors", "POST", {
      name,
      projectId,
      environmentId,
      monitorType: type,
      checkIntervalMinutes: interval,
      timeoutMs: 30_000,
      retryCount: 1,
      severity,
      tags: [],
      enabled: true,
      configuration: buildConfiguration(),
    })
      .then(() => onCreated(name))
      .catch((e: Error) => setError(e.message))
      .finally(() => setBusy(false));
  };

  const needsUrl = type === "http" || type === "api_integration";
  const needsHost = type === "tcp_port" || type === "ssl" || type === "email_provider";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-4">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="New monitor"
        className="relative max-h-[85vh] w-[560px] max-w-full overflow-y-auto rounded-xl border p-6"
        style={{ background: "var(--surface-card)", borderColor: "var(--hairline)" }}
      >
        <h2 className="text-base font-semibold">New monitor</h2>
        <div className="mt-4 grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <Field label="Name">
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} style={inputStyle} placeholder="e.g. Booking site" />
            </Field>
          </div>
          <Field label="Project">
            <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={inputClass} style={inputStyle}>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Environment">
            <select value={environmentId} onChange={(e) => setEnvironmentId(e.target.value)} className={inputClass} style={inputStyle}>
              {(project?.environments ?? []).map((env) => (
                <option key={env.id} value={env.id}>{env.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Type">
            <select value={type} onChange={(e) => setType(e.target.value as MonitorType)} className={inputClass} style={inputStyle}>
              <option value="http">HTTP / website</option>
              <option value="api_integration">Third-party integration</option>
              <option value="tcp_port">TCP port</option>
              <option value="ssl">SSL certificate</option>
              <option value="heartbeat">Heartbeat (scheduled job)</option>
              <option value="email_provider">Email provider (SMTP)</option>
            </select>
          </Field>
          <Field label="Check every">
            <select value={interval} onChange={(e) => setIntervalMin(Number(e.target.value))} className={inputClass} style={inputStyle}>
              {[1, 5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>{m} min</option>
              ))}
            </select>
          </Field>
          <Field label="Severity">
            <select value={severity} onChange={(e) => setSeverity(e.target.value)} className={inputClass} style={inputStyle}>
              {["critical", "high", "medium", "low"].map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </Field>
          {needsUrl ? (
            <div className="col-span-2">
              <Field label="URL">
                <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputClass} style={inputStyle} />
              </Field>
            </div>
          ) : null}
          {type === "api_integration" ? (
            <Field label="Service name">
              <input value={service} onChange={(e) => setService(e.target.value)} className={inputClass} style={inputStyle} placeholder="e.g. Insightly" />
            </Field>
          ) : null}
          {needsUrl ? (
            <>
              <Field label="Expected keyword (optional)">
                <input value={keyword} onChange={(e) => setKeyword(e.target.value)} className={inputClass} style={inputStyle} />
              </Field>
              <Field label="Max response ms (optional)">
                <input value={maxDurationMs} onChange={(e) => setMaxDurationMs(e.target.value)} className={inputClass} style={inputStyle} placeholder="2000" />
              </Field>
            </>
          ) : null}
          {needsHost ? (
            <>
              <Field label="Host">
                <input value={host} onChange={(e) => setHost(e.target.value)} className={inputClass} style={inputStyle} placeholder="example.com" />
              </Field>
              <Field label="Port">
                <input value={port} onChange={(e) => setPort(e.target.value)} className={inputClass} style={inputStyle} />
              </Field>
            </>
          ) : null}
          {type === "heartbeat" ? (
            <Field label="Expected every (minutes)">
              <input value={expectedMinutes} onChange={(e) => setExpectedMinutes(e.target.value)} className={inputClass} style={inputStyle} />
            </Field>
          ) : null}
        </div>
        {error !== null ? (
          <p className="mt-3 text-sm" style={{ color: "var(--status-critical)" }}>{error}</p>
        ) : null}
        <div className="mt-4 flex gap-2">
          <ActionButton tone="accent" onClick={submit} disabled={busy || name.trim().length < 2}>
            {busy ? "Creating…" : "Create monitor"}
          </ActionButton>
          <ActionButton onClick={onClose}>Cancel</ActionButton>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail drawer
// ---------------------------------------------------------------------------

function MonitorDrawer({
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
    queryKey: ["monitor", id],
    queryFn: () => apiGet<MonitorDetailResponse>(`/api/monitors/${id}`),
    refetchInterval: 10_000,
  });
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const act = (path: string, method: string, message: string, body?: unknown): void => {
    apiSend(`/api/monitors/${id}${path}`, method, body)
      .then(() => {
        onAction(message);
        void queryClient.invalidateQueries({ queryKey: ["monitors"] });
        void queryClient.invalidateQueries({ queryKey: ["monitor", id] });
      })
      .catch((e: Error) => onAction(`Failed: ${e.message}`));
  };

  const m = query.data?.monitor;
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0" style={{ background: "rgba(0,0,0,0.35)" }} onClick={onClose} aria-hidden />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Monitor details"
        className="absolute right-0 top-0 flex h-full w-[540px] max-w-full flex-col overflow-y-auto border-l"
        style={{ background: "var(--surface-card)", borderColor: "var(--hairline)" }}
      >
        <header className="sticky top-0 border-b px-5 py-4" style={{ background: "var(--surface-card)", borderColor: "var(--hairline)" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {m !== undefined ? (
                <>
                  <div className="flex items-center gap-2 text-xs" style={{ color: "var(--ink-muted)" }}>
                    <span>{TYPE_LABEL[m.monitorType]}</span>
                    <span>·</span>
                    <span>{m.projectName} / {m.environmentName}</span>
                    <span>·</span>
                    <span>every {m.checkIntervalMinutes}m</span>
                  </div>
                  <h2 className="mt-1 truncate text-base font-semibold">{m.name}</h2>
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
        {m !== undefined ? (
          <div className="flex flex-col gap-5 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={displayStatus(m)} />
              {m.uptime24hPct !== null ? (
                <span className="text-sm tabular-nums" style={{ color: "var(--ink-secondary)" }}>
                  {m.uptime24hPct.toFixed(2)}% (24h)
                </span>
              ) : null}
              <span className="ml-auto" />
              {m.monitorType !== "heartbeat" ? (
                <ActionButton tone="accent" onClick={() => act("/test", "POST", "Check queued — result lands within seconds")}>
                  ▶ Run check now
                </ActionButton>
              ) : null}
              <ActionButton onClick={() => act("", "PATCH", m.enabled ? "Monitor disabled" : "Monitor enabled", { enabled: !m.enabled })}>
                {m.enabled ? "Disable" : "Enable"}
              </ActionButton>
              <ActionButton
                onClick={() => {
                  act("", "DELETE", "Monitor deleted");
                  onClose();
                }}
              >
                Delete
              </ActionButton>
            </div>

            {m.monitorType === "heartbeat" && m.heartbeatToken !== null ? (
              <div className="rounded-lg border px-4 py-3" style={{ borderColor: "var(--hairline)", background: "var(--surface-inset)" }}>
                <div className="text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                  Ping URL — call on every job run
                </div>
                <code className="mt-1 block break-all font-mono text-xs">
                  POST {window.location.origin}/api/heartbeats/{m.heartbeatToken}
                </code>
                {m.lastHeartbeatAt !== null ? (
                  <div className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                    Last ping {timeAgo(m.lastHeartbeatAt)}
                  </div>
                ) : (
                  <div className="mt-1 text-xs" style={{ color: "var(--status-warning)" }}>
                    Never pinged
                  </div>
                )}
              </div>
            ) : null}

            <details>
              <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                Configuration
              </summary>
              <pre
                className="mt-1.5 overflow-x-auto rounded-lg border px-3 py-2.5 font-mono text-xs leading-relaxed"
                style={{ borderColor: "var(--hairline)", background: "var(--surface-inset)", color: "var(--ink-secondary)" }}
              >
                {JSON.stringify(m.configuration, null, 2)}
              </pre>
            </details>

            <div>
              <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                Recent checks
              </h3>
              {query.data !== undefined && query.data.recentResults.length === 0 ? (
                <p className="text-sm" style={{ color: "var(--ink-muted)" }}>No checks yet.</p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {(query.data?.recentResults ?? []).map((r) => (
                    <li key={r.id} className="flex items-baseline gap-2 text-sm">
                      <span aria-hidden style={{ color: r.status === "success" ? "var(--status-good)" : r.status === "degraded" ? "var(--status-warning)" : "var(--status-critical)" }}>
                        {r.status === "success" ? "●" : r.status === "degraded" ? "▲" : "■"}
                      </span>
                      <span className="tabular-nums text-xs" style={{ color: "var(--ink-muted)" }} title={r.checkedAt}>
                        {timeAgo(r.checkedAt)}
                      </span>
                      <span className="tabular-nums text-xs" style={{ color: "var(--ink-secondary)" }}>
                        {r.responseTimeMs !== null ? `${r.responseTimeMs}ms` : "—"}
                      </span>
                      {r.quotaRemainingPct !== null ? (
                        <span
                          className="tabular-nums text-xs"
                          title="Provider rate-limit quota remaining"
                          style={{ color: r.quotaRemainingPct <= 20 ? "var(--status-warning)" : "var(--ink-muted)" }}
                        >
                          quota {r.quotaRemainingPct}%
                        </span>
                      ) : null}
                      {r.failureReason !== null ? (
                        <span className="min-w-0 truncate text-xs" style={{ color: "var(--status-critical)" }} title={r.failureReason}>
                          {r.failureReason}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}
      </aside>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function MonitorsPage(): JSX.Element {
  const queryClient = useQueryClient();
  const monitorsQuery = useQuery({
    queryKey: ["monitors"],
    queryFn: () => apiGet<MonitorListItem[]>("/api/monitors"),
    refetchInterval: 15_000,
  });
  const projectsQuery = useQuery({
    queryKey: ["projects"],
    queryFn: () => apiGet<ProjectDto[]>("/api/projects"),
  });
  const [projectFilter, setProjectFilter] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const notify = (message: string): void => setToast({ id: Date.now(), message });

  const monitors = useMemo(() => {
    const rows = monitorsQuery.data ?? [];
    const filtered = projectFilter === "all" ? rows : rows.filter((m) => m.projectId === projectFilter);
    const rank: Record<DisplayStatus, number> = { failed: 0, warning: 1, maintenance: 2, healthy: 3 };
    return [...filtered].sort((a, b) => rank[displayStatus(a)] - rank[displayStatus(b)]);
  }, [monitorsQuery.data, projectFilter]);

  if (monitorsQuery.isPending) {
    return <p className="px-6 py-10 text-sm" style={{ color: "var(--ink-muted)" }}>Loading monitors…</p>;
  }

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Monitors</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
            Websites, APIs, ports, certificates, scheduled jobs, email providers, integrations.
          </p>
        </div>
        <ActionButton tone="accent" onClick={() => setCreating(true)}>+ New monitor</ActionButton>
      </header>

      <div className="mb-4 inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--hairline)" }} role="group" aria-label="Filter by project">
        <button
          type="button"
          onClick={() => setProjectFilter("all")}
          className="rounded-md px-3 py-1.5 text-xs font-medium"
          style={{ background: projectFilter === "all" ? "var(--surface-inset)" : "transparent", color: projectFilter === "all" ? "var(--ink-primary)" : "var(--ink-muted)" }}
        >
          All projects
        </button>
        {(projectsQuery.data ?? []).map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setProjectFilter(p.id)}
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{ background: projectFilter === p.id ? "var(--surface-inset)" : "transparent", color: projectFilter === p.id ? "var(--ink-primary)" : "var(--ink-muted)" }}
          >
            {p.name}
          </button>
        ))}
      </div>

      <section className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                <th className="px-4 py-2.5 font-medium">Monitor</th>
                <th className="px-4 py-2.5 font-medium">Type</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Recent checks</th>
                <th className="px-4 py-2.5 text-right font-medium">Uptime 24h</th>
                <th className="px-4 py-2.5 text-right font-medium">Response</th>
                <th className="px-4 py-2.5 text-right font-medium">Last check</th>
              </tr>
            </thead>
            <tbody>
              {monitors.map((m) => (
                <tr
                  key={m.id}
                  tabIndex={0}
                  onClick={() => setSelectedId(m.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(m.id);
                    }
                  }}
                  className="cursor-pointer border-t hover:bg-[var(--surface-inset)] focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)]"
                  style={{ borderColor: "var(--hairline)" }}
                >
                  <td className="px-4 py-2.5">
                    <div className="font-medium">
                      {m.name}
                      {!m.enabled ? (
                        <span className="ml-2 rounded-md px-1.5 py-0.5 text-xs font-medium" style={{ background: "var(--surface-inset)", color: "var(--ink-muted)" }}>
                          disabled
                        </span>
                      ) : null}
                    </div>
                    <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                      {m.projectName} · {m.environmentName}
                    </div>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: "var(--ink-secondary)" }}>{TYPE_LABEL[m.monitorType]}</td>
                  <td className="px-4 py-2.5"><StatusBadge status={displayStatus(m)} /></td>
                  <td className="px-4 py-2.5">
                    <UptimeStrip history={m.history.map((s) => (s === "success" ? "healthy" : s === "degraded" ? "warning" : "failed"))} />
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {m.uptime24hPct === null ? "—" : `${m.uptime24hPct.toFixed(2)}%`}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {m.lastResponseTimeMs === null ? "—" : `${m.lastResponseTimeMs} ms`}
                  </td>
                  <td className="px-4 py-2.5 text-right text-xs" style={{ color: "var(--ink-muted)" }}>
                    {m.lastCheckedAt === null ? "never" : timeAgo(m.lastCheckedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {creating ? (
        <NewMonitorDialog
          projects={projectsQuery.data ?? []}
          onClose={() => setCreating(false)}
          onCreated={(name) => {
            setCreating(false);
            notify(`Monitor “${name}” created — first check runs within seconds`);
            void queryClient.invalidateQueries({ queryKey: ["monitors"] });
          }}
        />
      ) : null}

      {selectedId !== null ? (
        <MonitorDrawer id={selectedId} onClose={() => setSelectedId(null)} onAction={notify} />
      ) : null}

      <Toast toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
}
