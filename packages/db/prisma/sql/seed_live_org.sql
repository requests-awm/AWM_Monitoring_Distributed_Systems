-- Live-mode seed: run AFTER 0001 + 0002, in the same SQL editor.
-- Creates the organisation (required before any source can be connected) and
-- the n8n + Zapier ingest sources. The ingest_token_hash values are sha256 of
-- the PROD_INGEST_TOKEN_* tokens recorded in the workspace .env — the senders
-- (n8n error handler, Zapier Manager webhooks) authenticate with those tokens.
-- Idempotent: safe to re-run.

WITH org AS (
  INSERT INTO "awm_monitoring"."organisations" ("name", "slug", "updated_at")
  SELECT 'Ascot Wealth Management', 'awm', now()
  WHERE NOT EXISTS (
    SELECT 1 FROM "awm_monitoring"."organisations" WHERE "slug" = 'awm' AND "is_deleted" = false
  )
  RETURNING "id"
),
org_id AS (
  SELECT "id" FROM org
  UNION ALL
  SELECT "id" FROM "awm_monitoring"."organisations" WHERE "slug" = 'awm' AND "is_deleted" = false
  LIMIT 1
)
INSERT INTO "awm_monitoring"."workflow_sources"
  ("org_id", "platform", "name", "ingest_token_hash", "sweep_enabled", "updated_at")
SELECT o."id", v.platform::"awm_monitoring"."workflow_platform_type", v.name, v.hash, false, now()
FROM org_id o,
  (VALUES
    ('n8n',    'AWM n8n',    '030fff21355837e6c1d481304508de20440539c7eaf0d412ed2180e3d92b38cb'),
    ('zapier', 'AWM Zapier', 'b277ec6a58f731910a0b3d8fcddde461fe1232f9118d7677131125547cd42c87')
  ) AS v(platform, name, hash)
WHERE NOT EXISTS (
  SELECT 1 FROM "awm_monitoring"."workflow_sources" s
  WHERE s."ingest_token_hash" = v.hash AND s."is_deleted" = false
);

-- Verify:
SELECT o."name" AS org, s."platform", s."name" AS source, s."sweep_enabled"
FROM "awm_monitoring"."workflow_sources" s
JOIN "awm_monitoring"."organisations" o ON o."id" = s."org_id"
WHERE s."is_deleted" = false;
