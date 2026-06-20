CREATE INDEX IF NOT EXISTS "task_project_state_position_idx" ON "tasks" USING btree ("project_id","state_id","position");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_label_label_idx" ON "task_labels" USING btree ("label_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "external_link_integration_idx" ON "external_links" USING btree ("integration_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "task_event_actor_idx" ON "task_events" USING btree ("actor_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "comment_user_idx" ON "comments" USING btree ("user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "smart_view_share_user_idx" ON "smart_view_shares" USING btree ("shared_with_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "public_share_smart_view_idx" ON "public_shares" USING btree ("smart_view_id");
