-- MCP OAuth hardening backfill (idempotent).
-- Run after the schema change that adds family_id / resource to the mcp_oauth_* tables.

-- 1. Each pre-rotation refresh token becomes the root of its own family.
UPDATE mcp_oauth_refresh_tokens
SET family_id = id
WHERE family_id IS NULL;

-- 2. Access tokens inherit the family of the refresh token that points at them,
--    so revoking a refresh token also revokes its access tokens.
UPDATE mcp_oauth_access_tokens AS a
SET family_id = r.family_id
FROM mcp_oauth_refresh_tokens AS r
WHERE r.access_token_id = a.id
  AND a.family_id IS NULL
  AND r.family_id IS NOT NULL;

-- 3. resource stays NULL on legacy rows on purpose: NULL means "issued before
--    RFC 8707 binding" and is accepted as the canonical MCP endpoint.
