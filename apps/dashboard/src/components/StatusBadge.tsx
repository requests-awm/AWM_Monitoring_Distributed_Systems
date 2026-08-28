import type { Severity } from "@awm/shared";

import { SEVERITY_META, STATUS_META, type DisplayStatus } from "../lib/status";

export function StatusBadge({ status }: { status: DisplayStatus }): JSX.Element {
  const meta = STATUS_META[status];
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-medium">
      <span aria-hidden style={{ color: meta.color }}>
        {meta.symbol}
      </span>
      <span>{meta.label}</span>
    </span>
  );
}

export function SeverityBadge({ severity }: { severity: Severity }): JSX.Element {
  const meta = SEVERITY_META[severity];
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-xs font-semibold"
      style={{ color: meta.color, background: "var(--surface-inset)" }}
    >
      <span aria-hidden>{meta.symbol}</span>
      <span>{meta.label}</span>
    </span>
  );
}
