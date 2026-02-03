-- Rename provider_account_id to account_id (Better Auth expects this field name)
ALTER TABLE "accounts" RENAME COLUMN "provider_account_id" TO "account_id";

-- Add id_token field (used by OAuth providers)
ALTER TABLE "accounts" ADD COLUMN "id_token" text;

-- Add password field (used for email/password auth)
ALTER TABLE "accounts" ADD COLUMN "password" text;

-- Update unique index to use new column name
DROP INDEX IF EXISTS "unique_provider_account";
CREATE UNIQUE INDEX "unique_provider_account" ON "accounts" ("provider_id", "account_id");
