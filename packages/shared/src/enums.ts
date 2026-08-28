import { z } from "zod";

/**
 * Controlled-value enums. Values are lowercase snake_case to match the AWM
 * shared-DB standard; these mirror the Postgres enum types in the
 * `awm_monitoring` schema. Keep this file as the single source of truth.
 */

export const OrgRole = z.enum(["owner", "administrator", "operator", "viewer"]);
export type OrgRole = z.infer<typeof OrgRole>;

export const MonitorType = z.enum([
  "http",
  "tcp_port",
  "heartbeat",
  "ssl",
  "api_integration",
  "email_provider",
  "email_canary",
  "synthetic_workflow",
]);
export type MonitorType = z.infer<typeof MonitorType>;

export const Severity = z.enum(["critical", "high", "medium", "low"]);
export type Severity = z.infer<typeof Severity>;

export const IncidentStatus = z.enum([
  "open",
  "acknowledged",
  "investigating",
  "resolved",
  "muted",
]);
export type IncidentStatus = z.infer<typeof IncidentStatus>;

export const CheckResultStatus = z.enum(["success", "failure", "degraded"]);
export type CheckResultStatus = z.infer<typeof CheckResultStatus>;

export const NotificationChannelType = z.enum([
  "email",
  "sms",
  "whatsapp",
  "slack",
  "teams",
  "asana",
  "webhook",
]);
export type NotificationChannelType = z.infer<typeof NotificationChannelType>;

export const HttpMethod = z.enum(["get", "post", "put", "patch", "delete", "head"]);
export type HttpMethod = z.infer<typeof HttpMethod>;

export const HttpAuthType = z.enum([
  "none",
  "basic",
  "bearer",
  "api_key",
  "custom_headers",
]);
export type HttpAuthType = z.infer<typeof HttpAuthType>;

export const MaintenanceScope = z.enum([
  "organisation",
  "project",
  "environment",
  "monitor",
]);
export type MaintenanceScope = z.infer<typeof MaintenanceScope>;

export const HeartbeatEventType = z.enum([
  "success",
  "failure",
  "started",
  "completed",
]);
export type HeartbeatEventType = z.infer<typeof HeartbeatEventType>;

export const WorkflowPlatform = z.enum(["n8n", "zapier", "make", "custom_app", "other"]);
export type WorkflowPlatform = z.infer<typeof WorkflowPlatform>;

export const WorkflowEventType = z.enum([
  "execution_failed",
  "workflow_deactivated",
  "task_halted",
]);
export type WorkflowEventType = z.infer<typeof WorkflowEventType>;

export const WorkflowEventStatus = z.enum([
  "new",
  "acknowledged",
  "investigating",
  "retried",
  "resolved",
  "ignored",
]);
export type WorkflowEventStatus = z.infer<typeof WorkflowEventStatus>;

export const IngestChannel = z.enum(["push", "sweep"]);
export type IngestChannel = z.infer<typeof IngestChannel>;

export const CHECK_INTERVAL_MINUTES = [1, 5, 10, 15, 30, 60] as const;
export const CheckIntervalMinutes = z.union([
  z.literal(1),
  z.literal(5),
  z.literal(10),
  z.literal(15),
  z.literal(30),
  z.literal(60),
]);
export type CheckIntervalMinutes = z.infer<typeof CheckIntervalMinutes>;
