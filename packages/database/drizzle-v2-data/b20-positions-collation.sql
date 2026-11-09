-- Workstream B · run AFTER the v2 schema migration (idempotent).
--
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

-- After this, re-key columns that hold keys written by the pre-v2 generator:
--   DATABASE_URL=... bun packages/database/scripts/rekey-positions.ts
