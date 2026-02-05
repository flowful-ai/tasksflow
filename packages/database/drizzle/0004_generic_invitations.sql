-- Make email nullable for generic invite links
ALTER TABLE "workspace_invitations" ALTER COLUMN "email" DROP NOT NULL;
--> statement-breakpoint
-- Add max_uses column (null = unlimited)
ALTER TABLE "workspace_invitations" ADD COLUMN "max_uses" integer;
--> statement-breakpoint
-- Add uses_count column to track usage
ALTER TABLE "workspace_invitations" ADD COLUMN "uses_count" integer DEFAULT 0 NOT NULL;
