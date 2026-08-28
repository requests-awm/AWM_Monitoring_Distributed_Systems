import type { MonitorRow } from "@awm/shared";

import { StatusBadge } from "./StatusBadge";
import { UptimeStrip } from "./UptimeStrip";

const TYPE_LABEL: Record<MonitorRow["type"], string> = {
  http: "HTTP",
  tcp_port: "TCP",
  heartbeat: "Heartbeat",
  ssl: "SSL",
  api_integration: "Integration",
  email_provider: "Email",
  email_canary: "Canary",
  synthetic_workflow: "Workflow",
};

const STATUS_ORDER: Record<MonitorRow["status"], number> = {
  failed: 0,
  warning: 1,
  maintenance: 2,
  healthy: 3,
};

export function MonitorsTable({
  monitors,
}: {
  monitors: readonly MonitorRow[];
}): JSX.Element {
  const sorted = [...monitors].sort(
    (a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );

  return (
    <section className="card overflow-hidden">
      <header className="border-b px-4 py-3" style={{ borderColor: "var(--hairline)" }}>
        <h2 className="text-sm font-semibold">Monitors</h2>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr
              className="text-left text-xs uppercase tracking-wide"
              style={{ color: "var(--ink-muted)" }}
            >
              <th className="px-4 py-2 font-medium">Monitor</th>
              <th className="px-4 py-2 font-medium">Type</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Last 24 checks</th>
              <th className="px-4 py-2 text-right font-medium">Uptime</th>
              <th className="px-4 py-2 text-right font-medium">Response</th>
              <th className="px-4 py-2 text-right font-medium">Last check</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((m) => (
              <tr
                key={m.id}
                className="border-t"
                style={{ borderColor: "var(--hairline)" }}
              >
                <td className="px-4 py-2.5">
                  <div className="font-medium">{m.name}</div>
                  <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                    {m.project} · {m.environment}
                  </div>
                </td>
                <td className="px-4 py-2.5" style={{ color: "var(--ink-secondary)" }}>
                  {TYPE_LABEL[m.type]}
                </td>
                <td className="px-4 py-2.5">
                  <StatusBadge status={m.status} />
                </td>
                <td className="px-4 py-2.5">
                  <UptimeStrip history={m.history} />
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {m.uptimePct.toFixed(2)}%
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {m.responseMs === null ? "—" : `${m.responseMs} ms`}
                </td>
                <td
                  className="px-4 py-2.5 text-right text-xs"
                  style={{ color: "var(--ink-muted)" }}
                >
                  {m.lastCheck}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
