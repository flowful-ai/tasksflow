-- ===== v2 data: normalise priority/category before the CHECK constraints =====
-- The v2 schema adds CHECK constraints on tasks.priority and
-- task_states.category. Normalise legacy values first so adding them cannot
-- fail on existing rows.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'tasks' AND column_name = 'priority') THEN
    UPDATE tasks
    SET priority = CASE lower(trim(priority))
      WHEN 'urgent' THEN 'urgent'
      WHEN 'high' THEN 'high'
      WHEN 'medium' THEN 'medium'
      WHEN 'low' THEN 'low'
      WHEN 'none' THEN 'none'
      ELSE NULL
    END
    WHERE priority IS NOT NULL
      AND priority NOT IN ('urgent', 'high', 'medium', 'low', 'none');
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'task_states' AND column_name = 'category') THEN
    UPDATE task_states
    SET category = CASE
      WHEN lower(category) IN ('done', 'completed', 'complete', 'cancelled', 'canceled', 'closed') THEN 'done'
      WHEN lower(category) IN ('in_progress', 'in progress', 'inprogress', 'started', 'active', 'review', 'in_review') THEN 'in_progress'
      ELSE 'backlog'
    END
    WHERE category NOT IN ('backlog', 'in_progress', 'done');
  END IF;
END $$;
--> statement-breakpoint
-- ===== v2 schema (drizzle-kit generate) =====
CREATE TABLE "auth_rate_limits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL,
	CONSTRAINT "auth_rate_limits_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "integration_oauth_states" (
	"state" text PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"user_id" uuid NOT NULL,
	"session_id" text NOT NULL,
	"project_id" uuid NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"key" text,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"done_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"type" text NOT NULL,
	"task_id" uuid,
	"actor_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dedupe_key" text,
	"read_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_type_check" CHECK ("notifications"."type" IN ('assigned', 'mentioned', 'commented', 'status_changed', 'due_soon', 'overdue', 'github'))
);
--> statement-breakpoint
CREATE TABLE "outgoing_webhook_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"webhook_id" uuid NOT NULL,
	"event" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response_code" integer,
	"attempt" integer DEFAULT 0 NOT NULL,
	"error" text,
	"duration_ms" integer,
	"delivered_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outgoing_webhooks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"url" text NOT NULL,
	"description" text,
	"secret" text NOT NULL,
	"events" text[] DEFAULT ARRAY[]::text[] NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "public_share_password_attempts" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"window_expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limit_counters" (
	"key" text NOT NULL,
	"bucket_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "rate_limit_counters_key_bucket_start_pk" PRIMARY KEY("key","bucket_start")
);
--> statement-breakpoint
CREATE TABLE "task_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"task_id" uuid NOT NULL,
	"related_task_id" uuid NOT NULL,
	"type" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_relation_no_self" CHECK ("task_relations"."task_id" <> "task_relations"."related_task_id"),
	CONSTRAINT "task_relation_type_check" CHECK ("task_relations"."type" IN ('blocks', 'relates', 'duplicates'))
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"delivery_id" text PRIMARY KEY NOT NULL,
	"received_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "external_links" ADD COLUMN "sync_hash" text;--> statement-breakpoint
