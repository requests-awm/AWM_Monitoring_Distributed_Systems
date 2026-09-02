import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { UptimeReportResponse, UsageDayRow, UsageResponse } from "@awm/shared";

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

function lastNDates(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    out.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

function ApiUsageSection(): JSX.Element {
  const query = useQuery({
    queryKey: ["api-usage"],
    queryFn: () => apiGet<UsageResponse>("/api/usage"),
    refetchInterval: 60_000,
  });

  const providers = useMemo(() => {
    const rows = query.data?.rows ?? [];
    const dates = lastNDates(14);
    const byProvider = new Map<string, { rows: UsageDayRow[]; apps: Set<string> }>();
    for (const r of rows) {
      const p = byProvider.get(r.provider) ?? { rows: [], apps: new Set<string>() };
      p.rows.push(r);
      p.apps.add(r.app);
      byProvider.set(r.provider, p);
    }
    const today = dates[dates.length - 1] ?? "";
    const week = dates.slice(-7);
    return [...byProvider.entries()]
      .map(([provider, p]) => {
        const perDay = dates.map((date) => ({
          date,
          calls: p.rows.filter((r) => r.date === date).reduce((a, r) => a + r.calls, 0),
        }));
        return {
          provider,
          apps: [...p.apps].sort(),
          today: p.rows.filter((r) => r.date === today).reduce((a, r) => a + r.calls, 0),
          week: p.rows.filter((r) => week.includes(r.date)).reduce((a, r) => a + r.calls, 0),
          weekErrors: p.rows.filter((r) => week.includes(r.date)).reduce((a, r) => a + r.errors, 0),
          perDay,
          max: Math.max(1, ...perDay.map((d) => d.calls)),
        };
      })
      .sort((a, b) => b.week - a.week);
  }, [query.data]);

  return (
    <section className="mt-8">
      <header className="mb-3">
        <h2 className="text-base font-semibold">API usage</h2>
        <p className="mt-0.5 text-sm" style={{ color: "var(--ink-muted)" }}>
          Third-party calls reported by connected apps (see docs/integrations/TRACK_API_USAGE.md to
          add an app). Quota warnings from provider rate-limit headers appear on the integration
          monitors themselves.
        </p>
      </header>
      {query.isPending ? (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>Loading usage…</p>
      ) : providers.length === 0 ? (
        <div className="card px-4 py-6 text-sm" style={{ color: "var(--ink-muted)" }}>
          No usage reported yet — apps start appearing here once they send their first
          <code className="mx-1">POST /api/ingest/usage</code> report.
        </div>
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide" style={{ color: "var(--ink-muted)" }}>
                  <th className="px-4 py-2.5 font-medium">Provider</th>
                  <th className="px-4 py-2.5 font-medium">Apps</th>
                  <th className="px-4 py-2.5 text-right font-medium">Today</th>
                  <th className="px-4 py-2.5 text-right font-medium">7 days</th>
                  <th className="px-4 py-2.5 text-right font-medium">Errors 7d</th>
                  <th className="px-4 py-2.5 font-medium">Last 14 days</th>
                </tr>
              </thead>
              <tbody>
                {providers.map((p) => (
                  <tr key={p.provider} className="border-t tabular-nums" style={{ borderColor: "var(--hairline)" }}>
                    <td className="px-4 py-2.5 font-medium">{p.provider}</td>
                    <td className="px-4 py-2.5 text-xs" style={{ color: "var(--ink-secondary)" }}>
                      {p.apps.join(", ")}
                    </td>
                    <td className="px-4 py-2.5 text-right">{p.today.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">{p.week.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      <span style={{ color: p.weekErrors > 0 ? "var(--status-critical)" : undefined }}>
                        {p.weekErrors.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-end gap-[2px]" style={{ height: 28, width: 140 }} aria-hidden>
                        {p.perDay.map((d) => (
                          <div
                            key={d.date}
                            title={`${d.date}: ${d.calls.toLocaleString()} calls`}
                            className="flex-1"
                            style={{
                              height: Math.max(d.calls > 0 ? 2 : 1, Math.round((d.calls / p.max) * 26)),
                              background: d.calls > 0 ? "var(--accent)" : "var(--surface-inset)",
                              borderRadius: "2px 2px 0 0",
                            }}
                          />
                        ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {(query.data?.notes ?? []).map((n) => (
        <p key={n} className="mt-2 text-xs" style={{ color: "var(--ink-muted)" }}>{n}</p>
      ))}
    </section>
  );
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

      <ApiUsageSection />
    </div>
  );
}
