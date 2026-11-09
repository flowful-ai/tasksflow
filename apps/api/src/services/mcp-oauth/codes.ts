import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { mcpOAuthAuthorizationCodes, type NewMcpOAuthAuthorizationCode } from '../../db/schema.js';
import { OAuthError } from './errors.js';
import { buildS256CodeChallenge, hashSecret } from './crypto.js';
import { randomToken } from '../../integrations/crypto.js';
import { normalizeScopeString } from './scopes.js';
import { normalizeResource, resolveRequestedResource } from './resource.js';
import { getClientByPublicId } from './clients.js';
import { issueTokenPair, revokeTokenFamily, type OAuthTokenResponse } from './tokens.js';

export const AUTH_CODE_TTL_SECONDS = 5 * 60;

export async function createAuthorizationCode(
  db: Database,
  input: {
    clientInternalId: string;
    userId: string;
    workspaceId: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge: string;
    codeChallengeMethod: 'S256';
    resource: string;
  }
): Promise<string> {
  const code = randomToken(32);

  const insertData: NewMcpOAuthAuthorizationCode = {
    clientId: input.clientInternalId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    codeHash: hashSecret(code),
    redirectUri: input.redirectUri,
    scope: normalizeScopeString(input.scopes.join(' ')),
    codeChallenge: input.codeChallenge,
    codeChallengeMethod: input.codeChallengeMethod,
    resource: input.resource,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000),
    createdAt: new Date(),
  };

  await db.insert(mcpOAuthAuthorizationCodes).values(insertData);
  return code;
}

/**
 * Redeems an authorization code exactly once. The single conditional UPDATE is
 * the only gate, so two concurrent requests cannot both succeed: the loser
 * blocks on the row lock, re-evaluates `used_at IS NULL` and gets no row.
 * A replayed code revokes every token issued from it (RFC 6749 §4.1.2).
 */
export async function exchangeAuthorizationCode(
  db: Database,
  input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
    resource?: string[];
    baseUrl: string;
  }
): Promise<OAuthTokenResponse> {
  const client = await getClientByPublicId(db, input.clientId);
  if (!client) {
    throw new OAuthError('invalid_client', 'Unknown client_id', 401);
  }

  const codeHash = hashSecret(input.code);
  const expectedChallenge = buildS256CodeChallenge(input.codeVerifier);
  const requestedResource =
    input.resource && input.resource.length > 0
      ? resolveRequestedResource(input.resource, input.baseUrl)
      : null;
  const familyId = randomUUID();
  const now = new Date();

  const issued = await db.transaction(async (tx) => {
    const [authCode] = await tx
      .update(mcpOAuthAuthorizationCodes)
      .set({ usedAt: now, tokenFamilyId: familyId })
      .where(
        and(
          eq(mcpOAuthAuthorizationCodes.codeHash, codeHash),
          isNull(mcpOAuthAuthorizationCodes.usedAt),
          gt(mcpOAuthAuthorizationCodes.expiresAt, now),
          eq(mcpOAuthAuthorizationCodes.clientId, client.id),
          eq(mcpOAuthAuthorizationCodes.redirectUri, input.redirectUri),
          eq(mcpOAuthAuthorizationCodes.codeChallenge, expectedChallenge)
        )
      )
      .returning();

    if (!authCode) {
      return null;
    }

    const boundResource = authCode.resource ?? resolveRequestedResource([], input.baseUrl);
    if (requestedResource && normalizeResource(boundResource) !== requestedResource) {
      throw new OAuthError('invalid_target', 'resource does not match the authorization request');
    }

    return issueTokenPair(tx, {
      clientInternalId: client.id,
      userId: authCode.userId,
      workspaceId: authCode.workspaceId,
      scope: authCode.scope,
      resource: boundResource,
      familyId,
      now,
    });
  });

  if (issued) {
    return issued.response;
  }

  // Diagnose why the conditional update matched nothing.
  const [existing] = await db
    .select()
    .from(mcpOAuthAuthorizationCodes)
    .where(eq(mcpOAuthAuthorizationCodes.codeHash, codeHash));

  if (!existing) {
    throw new OAuthError('invalid_grant', 'Authorization code is invalid');
  }

  if (existing.usedAt) {
    if (existing.tokenFamilyId) {
      await revokeTokenFamily(db, existing.tokenFamilyId);
    }
    console.warn('MCP OAuth authorization code replay detected; issued tokens revoked', {
      codeId: existing.id,
    });
    throw new OAuthError('invalid_grant', 'Authorization code has already been used');
  }

  if (existing.expiresAt <= now) {
    throw new OAuthError('invalid_grant', 'Authorization code has expired');
  }

  if (existing.clientId !== client.id) {
    throw new OAuthError('invalid_grant', 'Authorization code was issued to another client');
  }

  if (existing.redirectUri !== input.redirectUri) {
    throw new OAuthError('invalid_grant', 'redirect_uri mismatch');
  }

  throw new OAuthError('invalid_grant', 'Invalid code_verifier');
}
