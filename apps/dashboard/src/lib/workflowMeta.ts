import type {
  WorkflowEventStatus,
  WorkflowEventType,
  WorkflowPlatform,
} from "@awm/shared";

interface Meta {
  readonly label: string;
  readonly color: string;
  readonly symbol: string;
}

/** Status is conveyed by shape + label + color together, never color alone. */
export const EVENT_STATUS_META: Record<WorkflowEventStatus, Meta> = {
  new: { label: "New", color: "var(--status-critical)", symbol: "■" },
  acknowledged: { label: "Acknowledged", color: "var(--status-warning)", symbol: "▲" },
  investigating: { label: "Investigating", color: "var(--status-serious)", symbol: "◆" },
  retried: { label: "Retried", color: "var(--accent)", symbol: "↻" },
  resolved: { label: "Resolved", color: "var(--status-good)", symbol: "●" },
  ignored: { label: "Ignored", color: "var(--ink-muted)", symbol: "●" },
};

export const PLATFORM_LABEL: Record<WorkflowPlatform, string> = {
  n8n: "n8n",
  zapier: "Zapier",
  make: "Make",
  custom_app: "App",
  other: "Other",
};

export const EVENT_TYPE_META: Record<
  WorkflowEventType,
  { readonly label: string; readonly color: string | null }
> = {
  execution_failed: { label: "Execution failed", color: null },
  workflow_deactivated: { label: "Workflow turned off", color: "var(--status-critical)" },
  task_halted: { label: "Task halted", color: "var(--status-warning)" },
};

export const OPEN_STATUSES: readonly WorkflowEventStatus[] = [
  "new",
  "acknowledged",
  "investigating",
];

export const ASSIGNEES = ["Tumisang", "Colin", "Armand", "Marko", "Joshua"] as const;
