import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UptimeReportResponse } from "@awm/shared";

import { apiGet } from "../lib/api";

const RANGES = [
  { key: "24h", label: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  { key: "7d", label: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
  { key: "30d", label: "Last 30 days", ms: 30 * 24 * 60 * 60 * 1000 },
] as const;

function seconds(value: number | null): string {
  if (value === null) return "—";
  if (value < 60) return `${value}s`;
  return `${Math.round(value / 60)}m`;
}

export default function ReportsPage(): JSX.Element {
  const [rangeKey, setRangeKey] = useState<(typeof RANGES)[number]["key"]>("24h");
  const range = RANGES.find((r) => r.key === rangeKey) ?? RANGES[0];
  const from = new Date(Date.now() - range.ms).toISOString();
  const query = useQuery({
    queryKey: ["report", rangeKey],
    queryFn: () => apiGet<UptimeReportResponse>(`/api/reports/uptime?from=${encodeURIComponent(from)}`),
    refetchInterval: 60_000,
  });

  const rows = query.data?.rows ?? [];

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Uptime report</h1>
          <p className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
            Uptime, downtime, incidents, MTTA/MTTR and response times per monitor.
          </p>
        </div>
        <a
          href={`/api/reports/uptime?from=${encodeURIComponent(from)}&format=csv`}
          className="rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--surface-inset)]"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
          download
        >
          ⬇ Export CSV
        </a>
      </header>

      <div className="mb-4 inline-flex rounded-lg border p-0.5" style={{ borderColor: "var(--hairline)" }} role="group" aria-label="Report range">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setRangeKey(r.key)}
            aria-pressed={rangeKey === r.key}
            className="rounded-md px-3 py-1.5 text-xs font-medium"
            style={{
              background: rangeKey === r.key ? "var(--surface-inset)" : "transparent",
              color: rangeKey === r.key ? "var(--ink-primary)" : "var(--ink-muted)",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {query.isPending ? (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>Computing report…</p>
      ) : (
        <section className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                  <th className="px-4 py-2.5 font-medium">Monitor</th>
                  <th className="px-4 py-2.5 text-right font-medium">Checks</th>
                  <th className="px-4 py-2.5 text-right font-medium">Uptime</th>
                  <th className="px-4 py-2.5 text-right font-medium">Downtime</th>
                  <th className="px-4 py-2.5 text-right font-medium">Incidents</th>
                  <th className="px-4 py-2.5 text-right font-medium">Avg resp</th>
                  <th className="px-4 py-2.5 text-right font-medium">Slowest</th>
                  <th className="px-4 py-2.5 text-right font-medium">MTTA</th>
                  <th className="px-4 py-2.5 text-right font-medium">MTTR</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.monitorId} className="border-t tabular-nums" style={{ borderColor: "var(--hairline)" }}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.monitorName}</div>
                      <div className="text-xs" style={{ color: "var(--ink-muted)" }}>
                        {r.projectName} · {r.environmentName}
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right">{r.checks}</td>
                    <td className="px-4 py-2.5 text-right">
                      {r.uptimePct === null ? (
                        "—"
                      ) : (
                        <span style={{ color: r.uptimePct < 99 ? "var(--status-warning)" : "var(--ink-primary)" }}>
                          {r.uptimePct.toFixed(2)}%
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right">{r.downtimeMinutes}m</td>
                    <td className="px-4 py-2.5 text-right">
                      <span style={{ color: r.incidentCount > 0 ? "var(--status-critical)" : "var(--ink-primary)" }}>
                        {r.incidentCount}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right">{r.avgResponseMs === null ? "—" : `${r.avgResponseMs} ms`}</td>
                    <td className="px-4 py-2.5 text-right">{r.slowestResponseMs === null ? "—" : `${r.slowestResponseMs} ms`}</td>
                    <td className="px-4 py-2.5 text-right">{seconds(r.mttaSeconds)}</td>
                    <td className="px-4 py-2.5 text-right">{seconds(r.mttrSeconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <p className="mt-3 text-xs" style={{ color: "var(--ink-muted)" }}>
        Sample mode keeps the most recent 300 checks per monitor in memory — long-range history fills in once the database is connected.
        Scheduled email delivery of this report lands with the notification provider decision (M5).
      </p>
    </div>
  );
}
