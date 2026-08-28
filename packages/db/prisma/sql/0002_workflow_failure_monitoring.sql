-- Workflow failure monitoring (n8n / Zapier failure inbox)
-- Additive only — no changes to existing objects. See docs/workflow-failure-monitoring.md §3.2.

-- CreateEnum
CREATE TYPE "awm_monitoring"."workflow_platform_type" AS ENUM ('n8n', 'zapier', 'make', 'custom_app', 'other');

-- CreateEnum
CREATE TYPE "awm_monitoring"."workflow_event_type" AS ENUM ('execution_failed', 'workflow_deactivated', 'task_halted');

-- CreateEnum
CREATE TYPE "awm_monitoring"."workflow_event_status_type" AS ENUM ('new', 'acknowledged', 'investigating', 'retried', 'resolved', 'ignored');

-- CreateEnum
CREATE TYPE "awm_monitoring"."ingest_channel_type" AS ENUM ('push', 'sweep');

-- CreateTable
CREATE TABLE "awm_monitoring"."workflow_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "platform" "awm_monitoring"."workflow_platform_type" NOT NULL,
    "name" TEXT NOT NULL,
    "base_url" TEXT,
    "api_key_encrypted" TEXT,
    "ingest_token_hash" TEXT NOT NULL,
    "sweep_enabled" BOOLEAN NOT NULL DEFAULT false,
    "last_swept_at" TIMESTAMPTZ(6),
    "sweep_cursor" TEXT,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awm_monitoring"."workflow_failure_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "source_id" UUID NOT NULL,
    "event_type" "awm_monitoring"."workflow_event_type" NOT NULL,
    "status" "awm_monitoring"."workflow_event_status_type" NOT NULL DEFAULT 'new',
    "workflow_external_id" TEXT NOT NULL,
    "workflow_name" TEXT NOT NULL,
    "execution_external_id" TEXT,
    "execution_url" TEXT,
    "error_message" TEXT NOT NULL,
    "error_node" TEXT,
    "error_stack" TEXT,
    "input_payload" JSONB,
    "resubmit_url" TEXT,
    "fix_suggestion" JSONB,
    "raw_payload" JSONB NOT NULL DEFAULT '{}',
    "dedup_key" TEXT NOT NULL,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ingest_channel" "awm_monitoring"."ingest_channel_type" NOT NULL DEFAULT 'push',
    -- Free-text until Supabase Auth user mirroring lands (M1); becomes a users FK then.
    "assignee" TEXT,
    "acknowledged_at" TIMESTAMPTZ(6),
    "resolved_at" TIMESTAMPTZ(6),
    "retry_execution_id" TEXT,
    "incident_id" UUID,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMPTZ(6),
    "deletion_reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "workflow_failure_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workflow_sources_ingest_token_hash_key" ON "awm_monitoring"."workflow_sources"("ingest_token_hash");

-- CreateIndex
CREATE INDEX "workflow_sources_org_id_idx" ON "awm_monitoring"."workflow_sources"("org_id");

-- CreateIndex
CREATE UNIQUE INDEX "workflow_failure_events_source_id_dedup_key_key" ON "awm_monitoring"."workflow_failure_events"("source_id", "dedup_key");

-- CreateIndex
CREATE INDEX "workflow_failure_events_org_id_status_received_at_idx" ON "awm_monitoring"."workflow_failure_events"("org_id", "status", "received_at" DESC);

-- CreateIndex
CREATE INDEX "workflow_failure_events_source_id_idx" ON "awm_monitoring"."workflow_failure_events"("source_id");

-- CreateIndex
CREATE INDEX "workflow_failure_events_workflow_external_id_idx" ON "awm_monitoring"."workflow_failure_events"("workflow_external_id");

-- AddForeignKey
ALTER TABLE "awm_monitoring"."workflow_sources" ADD CONSTRAINT "workflow_sources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."workflow_failure_events" ADD CONSTRAINT "workflow_failure_events_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "awm_monitoring"."organisations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."workflow_failure_events" ADD CONSTRAINT "workflow_failure_events_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "awm_monitoring"."workflow_sources"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awm_monitoring"."workflow_failure_events" ADD CONSTRAINT "workflow_failure_events_incident_id_fkey" FOREIGN KEY ("incident_id") REFERENCES "awm_monitoring"."incidents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RLS (service-role only, same posture as 0001)
ALTER TABLE "awm_monitoring"."workflow_sources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "awm_monitoring"."workflow_failure_events" ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON "awm_monitoring"."workflow_sources"
    FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE POLICY "service_role_all" ON "awm_monitoring"."workflow_failure_events"
    FOR ALL TO service_role USING (true) WITH CHECK (true);
