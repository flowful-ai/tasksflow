-- GitHub integration data backfill (v2). Idempotent: safe to run repeatedly.
-- Run after the schema migration that adds external_links.sync_hash,
-- webhook_deliveries and integration_oauth_states.

BEGIN;

-- 1. Config: fold the legacy top-level {owner, repo, installationId} into repositories[].
UPDATE project_integrations pi
SET config = jsonb_set(
      pi.config,
      '{repositories}',
      COALESCE(CASE WHEN jsonb_typeof(pi.config -> 'repositories') = 'array' THEN pi.config -> 'repositories' END, '[]'::jsonb)
        || jsonb_build_array(jsonb_build_object(
             'owner', pi.config ->> 'owner',
             'repo', pi.config ->> 'repo',
             'installationId', (pi.config ->> 'installationId')::bigint,
             'linkedAt', NULL,
             'lastSyncAt', NULL,
             'syncStatus', 'idle',
             'syncError', NULL
           ))
    ),
    updated_at = now()
WHERE pi.integration_type = 'github'
  AND pi.config ? 'owner'
  AND pi.config ? 'repo'
  AND pi.config ->> 'installationId' ~ '^[0-9]+$'
  AND NOT EXISTS (
    SELECT 1
    FROM jsonb_array_elements(
      CASE WHEN jsonb_typeof(pi.config -> 'repositories') = 'array' THEN pi.config -> 'repositories' ELSE '[]'::jsonb END
    ) AS r
    WHERE lower(r ->> 'owner') = lower(pi.config ->> 'owner')
      AND lower(r ->> 'repo') = lower(pi.config ->> 'repo')
  );

-- 2. Config: repository entries without their own installationId inherit the
--    legacy top-level one (they were linked under it).
UPDATE project_integrations pi
SET config = jsonb_set(
      pi.config,
      '{repositories}',
      (
        SELECT jsonb_agg(
          CASE WHEN r ? 'installationId' THEN r
               ELSE r || jsonb_build_object('installationId', (pi.config ->> 'installationId')::bigint)
          END
        )
        FROM jsonb_array_elements(pi.config -> 'repositories') AS r
      )
    ),
    updated_at = now()
WHERE pi.integration_type = 'github'
  AND jsonb_typeof(pi.config -> 'repositories') = 'array'
  AND pi.config ->> 'installationId' ~ '^[0-9]+$'
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(pi.config -> 'repositories') AS r WHERE NOT r ? 'installationId');

-- 3. Config: drop the legacy top-level keys once every repository carries its own
--    installation, so no code path can fall back to them.
UPDATE project_integrations pi
SET config = pi.config - 'owner' - 'repo' - 'installationId',
    updated_at = now()
WHERE pi.integration_type = 'github'
  AND (pi.config ? 'owner' OR pi.config ? 'repo' OR pi.config ? 'installationId')
  AND jsonb_typeof(pi.config -> 'repositories') = 'array'
  AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(pi.config -> 'repositories') AS r WHERE NOT r ? 'installationId');

-- 4. External links: external_id becomes `owner/repo#N` (lower-cased), derived
--    from external_url, so issue numbers no longer collide across repositories.
UPDATE external_links
SET external_id =
      lower(substring(external_url FROM '^https://github\.com/([^/]+/[^/]+)/(?:issues|pull)/[0-9]+'))
      || '#' || external_id
WHERE external_type IN ('github_issue', 'github_pr')
  AND external_id ~ '^[0-9]+$'
  AND external_url ~ '^https://github\.com/[^/]+/[^/]+/(issues|pull)/[0-9]+';

COMMIT;
