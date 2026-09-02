import { useQuery } from "@tanstack/react-query";
import type { PublicStatusResponse } from "@awm/shared";

import { timeAgo } from "../lib/time";

const OVERALL_META = {
  operational: { label: "All systems operational", color: "var(--status-good)", symbol: "●" },
  attention: { label: "Some systems degraded", color: "var(--status-warning)", symbol: "▲" },
  critical: { label: "Service disruption", color: "var(--status-critical)", symbol: "■" },
} as const;

const MONITOR_META = {
  operational: { label: "Operational", color: "var(--status-good)", symbol: "●" },
  degraded: { label: "Degraded", color: "var(--status-warning)", symbol: "▲" },
  down: { label: "Down", color: "var(--status-critical)", symbol: "■" },
  maintenance: { label: "Maintenance", color: "var(--ink-muted)", symbol: "◆" },
  pending: { label: "Pending first check", color: "var(--ink-muted)", symbol: "○" },
} as const;

/** Public, unauthenticated status page — rendered without the app nav. */
export default function StatusPage(): JSX.Element {
  const query = useQuery({
    queryKey: ["public-status"],
    queryFn: async () => {
      const res = await fetch("/api/status");
      if (!res.ok) throw new Error(`status ${res.status}`);
      return (await res.json()) as PublicStatusResponse;
    },
    refetchInterval: 30_000,
  });

  const d = query.data;
  return (
    <div className="mx-auto max-w-[720px] px-6 py-12">
      <header className="mb-8 flex items-center gap-3">
        <img src="/favicon.png" alt="" width={36} height={36} style={{ borderRadius: 8 }} />
        <div>
          <h1 className="text-lg font-semibold">Ascot Wealth Management</h1>
          <p className="text-sm" style={{ color: "var(--ink-muted)" }}>System status</p>
        </div>
      </header>

      {query.isError ? (
        <p className="text-sm" style={{ color: "var(--status-critical)" }}>
          Status information is currently unavailable.
        </p>
      ) : d === undefined ? (
        <p className="text-sm" style={{ color: "var(--ink-muted)" }}>Loading…</p>
      ) : (
        <>
          <div
            className="card mb-6 flex items-center gap-3 px-5 py-4 text-base font-semibold"
            style={{ color: OVERALL_META[d.overall].color }}
          >
            <span aria-hidden>{OVERALL_META[d.overall].symbol}</span>
            {OVERALL_META[d.overall].label}
          </div>

          {d.projects.map((p) => (
            <section key={p.name} className="card mb-4 overflow-hidden">
              <header className="border-b px-4 py-3" style={{ borderColor: "var(--hairline)" }}>
                <h2 className="text-sm font-semibold">{p.name}</h2>
              </header>
              <ul>
                {p.monitors.map((m) => {
                  const meta = MONITOR_META[m.status];
                  return (
                    <li
                      key={m.name}
                      className="flex items-center gap-3 border-b px-4 py-2.5 text-sm last:border-b-0"
                      style={{ borderColor: "var(--hairline)" }}
                    >
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      {m.uptime24hPct !== null ? (
                        <span className="text-xs tabular-nums" style={{ color: "var(--ink-muted)" }}>
                          {m.uptime24hPct.toFixed(2)}% (24h)
                        </span>
                      ) : null}
                      <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: meta.color }}>
                        <span aria-hidden>{meta.symbol}</span>
                        {meta.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}

          <p className="mt-6 text-xs" style={{ color: "var(--ink-muted)" }}>
            Updated {timeAgo(d.generatedAt)} · refreshes automatically
          </p>
        </>
      )}
    </div>
  );
}
