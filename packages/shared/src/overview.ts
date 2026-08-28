import type { IncidentStatus, MonitorType, Severity } from "./enums";

/** Presentation status for a monitor, derived by the API from check results. */
export type DisplayStatus = "healthy" | "warning" | "failed" | "maintenance";

/** Overall roll-up state for the whole system. */
export type SystemState = "operational" | "attention" | "critical";

export interface MonitorRow {
  id: string;
  name: string;
  project: string;
  environment: string;
  type: MonitorType;
  status: DisplayStatus;
  uptimePct: number;
  responseMs: number | null;
  lastCheck: string;
  /** Most recent check outcomes, oldest → newest, for the status strip. */
  history: DisplayStatus[];
}

export interface IncidentRow {
  id: string;
  title: string;
  monitor: string;
  severity: Severity;
  status: IncidentStatus;
  startedAgo: string;
  failureReason: string;
}

export interface OverviewStats {
  total: number;
  healthy: number;
  warning: number;
  failed: number;
  activeIncidents: number;
  avgResponseMs: number;
  uptimePct: number;
}

export interface CertExpiry {
  name: string;
  daysLeft: number;
}

export interface MissedHeartbeat {
  name: string;
  lastSeenAgo: string;
}

/** Response contract for `GET /api/overview`. */
export interface OverviewResponse {
  systemState: SystemState;
  stats: OverviewStats;
  attention: IncidentRow[];
  monitors: MonitorRow[];
  missedHeartbeats: MissedHeartbeat[];
  certExpiries: CertExpiry[];
}