ALTER TABLE "mcp_oauth_access_tokens" ADD COLUMN "resource" text;--> statement-breakpoint
ALTER TABLE "mcp_oauth_access_tokens" ADD COLUMN "family_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_oauth_authorization_codes" ADD COLUMN "resource" text;--> statement-breakpoint
ALTER TABLE "mcp_oauth_authorization_codes" ADD COLUMN "token_family_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_oauth_refresh_tokens" ADD COLUMN "resource" text;--> statement-breakpoint
ALTER TABLE "mcp_oauth_refresh_tokens" ADD COLUMN "family_id" uuid;--> statement-breakpoint
ALTER TABLE "mcp_oauth_refresh_tokens" ADD COLUMN "rotated_at" timestamp;--> statement-breakpoint
ALTER TABLE "mcp_oauth_refresh_tokens" ADD COLUMN "rotation_grace_payload" text;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "next_task_seq" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "public_shares" ADD COLUMN "show_external_links" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "task_events" ADD COLUMN "metadata" jsonb;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "parent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "search_vector" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(description, '')), 'B')) STORED;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "completed_at" timestamp;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integration_oauth_states" ADD CONSTRAINT "integration_oauth_states_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_webhook_deliveries" ADD CONSTRAINT "outgoing_webhook_deliveries_webhook_id_outgoing_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."outgoing_webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_webhooks" ADD CONSTRAINT "outgoing_webhooks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outgoing_webhooks" ADD CONSTRAINT "outgoing_webhooks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_related_task_id_tasks_id_fk" FOREIGN KEY ("related_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_relations" ADD CONSTRAINT "task_relations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_rate_limits_last_request_idx" ON "auth_rate_limits" USING btree ("last_request");--> statement-breakpoint
CREATE INDEX "integration_oauth_state_expires_idx" ON "integration_oauth_states" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "job_pending_idx" ON "jobs" USING btree ("run_at") WHERE "jobs"."done_at" IS NULL AND "jobs"."failed_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_pending_job_key" ON "jobs" USING btree ("key") WHERE "jobs"."key" IS NOT NULL AND "jobs"."done_at" IS NULL AND "jobs"."failed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "job_done_idx" ON "jobs" USING btree ("done_at");--> statement-breakpoint
CREATE INDEX "notification_inbox_idx" ON "notifications" USING btree ("user_id","workspace_id","created_at","id");--> statement-breakpoint
CREATE INDEX "notification_unread_idx" ON "notifications" USING btree ("user_id","workspace_id") WHERE "notifications"."read_at" IS NULL AND "notifications"."archived_at" IS NULL;--> statement-breakpoint
CREATE INDEX "notification_task_idx" ON "notifications" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_notification_dedupe" ON "notifications" USING btree ("user_id","dedupe_key") WHERE "notifications"."dedupe_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "outgoing_webhook_delivery_webhook_idx" ON "outgoing_webhook_deliveries" USING btree ("webhook_id","created_at");--> statement-breakpoint
CREATE INDEX "outgoing_webhook_delivery_created_idx" ON "outgoing_webhook_deliveries" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "outgoing_webhook_workspace_idx" ON "outgoing_webhooks" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "share_pw_attempt_expiry_idx" ON "public_share_password_attempts" USING btree ("window_expires_at");--> statement-breakpoint
CREATE INDEX "rate_limit_counters_expires_idx" ON "rate_limit_counters" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "unique_task_relation" ON "task_relations" USING btree ("task_id","related_task_id","type");--> statement-breakpoint
CREATE INDEX "task_relation_related_idx" ON "task_relations" USING btree ("related_task_id");--> statement-breakpoint
CREATE INDEX "webhook_delivery_received_idx" ON "webhook_deliveries" USING btree ("received_at");--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_id_tasks_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mcp_oauth_access_token_family_idx" ON "mcp_oauth_access_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "mcp_oauth_refresh_token_family_idx" ON "mcp_oauth_refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE INDEX "task_event_task_created_idx" ON "task_events" USING btree ("task_id","created_at","id");--> statement-breakpoint
CREATE INDEX "task_parent_idx" ON "tasks" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "task_search_idx" ON "tasks" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "task_deleted_at_idx" ON "tasks" USING btree ("project_id","deleted_at");--> statement-breakpoint
CREATE INDEX "task_due_date_idx" ON "tasks" USING btree ("due_date");--> statement-breakpoint
ALTER TABLE "task_states" ADD CONSTRAINT "task_state_category_check" CHECK ("task_states"."category" IN ('backlog', 'in_progress', 'done'));--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "task_priority_check" CHECK ("tasks"."priority" IS NULL OR "tasks"."priority" IN ('urgent', 'high', 'medium', 'low', 'none'));
--> statement-breakpoint
-- ===== v2 data: task sequence counters =====
-- Backfill projects.next_task_seq = MAX(tasks.sequence_number) + 1 (never
-- lowering an existing counter). TaskService also self-heals with GREATEST()
-- at allocation time, so this is belt and braces.

