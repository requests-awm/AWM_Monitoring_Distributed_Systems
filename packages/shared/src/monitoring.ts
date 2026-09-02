import { z } from "zod";

import {
  CheckResultStatus,
  HeartbeatEventType,
  HttpAuthType,
  HttpMethod,
  IncidentStatus,
  MaintenanceScope,
  MonitorType,
  NotificationChannelType,
  OrgRole,
  Severity,
} from "./enums";

// ---------------------------------------------------------------------------
// Per-type monitor configuration (validated at CRUD time, executed by worker)
// ---------------------------------------------------------------------------

export const HttpAuthConfig = z.object({
  type: HttpAuthType.default("none"),
  username: z.string().optional(),
  password: z.string().optional(),
  token: z.string().optional(),
  headerName: z.string().optional(),
  headerValue: z.string().optional(),
});
export type HttpAuthConfig = z.infer<typeof HttpAuthConfig>;

export const HttpValidationConfig = z.object({
  expectedStatusCodes: z.array(z.number().int()).optional(),
  keyword: z.string().optional(),
  forbiddenKeyword: z.string().optional(),
  jsonFieldPath: z.string().optional(),
  jsonFieldEquals: z.string().optional(),
  maxDurationMs: z.number().int().positive().optional(),
});
export type HttpValidationConfig = z.infer<typeof HttpValidationConfig>;

export const HttpMonitorConfig = z.object({
  url: z.string().url(),
  method: HttpMethod.default("get"),
  headers: z.record(z.string()).optional(),
  body: z.string().optional(),
  auth: HttpAuthConfig.optional(),
  validation: HttpValidationConfig.optional(),
});
export type HttpMonitorConfig = z.infer<typeof HttpMonitorConfig>;

export const TcpMonitorConfig = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
});
export type TcpMonitorConfig = z.infer<typeof TcpMonitorConfig>;

export const SslMonitorConfig = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(443),
  /** Days-remaining thresholds that produce warnings (spec: 30/14/7/1). */
  warnDays: z.array(z.number().int().positive()).default([30, 14, 7, 1]),
});
export type SslMonitorConfig = z.infer<typeof SslMonitorConfig>;

export const HeartbeatMonitorConfig = z.object({
  expectedIntervalMinutes: z.number().int().positive(),
  graceMinutes: z.number().int().min(0).default(5),
});
export type HeartbeatMonitorConfig = z.infer<typeof HeartbeatMonitorConfig>;

export const EmailProviderMonitorConfig = z.object({
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535).default(465),
  /** true = implicit TLS (465); false = plain connect (25/587 STARTTLS not attempted in MVP). */
  secure: z.boolean().default(true),
});
export type EmailProviderMonitorConfig = z.infer<typeof EmailProviderMonitorConfig>;

/** Integration monitors are HTTP checks with failure classification (auth/permission/rate-limit). */
export const ApiIntegrationMonitorConfig = HttpMonitorConfig.extend({
  service: z.string().min(1),
  /** Check turns degraded when the provider's rate-limit headers report less than this % remaining. */
  quotaWarnPct: z.number().min(1).max(90).default(20),
});
export type ApiIntegrationMonitorConfig = z.infer<typeof ApiIntegrationMonitorConfig>;

export const MONITOR_CONFIG_SCHEMAS: Partial<Record<MonitorType, z.ZodTypeAny>> = {
  http: HttpMonitorConfig,
  tcp_port: TcpMonitorConfig,
  ssl: SslMonitorConfig,
  heartbeat: HeartbeatMonitorConfig,
  email_provider: EmailProviderMonitorConfig,
  api_integration: ApiIntegrationMonitorConfig,
};

// ---------------------------------------------------------------------------
// CRUD bodies
// ---------------------------------------------------------------------------

export const CHECK_INTERVALS = [1, 5, 10, 15, 30, 60] as const;

