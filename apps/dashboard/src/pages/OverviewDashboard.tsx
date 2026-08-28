import { type ReactNode } from "react";
import type { SystemState } from "@awm/shared";

import { AttentionPanel } from "../components/AttentionPanel";
import { MonitorsTable } from "../components/MonitorsTable";
import { StatTile } from "../components/StatTile";
import { useOverviewData } from "../lib/useOverviewData";

const SYSTEM_META: Record<SystemState, { label: string; color: string; symbol: string }> = {
  operational: { label: "All systems operational", color: "var(--status-good)", symbol: "●" },
  attention: { label: "Degraded — attention needed", color: "var(--status-warning)", symbol: "▲" },
  critical: { label: "Action required", color: "var(--status-critical)", symbol: "■" },
};

function InfoCard({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}): JSX.Element {
  return (
    <section className="card overflow-hidden">
      <header className="border-b px-4 py-3" style={{ borderColor: "var(--hairline)" }}>
        <h2 className="text-sm font-semibold">{title}</h2>
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function CenterNote({ text, tone }: { text: string; tone?: "error" }): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <p
        className="text-sm"
        style={{ color: tone === "error" ? "var(--status-critical)" : "var(--ink-muted)" }}
      >
        {text}
      </p>
    </div>
  );
}

export default function OverviewDashboard(): JSX.Element {
  const query = useOverviewData();

  if (query.isPending) {
    return <CenterNote text="Loading overview…" />;
  }
  if (query.isError) {
    return <CenterNote text="Could not reach the monitoring API." tone="error" />;
  }

  const data = query.data;
  const sys = SYSTEM_META[data.systemState];
  const s = data.stats;

  return (
    <div className="mx-auto max-w-[1200px] px-6 py-6">
      <header className="mb-6">
        <h1 className="text-lg font-semibold">Overview</h1>
        <div className="mt-0.5 flex items-center gap-2 text-sm" style={{ color: sys.color }}>
          <span aria-hidden>{sys.symbol}</span>
          <span className="font-medium">{sys.label}</span>
        </div>
      </header>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Active incidents" value={s.activeIncidents} accent="var(--status-critical)" />
        <StatTile label="Failed" value={s.failed} accent="var(--status-critical)" />
        <StatTile label="Warning" value={s.warning} accent="var(--status-warning)" />
        <StatTile label="Healthy" value={s.healthy} accent="var(--status-good)" />
        <StatTile label="Avg response" value={s.avgResponseMs} suffix="ms" muted />
        <StatTile label="Uptime 24h" value={s.uptimePct.toFixed(2)} suffix="%" muted />
      </div>

      <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <AttentionPanel incidents={data.attention} />
        </div>
        <div className="flex flex-col gap-4">
          <InfoCard title="Missed heartbeats">
            {data.missedHeartbeats.length === 0 ? (
              <p className="text-sm" style={{ color: "var(--ink-muted)" }}>None</p>
            ) : (
              <ul className="space-y-2">
                {data.missedHeartbeats.map((h) => (
                  <li key={h.name} className="flex justify-between text-sm">
                    <span>{h.name}</span>
                    <span style={{ color: "var(--status-critical)" }}>{h.lastSeenAgo}</span>
                  </li>
                ))}
              </ul>
            )}
          </InfoCard>
          <InfoCard title="Upcoming certificate expiries">
            <ul className="space-y-2">
              {data.certExpiries.map((c) => (
                <li key={c.name} className="flex justify-between text-sm">
                  <span className="truncate">{c.name}</span>
                  <span
                    className="tabular-nums"
                    style={{ color: c.daysLeft <= 14 ? "var(--status-warning)" : "var(--ink-secondary)" }}
                  >
                    {c.daysLeft}d
                  </span>
                </li>
              ))}
            </ul>
          </InfoCard>
        </div>
      </div>

      <MonitorsTable monitors={data.monitors} />
    </div>
  );
}