ALTER TABLE projects ADD COLUMN IF NOT EXISTS next_task_seq integer NOT NULL DEFAULT 1;
--> statement-breakpoint
UPDATE projects p
SET next_task_seq = GREATEST(p.next_task_seq, s.max_seq + 1)
FROM (
  SELECT project_id, MAX(sequence_number) AS max_seq
  FROM tasks
  GROUP BY project_id
) s
WHERE s.project_id = p.id
  AND p.next_task_seq < s.max_seq + 1;
--> statement-breakpoint
-- ===== v2 data: byte-wise position ordering =====
-- Fractional-index keys must sort byte-wise (code-unit order, like JS `<`).
-- postgres:16-alpine initialises databases with en_US.utf8; musl happens to
-- compare bytes, but a glibc/Debian image or an ICU collation sorts "a" < "B",
-- which breaks mixed-case base-62 keys. Pin the column to COLLATE "C"
-- (drizzle cannot declare a collation; see the note on tasks.position in schema.ts).
-- Rewrites the column and rebuilds task_project_state_position_idx.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'tasks'
      AND column_name = 'position'
      AND coalesce(collation_name, '') <> 'C'
  ) THEN
    ALTER TABLE tasks ALTER COLUMN position TYPE text COLLATE "C";
  END IF;
END $$;
--> statement-breakpoint
-- ===== v2 data: unlogged rate-limit counters =====
-- rate_limit_counters is a cache (losing it on crash is fine), so make it
-- UNLOGGED: no WAL, much cheaper hot-path upserts. drizzle cannot express
-- UNLOGGED, so the table is created by the migration and switched here.
--

CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_counters (
  key text NOT NULL,
  bucket_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key, bucket_start)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS rate_limit_counters_expires_idx ON rate_limit_counters (expires_at);
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.rate_limit_counters'::regclass AND relpersistence <> 'u'
  ) THEN
    ALTER TABLE rate_limit_counters SET UNLOGGED;
  END IF;
END $$;
--> statement-breakpoint
-- ===== v2 data: GitHub external ids and configs =====
-- GitHub integration data backfill (v2). Idempotent: safe to run repeatedly.
-- Run after the schema migration that adds external_links.sync_hash,
-- webhook_deliveries and integration_oauth_states.
-- 1. Config: fold the legacy top-level {owner, repo, installationId} into repositories[].
UPDATE project_integrations pi
SET config = jsonb_set(
      pi.config,
      '{repositories}',
      COALESCE(CASE WHEN jsonb_typeof(pi.config -> 'repositories') = 'array' THEN pi.config -> 'repositories' END, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
             'owner', pi.config ->> 'owner',
             'repo', pi.config ->> 'repo',
             'installationId', (pi.config ->> 'installationId')::bigint,
             'linkedAt', NULL,
             'lastSyncAt', NULL,
             'syncStatus', 'idle',
             'syncError', NULL
           ))
    ),
    updated_at = now()
WHERE pi.integration_type = 'github'
  AND pi.config ? 'owner'
  AND pi.config ? 'repo'
  AND pi.config ->> 'installationId' ~ '^[0-9]+$'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(pi.config -> 'repositories') = 'array' THEN pi.config -> 'repositories' ELSE '[]'::jsonb END
    ) AS r
    WHERE lower(r ->> 'owner') = lower(pi.config ->> 'owner')
      AND lower(r ->> 'repo') = lower(pi.config ->> 'repo')
  );
--> statement-breakpoint
-- 2. Config: repository entries without their own installationId inherit the
--    legacy top-level one (they were linked under it).
UPDATE project_integrations pi
SET config = jsonb_set(
      pi.config,
      '{repositories}',
      (
        SELECT jsonb_agg(
          CASE WHEN r ? 'installationId' THEN r
               ELSE r || jsonb_build_object('installationId', (pi.config ->> 'installationId')::bigint)
          END
        )
        FROM jsonb_array_elements(pi.config -> 'repositories') AS r
      )
    ),
    updated_at = now()
WHERE pi.integration_type = 'github'
  AND jsonb_typeof(pi.config -> 'repositories') = 'array'
  AND pi.config ->> 'installationId' ~ '^[0-9]+$'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(pi.config -> 'repositories') AS r WHERE NOT r ? 'installationId');
