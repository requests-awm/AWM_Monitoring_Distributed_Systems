-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "awm_monitoring";

-- CreateEnum
CREATE TYPE "awm_monitoring"."org_role_type" AS ENUM ('owner', 'administrator', 'operator', 'viewer');

-- CreateEnum
CREATE TYPE "awm_monitoring"."monitor_type" AS ENUM ('http', 'tcp_port', 'heartbeat', 'ssl', 'api_integration', 'email_provider', 'email_canary', 'synthetic_workflow');

-- CreateEnum
CREATE TYPE "awm_monitoring"."severity_type" AS ENUM ('critical', 'high', 'medium', 'low');

-- CreateEnum
CREATE TYPE "awm_monitoring"."check_result_status_type" AS ENUM ('success', 'failure', 'degraded');

-- CreateEnum
CREATE TYPE "awm_monitoring"."incident_status_type" AS ENUM ('open', 'acknowledged', 'investigating', 'resolved', 'muted');

-- CreateEnum
CREATE TYPE "awm_monitoring"."incident_event_type" AS ENUM ('created', 'acknowledged', 'note_added', 'assigned', 'escalated', 'notified', 'resolved', 'reopened', 'muted');

-- CreateEnum
CREATE TYPE "awm_monitoring"."notification_channel_type" AS ENUM ('email', 'sms', 'whatsapp', 'slack', 'teams', 'asana', 'webhook');

-- CreateEnum
CREATE TYPE "awm_monitoring"."heartbeat_event_type" AS ENUM ('success', 'failure', 'started', 'completed');

-- CreateEnum
CREATE TYPE "awm_monitoring"."maintenance_scope_type" AS ENUM ('organisation', 'project', 'environment', 'monitor');

-- CreateEnum
CREATE TYPE "awm_monitoring"."audit_action_type" AS ENUM ('user_login', 'monitor_created', 'monitor_changed', 'monitor_deleted', 'incident_acknowledged', 'incident_resolved', 'notification_channel_changed', 'alert_rule_changed', 'secret_rotated');

-- CreateTable
CREATE TABLE "awm_monitoring"."organisations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organisations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "full_name" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."org_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "awm_monitoring"."org_role_type" NOT NULL DEFAULT 'viewer',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "org_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."projects" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."environments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "environments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."monitors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "environment_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monitor_type" "awm_monitoring"."monitor_type" NOT NULL,
    "check_interval_minutes" INTEGER NOT NULL,
    "timeout_ms" INTEGER NOT NULL DEFAULT 30000,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "severity" "awm_monitoring"."severity_type" NOT NULL DEFAULT 'medium',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "configuration" JSONB NOT NULL DEFAULT '{}',
    "heartbeat_token" TEXT,
    "created_by" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."monitor_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "monitor_id" UUID NOT NULL,
    "status" "awm_monitoring"."check_result_status_type" NOT NULL,
    "success" BOOLEAN NOT NULL,
    "response_time_ms" INTEGER,
    "status_code" INTEGER,
    "failure_reason" TEXT,
    "metadata" JSONB,
    "checked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "monitor_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."incidents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "monitor_id" UUID NOT NULL,
    "status" "awm_monitoring"."incident_status_type" NOT NULL DEFAULT 'open',
    "severity" "awm_monitoring"."severity_type" NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "failure_reason" TEXT,
    "dedup_signature" TEXT NOT NULL,
    "occurrence_count" INTEGER NOT NULL DEFAULT 1,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_occurrence_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "assigned_to" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "incidents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."incident_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "incident_id" UUID NOT NULL,
    "event_type" "awm_monitoring"."incident_event_type" NOT NULL,
    "message" TEXT,
    "actor_id" UUID,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "incident_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."notification_channels" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "channel_type" "awm_monitoring"."notification_channel_type" NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."alert_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "monitor_id" UUID,
    "notification_channel_id" UUID NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{}',
    "escalation_delay_seconds" INTEGER,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "alert_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."maintenance_windows" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "scope" "awm_monitoring"."maintenance_scope_type" NOT NULL,
    "project_id" UUID,
    "environment_id" UUID,
    "monitor_id" UUID,
    "starts_at" TIMESTAMPTZ(6) NOT NULL,
    "ends_at" TIMESTAMPTZ(6) NOT NULL,
    "recurrence_rule" TEXT,
    "mute_existing" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "maintenance_windows_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."heartbeat_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "monitor_id" UUID NOT NULL,
    "event_type" "awm_monitoring"."heartbeat_event_type" NOT NULL,
    "job_name" TEXT,
    "records_processed" INTEGER,
    "records_failed" INTEGER,
    "duration_ms" INTEGER,
    "error_message" TEXT,
    "metadata" JSONB,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "heartbeat_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "actor_id" UUID,
    "action" "awm_monitoring"."audit_action_type" NOT NULL,
    "entity_type" TEXT,
    "entity_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisations_slug_key" ON "awm_monitoring"."organisations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "awm_monitoring"."users"("email");

