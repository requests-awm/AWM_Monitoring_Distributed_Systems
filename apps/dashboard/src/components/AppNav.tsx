import { useEffect, useState } from "react";

export type Route =
  | "overview"
  | "monitors"
  | "incidents"
  | "workflow-failures"
  | "automations"
  | "maintenance"
  | "reports"
  | "settings"
  | "status";

const ROUTES: { route: Route; hash: string; label: string }[] = [
  { route: "overview", hash: "#/", label: "Overview" },
  { route: "monitors", hash: "#/monitors", label: "Monitors" },
  { route: "incidents", hash: "#/incidents", label: "Incidents" },
  { route: "workflow-failures", hash: "#/workflow-failures", label: "Workflow failures" },
  { route: "automations", hash: "#/automations", label: "Automations" },
  { route: "maintenance", hash: "#/maintenance", label: "Maintenance" },
  { route: "reports", hash: "#/reports", label: "Reports" },
  { route: "settings", hash: "#/settings", label: "Settings" },
  // Public status page — reachable by hash, deliberately absent from the nav tabs.
  { route: "status", hash: "#/status", label: "Status" },
];
const NAV_ROUTES = ROUTES.filter((r) => r.route !== "status");

/** Hash-based routing keeps us dependency-free until auth forces a real router. */
export function useRoute(): Route {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const onChange = (): void => setHash(window.location.hash);
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  const match = ROUTES.find((r) => r.hash === hash);
  return match?.route ?? "overview";
}

function useApiHealth(): { status: string; mode: "sample" | "live" | null } {
  const [status, setStatus] = useState<string>("checking…");
  const [mode, setMode] = useState<"sample" | "live" | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/health")
      .then((r) =>
        r.ok ? (r.json() as Promise<{ status: string; mode?: "sample" | "live" }>) : Promise.reject(),
      )
      .then((d) => {
        if (cancelled) return;
        setStatus(`API ${d.status}`);
        setMode(d.mode ?? null);
      })
      .catch(() => !cancelled && setStatus("API offline"));
    return () => {
      cancelled = true;
    };
  }, []);
  return { status, mode };
}

export function AppNav({ route }: { route: Route }): JSX.Element {
  const health = useApiHealth();
  return (
    <nav
      className="border-b"
      style={{ borderColor: "var(--hairline)", background: "var(--surface-card)" }}
    >
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-4 px-6 py-3">
        <span className="text-sm font-semibold">AWM Monitoring</span>
        <div className="flex items-center gap-1">
          {NAV_ROUTES.map((r) => {
            const active = r.route === route;
            return (
              <a
                key={r.route}
                href={r.hash}
                aria-current={active ? "page" : undefined}
                className="rounded-md px-3 py-1.5 text-sm font-medium transition-colors hover:bg-[var(--surface-inset)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                style={{
                  color: active ? "var(--ink-primary)" : "var(--ink-muted)",
                  background: active ? "var(--surface-inset)" : "transparent",
                }}
              >
                {r.label}
              </a>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
            {health.status}
          </span>
          {health.mode !== "live" ? (
            <span
              className="rounded-md px-2 py-1 text-xs font-medium"
              style={{ background: "var(--surface-inset)", color: "var(--ink-secondary)" }}
            >
              Sample data — not yet connected to live monitors
            </span>
          ) : null}
        </div>
      </div>
    </nav>
  );
}