export const MonitorCreateBody = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).nullish(),
  projectId: z.string().min(1),
  environmentId: z.string().min(1),
  monitorType: MonitorType,
  checkIntervalMinutes: z.union([
    z.literal(1),
    z.literal(5),
    z.literal(10),
    z.literal(15),
    z.literal(30),
    z.literal(60),
  ]),
  timeoutMs: z.number().int().min(1000).max(120_000).default(30_000),
  retryCount: z.number().int().min(0).max(5).default(0),
  severity: Severity.default("medium"),
  tags: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
  configuration: z.record(z.unknown()),
});
export type MonitorCreateBody = z.infer<typeof MonitorCreateBody>;

export const MonitorUpdateBody = MonitorCreateBody.partial();
export type MonitorUpdateBody = z.infer<typeof MonitorUpdateBody>;

export const ProjectCreateBody = z.object({
  name: z.string().min(2).max(80),
  environments: z.array(z.string().min(1)).min(1).default(["production"]),
});
export type ProjectCreateBody = z.infer<typeof ProjectCreateBody>;

export const ChannelCreateBody = z.object({
  name: z.string().min(2).max(80),
  channelType: NotificationChannelType,
  /** Destination + credentials (webhook url, email address, phone, Asana project). Encrypted at rest. */
  config: z.record(z.string()),
  enabled: z.boolean().default(true),
});
export type ChannelCreateBody = z.infer<typeof ChannelCreateBody>;

export const AlertRuleConditions = z.object({
  severities: z.array(Severity).optional(),
  projectIds: z.array(z.string()).optional(),
  environmentIds: z.array(z.string()).optional(),
  monitorTypes: z.array(MonitorType).optional(),
});
export type AlertRuleConditions = z.infer<typeof AlertRuleConditions>;

export const AlertRuleCreateBody = z.object({
  name: z.string().min(2).max(80),
  channelId: z.string().min(1),
  conditions: AlertRuleConditions.default({}),
  escalationDelaySeconds: z.number().int().min(0).nullish(),
  priority: z.number().int().default(0),
  enabled: z.boolean().default(true),
});
export type AlertRuleCreateBody = z.infer<typeof AlertRuleCreateBody>;

export const MaintenanceWindowCreateBody = z.object({
  name: z.string().min(2).max(120),
  scope: MaintenanceScope,
  projectId: z.string().nullish(),
  environmentId: z.string().nullish(),
  monitorId: z.string().nullish(),
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }),
  muteExisting: z.boolean().default(false),
});
export type MaintenanceWindowCreateBody = z.infer<typeof MaintenanceWindowCreateBody>;

export const HeartbeatPingBody = z.object({
  event_type: HeartbeatEventType.default("success"),
  job_name: z.string().optional(),
  records_processed: z.number().int().optional(),
  records_failed: z.number().int().optional(),
  duration_ms: z.number().int().optional(),
  error_message: z.string().optional(),
});
export type HeartbeatPingBody = z.infer<typeof HeartbeatPingBody>;

export const IncidentNoteBody = z.object({ message: z.string().min(1).max(2000) });
export type IncidentNoteBody = z.infer<typeof IncidentNoteBody>;

// ---------------------------------------------------------------------------
// DTOs (API → dashboard)
// ---------------------------------------------------------------------------

export interface EnvironmentDto {
  id: string;
  name: string;
}

export interface ProjectDto {
  id: string;
  name: string;
  slug: string;
  environments: EnvironmentDto[];
}

export interface MonitorDto {
  id: string;
  name: string;
  description: string | null;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  monitorType: MonitorType;
  checkIntervalMinutes: number;
  timeoutMs: number;
  retryCount: number;
  severity: Severity;
  tags: string[];
  enabled: boolean;
  /** Sensitive values replaced with "•••". */
  configuration: Record<string, unknown>;
  /** Heartbeat monitors only: ping URL path is /api/heartbeats/{token}. */
  heartbeatToken: string | null;
  createdAt: string;
}

