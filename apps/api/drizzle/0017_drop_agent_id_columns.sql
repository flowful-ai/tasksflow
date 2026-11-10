ALTER TABLE "comments" DROP CONSTRAINT "comments_agent_id_workspace_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_agent_id_workspace_agents_id_fk";
--> statement-breakpoint
ALTER TABLE "comments" DROP COLUMN "agent_id";--> statement-breakpoint
ALTER TABLE "tasks" DROP COLUMN "agent_id";