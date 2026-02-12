ALTER TABLE "workspaces" ADD COLUMN "allowed_agent_models" jsonb;--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "default_agent_id" uuid;