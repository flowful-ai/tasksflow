ALTER TABLE "smart_views" ADD COLUMN "secondary_group_by" text;

UPDATE "smart_views" SET "group_by" = 'state' WHERE "group_by" IS NULL;

ALTER TABLE "smart_views" ALTER COLUMN "group_by" SET DEFAULT 'state';
ALTER TABLE "smart_views" ALTER COLUMN "group_by" SET NOT NULL;
