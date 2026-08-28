import type { IncidentRow } from "@awm/shared";

import { SeverityBadge } from "./StatusBadge";

const SEVERITY_ORDER: Record<IncidentRow["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function AttentionPanel({
  incidents,
}: {
  incidents: readonly IncidentRow[];
}): JSX.Element {
  const sorted = [...incidents].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return (
    <section className="card overflow-hidden">
      <header className="flex items-center justify-between border-b px-4 py-3" style={{ borderColor: "var(--hairline)" }}>
        <h2 className="text-sm font-semibold">Needs attention</h2>
        <span className="text-xs" style={{ color: "var(--ink-muted)" }}>
          {sorted.length} active
        </span>
      </header>

      {sorted.length === 0 ? (
        <p className="px-4 py-6 text-sm" style={{ color: "var(--ink-muted)" }}>
          Nothing needs attention. All monitors healthy.
        </p>
      ) : (
        <ul>
          {sorted.map((inc) => (
            <li
              key={inc.id}
              className="flex items-start justify-between gap-4 border-b px-4 py-3 last:border-b-0"
              style={{ borderColor: "var(--hairline)" }}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <SeverityBadge severity={inc.severity} />
                  <span className="truncate text-sm font-medium">{inc.title}</span>
                </div>
                <div className="mt-1 text-xs" style={{ color: "var(--ink-secondary)" }}>
                  {inc.failureReason}
                </div>
                <div className="mt-1 text-xs" style={{ color: "var(--ink-muted)" }}>
                  {inc.monitor} · {inc.status} · started {inc.startedAgo} ago
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
