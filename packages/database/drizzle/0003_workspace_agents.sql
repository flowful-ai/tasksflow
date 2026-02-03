-- Create workspace_agents table (MCP API tokens scoped to workspace with optional project restrictions)
CREATE TABLE "workspace_agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"restricted_project_ids" jsonb,
	"name" text NOT NULL,
	"description" text,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"last_used_at" timestamp,
	"permissions" jsonb DEFAULT '[]' NOT NULL,
	"tokens_per_day" integer DEFAULT 100000 NOT NULL,
	"current_day_tokens" integer DEFAULT 0 NOT NULL,
	"last_token_reset" timestamp DEFAULT now(),
	"is_active" boolean DEFAULT true NOT NULL,
	"expires_at" timestamp,
	"created_by" uuid,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_agents" ADD CONSTRAINT "workspace_agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "workspace_agents" ADD CONSTRAINT "workspace_agents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "workspace_agent_workspace_idx" ON "workspace_agents" USING btree ("workspace_id");
--> statement-breakpoint
CREATE INDEX "workspace_agent_prefix_idx" ON "workspace_agents" USING btree ("token_prefix");
--> statement-breakpoint
CREATE INDEX "workspace_agent_expires_idx" ON "workspace_agents" USING btree ("expires_at");