--> statement-breakpoint
-- 3. Config: drop the legacy top-level keys once every repository carries its own
--    installation, so no code path can fall back to them.
UPDATE project_integrations pi
SET config = pi.config - 'owner' - 'repo' - 'installationId',
    updated_at = now()
WHERE pi.integration_type = 'github'
  AND (pi.config ? 'owner' OR pi.config ? 'repo' OR pi.config ? 'installationId')
  AND jsonb_typeof(pi.config -> 'repositories') = 'array'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pi.config -> 'repositories') AS r WHERE NOT r ? 'installationId');
--> statement-breakpoint
-- 4. External links: external_id becomes `owner/repo#N` (lower-cased), derived
--    from external_url, so issue numbers no longer collide across repositories.
UPDATE external_links
SET external_id =
      lower(substring(external_url FROM '^https://github\.com/([^/]+/[^/]+)/(?:issues|pull)/[0-9]+'))
      || '#' || external_id
WHERE external_type IN ('github_issue', 'github_pr')
  AND external_id ~ '^[0-9]+$'
  AND external_url ~ '^https://github\.com/[^/]+/[^/]+/(issues|pull)/[0-9]+';
--> statement-breakpoint
-- ===== v2 data: MCP OAuth token families =====
-- MCP OAuth hardening backfill (idempotent).
-- Run after the schema change that adds family_id / resource to the mcp_oauth_* tables.

-- 1. Each pre-rotation refresh token becomes the root of its own family.
UPDATE mcp_oauth_refresh_tokens
SET family_id = id
WHERE family_id IS NULL;
--> statement-breakpoint
-- 2. Access tokens inherit the family of the refresh token that points at them,
--    so revoking a refresh token also revokes its access tokens.
UPDATE mcp_oauth_access_tokens AS a
SET family_id = r.family_id
FROM mcp_oauth_refresh_tokens AS r
WHERE r.access_token_id = a.id
  AND a.family_id IS NULL
  AND r.family_id IS NOT NULL;
--> statement-breakpoint
-- ===== v2 data: authorization cleanup =====
-- v2 authorization data cleanup (idempotent; safe to run repeatedly).
--
-- Before v2, project ACL lists and smart-view shares accepted any user id,
-- and removing a workspace member left their project ACL rows behind. The
-- API now only allows workspace members in both, so drop rows that point at
-- users who are not members of the owning workspace.

DELETE FROM project_members pm
USING projects p
WHERE pm.project_id = p.id
  AND NOT EXISTS (
    SELECT 1
    FROM workspace_members wm
    WHERE wm.workspace_id = p.workspace_id
      AND wm.user_id = pm.user_id
  );
--> statement-breakpoint
DELETE FROM smart_view_shares svs
USING smart_views sv
WHERE svs.smart_view_id = sv.id
  AND NOT EXISTS (
    SELECT 1
    FROM workspace_members wm
    WHERE wm.workspace_id = sv.workspace_id
      AND wm.user_id = svs.shared_with_user_id
  );
--> statement-breakpoint
-- Labels attached to tasks of a different project (cross-project label bug).
DELETE FROM task_labels tl
USING tasks t, labels l
WHERE tl.task_id = t.id
  AND tl.label_id = l.id
  AND l.project_id <> t.project_id;
--> statement-breakpoint
-- Tasks pointing at a state of a different project move to their own
-- project's state of the same category, preferring the same name. Only when
-- the project has no state in that category does the task lose its state.
UPDATE tasks t
SET state_id = (
  SELECT own.id
  FROM task_states own
  WHERE own.project_id = t.project_id
    AND own.category = s.category
  ORDER BY (own.name = s.name) DESC, own.position COLLATE "C", own.id
  LIMIT 1
)
FROM task_states s
WHERE t.state_id = s.id
  AND s.project_id <> t.project_id;
--> statement-breakpoint
-- completed_at backfill: tasks already in a done-category state count as
-- completed at their last update. Runs after the state cleanup above.
UPDATE tasks t
SET completed_at = t.updated_at
FROM task_states s
WHERE t.state_id = s.id
  AND s.category = 'done'
  AND t.completed_at IS NULL;
