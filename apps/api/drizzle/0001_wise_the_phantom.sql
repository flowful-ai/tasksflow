ALTER TABLE "comments" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "tasks" ADD COLUMN "agent_id" uuid;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_agent_id_workspace_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspace_agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agent_id_workspace_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."workspace_agents"("id") ON DELETE set null ON UPDATE no action;