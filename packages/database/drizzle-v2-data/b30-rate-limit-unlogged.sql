-- Workstream B · run AFTER the v2 schema migration (idempotent).
--
-- rate_limit_counters is a cache (losing it on crash is fine), so make it
-- UNLOGGED: no WAL, much cheaper hot-path upserts. drizzle cannot express
-- UNLOGGED, so the table is created by the migration and switched here.
-- Creates the table too when running before the migration exists.

CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_counters (
  key text NOT NULL,
  bucket_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key, bucket_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_counters_expires_idx ON rate_limit_counters (expires_at);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class
    WHERE oid = 'public.rate_limit_counters'::regclass AND relpersistence <> 'u'
  ) THEN
    ALTER TABLE rate_limit_counters SET UNLOGGED;
  END IF;
END $$;
