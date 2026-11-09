CREATE TABLE "github_installations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"installation_id" integer NOT NULL,
	"account_login" text,
	"account_type" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspace_invitations" ALTER COLUMN "email" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD COLUMN IF NOT EXISTS "max_uses" integer;--> statement-breakpoint
ALTER TABLE "workspace_invitations" ADD COLUMN IF NOT EXISTS "uses_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unique_user_installation" ON "github_installations" USING btree ("user_id","installation_id");--> statement-breakpoint
CREATE INDEX "github_installation_user_idx" ON "github_installations" USING btree ("user_id");