-- CreateIndex
CREATE INDEX "org_members_org_id_idx" ON "awm_monitoring"."org_members"("org_id");

-- CreateIndex
CREATE INDEX "org_members_user_id_idx" ON "awm_monitoring"."org_members"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "org_members_org_id_user_id_key" ON "awm_monitoring"."org_members"("org_id", "user_id");

-- CreateIndex
CREATE INDEX "projects_org_id_idx" ON "awm_monitoring"."projects"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_org_id_slug_key" ON "awm_monitoring"."projects"("org_id", "slug");

-- CreateIndex
CREATE INDEX "environments_org_id_idx" ON "awm_monitoring"."environments"("org_id");

-- CreateIndex
CREATE INDEX "environments_project_id_idx" ON "awm_monitoring"."environments"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "environments_project_id_name_key" ON "awm_monitoring"."environments"("project_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "monitors_heartbeat_token_key" ON "awm_monitoring"."monitors"("heartbeat_token");

-- CreateIndex
CREATE INDEX "monitors_org_id_idx" ON "awm_monitoring"."monitors"("org_id");

-- CreateIndex
CREATE INDEX "monitors_project_id_idx" ON "awm_monitoring"."monitors"("project_id");

-- CreateIndex
CREATE INDEX "monitors_environment_id_idx" ON "awm_monitoring"."monitors"("environment_id");

-- CreateIndex
CREATE INDEX "monitors_enabled_idx" ON "awm_monitoring"."monitors"("enabled");

-- CreateIndex
CREATE INDEX "monitor_results_monitor_id_checked_at_idx" ON "awm_monitoring"."monitor_results"("monitor_id", "checked_at" DESC);

-- CreateIndex
CREATE INDEX "monitor_results_org_id_idx" ON "awm_monitoring"."monitor_results"("org_id");

-- CreateIndex
CREATE INDEX "incidents_org_id_idx" ON "awm_monitoring"."incidents"("org_id");

-- CreateIndex
CREATE INDEX "incidents_monitor_id_idx" ON "awm_monitoring"."incidents"("monitor_id");

-- CreateIndex
CREATE INDEX "incidents_status_idx" ON "awm_monitoring"."incidents"("status");

-- CreateIndex
CREATE INDEX "incidents_dedup_signature_idx" ON "awm_monitoring"."incidents"("dedup_signature");

-- CreateIndex
CREATE INDEX "incident_events_incident_id_idx" ON "awm_monitoring"."incident_events"("incident_id");

-- CreateIndex
CREATE INDEX "incident_events_org_id_idx" ON "awm_monitoring"."incident_events"("org_id");

-- CreateIndex
CREATE INDEX "notification_channels_org_id_idx" ON "awm_monitoring"."notification_channels"("org_id");

-- CreateIndex
CREATE INDEX "alert_rules_org_id_idx" ON "awm_monitoring"."alert_rules"("org_id");

-- CreateIndex
CREATE INDEX "alert_rules_notification_channel_id_idx" ON "awm_monitoring"."alert_rules"("notification_channel_id");

-- CreateIndex
CREATE INDEX "maintenance_windows_org_id_idx" ON "awm_monitoring"."maintenance_windows"("org_id");

-- CreateIndex
CREATE INDEX "maintenance_windows_starts_at_ends_at_idx" ON "awm_monitoring"."maintenance_windows"("starts_at", "ends_at");

-- CreateIndex
CREATE INDEX "heartbeat_events_monitor_id_received_at_idx" ON "awm_monitoring"."heartbeat_events"("monitor_id", "received_at" DESC);

-- CreateIndex
CREATE INDEX "heartbeat_events_org_id_idx" ON "awm_monitoring"."heartbeat_events"("org_id");

-- CreateIndex
CREATE INDEX "audit_logs_org_id_created_at_idx" ON "awm_monitoring"."audit_logs"("org_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "awm_monitoring"."audit_logs"("actor_id");

-- AddForeignKey
ALTER TABLE "awm_monitoring"."org_members" ADD CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."org_members" ADD CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "awm_monitoring"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."projects" ADD CONSTRAINT "projects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."environments" ADD CONSTRAINT "environments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."environments" ADD CONSTRAINT "environments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "awm_monitoring"."projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."monitors" ADD CONSTRAINT "monitors_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."monitors" ADD CONSTRAINT "monitors_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "awm_monitoring"."projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."monitors" ADD CONSTRAINT "monitors_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "awm_monitoring"."environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."monitors" ADD CONSTRAINT "monitors_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "awm_monitoring"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."monitor_results" ADD CONSTRAINT "monitor_results_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."monitor_results" ADD CONSTRAINT "monitor_results_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "awm_monitoring"."monitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."incidents" ADD CONSTRAINT "incidents_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."incidents" ADD CONSTRAINT "incidents_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "awm_monitoring"."monitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."incidents" ADD CONSTRAINT "incidents_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "awm_monitoring"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."incident_events" ADD CONSTRAINT "incident_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."incident_events" ADD CONSTRAINT "incident_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "awm_monitoring"."incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."incident_events" ADD CONSTRAINT "incident_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "awm_monitoring"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."notification_channels" ADD CONSTRAINT "notification_channels_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."alert_rules" ADD CONSTRAINT "alert_rules_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."alert_rules" ADD CONSTRAINT "alert_rules_notification_channel_id_fkey" FOREIGN KEY ("notification_channel_id") REFERENCES "awm_monitoring"."notification_channels"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."alert_rules" ADD CONSTRAINT "alert_rules_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "awm_monitoring"."monitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."maintenance_windows" ADD CONSTRAINT "maintenance_windows_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."maintenance_windows" ADD CONSTRAINT "maintenance_windows_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "awm_monitoring"."projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."maintenance_windows" ADD CONSTRAINT "maintenance_windows_environment_id_fkey" FOREIGN KEY ("environment_id") REFERENCES "awm_monitoring"."environments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."maintenance_windows" ADD CONSTRAINT "maintenance_windows_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "awm_monitoring"."monitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."heartbeat_events" ADD CONSTRAINT "heartbeat_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."heartbeat_events" ADD CONSTRAINT "heartbeat_events_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "awm_monitoring"."monitors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."audit_logs" ADD CONSTRAINT "audit_logs_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "awm_monitoring"."users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ============================================================
-- Row Level Security (AWM shared-DB rule)
-- Every table: RLS enabled + service_role full access. The app
-- controls what users see; the DB guarantees only our backend
-- (service role key) can read/write. Required before Colin opens
-- any cross-read grant.
-- ============================================================

ALTER TABLE "awm_monitoring"."organisations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."organisations"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."users" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."users"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."org_members" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."org_members"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."projects" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."projects"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."environments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."environments"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."monitors" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."monitors"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."monitor_results" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."monitor_results"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."incidents" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."incidents"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."incident_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."incident_events"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."notification_channels" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."notification_channels"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."alert_rules" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."alert_rules"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."maintenance_windows" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."maintenance_windows"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."heartbeat_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."heartbeat_events"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE "awm_monitoring"."audit_logs" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_full_access" ON "awm_monitoring"."audit_logs"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

