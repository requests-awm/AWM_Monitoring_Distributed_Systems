import type { DisplayStatus, Severity } from "@awm/shared";

export type { DisplayStatus };

interface StatusMeta {
  readonly label: string;
  readonly color: string;
  readonly symbol: string;
}

/** Status is conveyed by shape + label + color together, never color alone. */
export const STATUS_META: Record<DisplayStatus, StatusMeta> = {
  healthy: { label: "Healthy", color: "var(--status-good)", symbol: "●" },
  warning: { label: "Warning", color: "var(--status-warning)", symbol: "▲" },
  failed: { label: "Failed", color: "var(--status-critical)", symbol: "■" },
  maintenance: { label: "Maintenance", color: "var(--ink-muted)", symbol: "◆" },
};

export const SEVERITY_META: Record<Severity, StatusMeta> = {
  critical: { label: "Critical", color: "var(--status-critical)", symbol: "■" },
  high: { label: "High", color: "var(--status-serious)", symbol: "▲" },
  medium: { label: "Medium", color: "var(--status-warning)", symbol: "▲" },
  low: { label: "Low", color: "var(--ink-muted)", symbol: "●" },
};