export interface MonitorRuntime {
  lastStatus: CheckResultStatus | null;
  lastCheckedAt: string | null;
  lastResponseTimeMs: number | null;
  uptime24hPct: number | null;
  /** Oldest → newest recent check outcomes for the status strip. */
  history: CheckResultStatus[];
  openIncidents: number;
  inMaintenance: boolean;
  /** Heartbeat monitors: when the last ping arrived. */
  lastHeartbeatAt: string | null;
}

export type MonitorListItem = MonitorDto & MonitorRuntime;

export interface MonitorResultDto {
  id: string;
  status: CheckResultStatus;
  success: boolean;
  responseTimeMs: number | null;
  statusCode: number | null;
  failureReason: string | null;
  /** % of the provider's rate-limit quota still available, when the provider reports it. */
  quotaRemainingPct: number | null;
  checkedAt: string;
}

export interface MonitorDetailResponse {
  monitor: MonitorListItem;
  recentResults: MonitorResultDto[];
}

export interface IncidentEventDto {
  id: string;
  eventType: string;
  message: string | null;
  actor: string | null;
  createdAt: string;
}

export interface IncidentDto {
  id: string;
  monitorId: string;
  monitorName: string;
  projectName: string;
  environmentName: string;
  status: IncidentStatus;
  severity: Severity;
  title: string;
  summary: string | null;
  failureReason: string | null;
  occurrenceCount: number;
  startedAt: string;
  lastOccurrenceAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
  assignee: string | null;
}

export interface IncidentDetailResponse {
  incident: IncidentDto;
  events: IncidentEventDto[];
}

export interface NotificationChannelDto {
  id: string;
  name: string;
  channelType: NotificationChannelType;
  enabled: boolean;
  /** Config with credential values masked. */
  configMasked: Record<string, string>;
}

export interface AlertRuleDto {
  id: string;
  name: string;
  channelId: string;
  channelName: string;
  conditions: AlertRuleConditions;
  escalationDelaySeconds: number | null;
  priority: number;
  enabled: boolean;
}

export interface MaintenanceWindowDto {
  id: string;
  name: string;
  scope: MaintenanceScope;
  projectId: string | null;
  environmentId: string | null;
  monitorId: string | null;
  startsAt: string;
  endsAt: string;
  muteExisting: boolean;
  active: boolean;
}

export interface CurrentUserDto {
  email: string;
  role: OrgRole;
}

// ---------------------------------------------------------------------------
// Public status page (unauthenticated — names and states only, never config)
// ---------------------------------------------------------------------------

export interface PublicStatusMonitor {
  name: string;
  status: "operational" | "degraded" | "down" | "maintenance" | "pending";
  uptime24hPct: number | null;
}

export interface PublicStatusProject {
  name: string;
  monitors: PublicStatusMonitor[];
}

export interface PublicStatusResponse {
  generatedAt: string;
  overall: "operational" | "attention" | "critical";
  projects: PublicStatusProject[];
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export interface UptimeReportRow {
  monitorId: string;
  monitorName: string;
  projectName: string;
  environmentName: string;
  checks: number;
  uptimePct: number | null;
  downtimeMinutes: number;
  incidentCount: number;
  avgResponseMs: number | null;
  slowestResponseMs: number | null;
  mttaSeconds: number | null;
  mttrSeconds: number | null;
}

export interface UptimeReportResponse {
  from: string;
  to: string;
  rows: UptimeReportRow[];
}

// ---------------------------------------------------------------------------
// Worker ↔ API internal contract
// ---------------------------------------------------------------------------

/** A due check the worker must execute (config already decrypted). */
export interface MonitorJob {
  id: string;
  monitorType: MonitorType;
  timeoutMs: number;
  configuration: Record<string, unknown>;
}

export const MonitorResultReport = z.object({
  monitorId: z.string().min(1),
  status: CheckResultStatus,
  success: z.boolean(),
  responseTimeMs: z.number().int().nullish(),
  statusCode: z.number().int().nullish(),
  failureReason: z.string().max(2000).nullish(),
  metadata: z.record(z.unknown()).nullish(),
  checkedAt: z.string().datetime({ offset: true }),
});
export type MonitorResultReport = z.infer<typeof MonitorResultReport>;
