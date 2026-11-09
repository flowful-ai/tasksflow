import { randomUUID } from 'node:crypto';
import { and, eq, gt, isNull, or } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { mcpOAuthAccessTokens, mcpOAuthClients, mcpOAuthRefreshTokens } from '../../db/schema.js';
import type { AgentTool } from '@flowtask/shared';
import { OAuthError } from './errors.js';
import { hashSecret, openWithSecret, randomOpaqueToken, sealWithSecret } from './crypto.js';
import {
  expandToolPermissions,
  hasExactlyOneWorkspaceScope,
  isSubset,
  normalizeScopeString,
  parseToolScopes,
  parseWorkspaceScope,
  splitScopeString,
  validateToolScopePresence,
  validateToolScopes,
} from './scopes.js';
import { normalizeResource, resolveRequestedResource, tokenResourceMatches } from './resource.js';
import { getClientByPublicId } from './clients.js';

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
/** Concurrent refreshes of the same token inside this window get the same successor. */
export const REFRESH_REUSE_GRACE_SECONDS = 30;

export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];
export type DbExecutor = Database | DbTransaction;

export interface OAuthTokenResponse {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  refresh_token: string;
  scope: string;
}

export interface OAuthMcpAuthContext {
  accessTokenId: string;
  userId: string;
  workspaceId: string;
  scopes: string[];
  toolPermissions: AgentTool[];
  clientId: string;
  clientName: string;
  resource: string | null;
}

function nowPlusSeconds(seconds: number, from = Date.now()): Date {
  return new Date(from + seconds * 1000);
}

export async function issueTokenPair(
  db: DbExecutor,
  input: {
    clientInternalId: string;
    userId: string;
    workspaceId: string;
    scope: string;
    resource: string;
    familyId: string;
    now: Date;
    refreshTokenId?: string;
  }
): Promise<{ response: OAuthTokenResponse; refreshTokenId: string; accessTokenId: string }> {
  const accessToken = randomOpaqueToken(32);
  const refreshToken = randomOpaqueToken(32);
  const refreshTokenId = input.refreshTokenId ?? randomUUID();

  const [accessRow] = await db
    .insert(mcpOAuthAccessTokens)
    .values({
      clientId: input.clientInternalId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      tokenHash: hashSecret(accessToken),
      scope: input.scope,
      resource: input.resource,
      familyId: input.familyId,
      expiresAt: nowPlusSeconds(ACCESS_TOKEN_TTL_SECONDS, input.now.getTime()),
      createdAt: input.now,
    })
    .returning({ id: mcpOAuthAccessTokens.id });
  if (!accessRow) {
    throw new OAuthError('server_error', 'Failed to create access token', 500);
  }

  await db.insert(mcpOAuthRefreshTokens).values({
    id: refreshTokenId,
    accessTokenId: accessRow.id,
    clientId: input.clientInternalId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    tokenHash: hashSecret(refreshToken),
    scope: input.scope,
    resource: input.resource,
    familyId: input.familyId,
    expiresAt: nowPlusSeconds(REFRESH_TOKEN_TTL_SECONDS, input.now.getTime()),
    createdAt: input.now,
  });

  return {
    refreshTokenId,
    accessTokenId: accessRow.id,
    response: {
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: input.scope,
    },
  };
}

/** Revokes every refresh and access token of a family (plus a legacy access token link). */
export async function revokeTokenFamily(
  db: DbExecutor,
  familyId: string,
  options: { legacyAccessTokenId?: string | null; now?: Date } = {}
): Promise<void> {
  const now = options.now ?? new Date();
  await db
    .update(mcpOAuthRefreshTokens)
    .set({ revokedAt: now, rotationGracePayload: null })
    .where(and(eq(mcpOAuthRefreshTokens.familyId, familyId), isNull(mcpOAuthRefreshTokens.revokedAt)));

  const accessCondition = options.legacyAccessTokenId
    ? or(eq(mcpOAuthAccessTokens.familyId, familyId), eq(mcpOAuthAccessTokens.id, options.legacyAccessTokenId))
    : eq(mcpOAuthAccessTokens.familyId, familyId);
  await db
    .update(mcpOAuthAccessTokens)
    .set({ revokedAt: now })
    .where(and(accessCondition, isNull(mcpOAuthAccessTokens.revokedAt)));
}

const GracePayloadSchema = z.object({
  access_token: z.string(),
  refresh_token: z.string(),
  scope: z.string(),
  access_expires_at: z.number(),
});

function sealGracePayload(presentedToken: string, response: OAuthTokenResponse, accessExpiresAt: number): string {
  return sealWithSecret(
    presentedToken,
    JSON.stringify({
      access_token: response.access_token,
      refresh_token: response.refresh_token,
      scope: response.scope,
      access_expires_at: accessExpiresAt,
    })
  );
}

export function openGracePayload(presentedToken: string, sealed: string, now: Date): OAuthTokenResponse | null {
  const plaintext = openWithSecret(presentedToken, sealed);
  if (!plaintext) {
    return null;
  }
  let json: unknown;
  try {
    json = JSON.parse(plaintext);
  } catch {
    return null;
  }
  const parsed = GracePayloadSchema.safeParse(json);
  if (!parsed.success) {
    return null;
  }
  return {
    access_token: parsed.data.access_token,
    token_type: 'Bearer',
    expires_in: Math.max(0, Math.floor((parsed.data.access_expires_at - now.getTime()) / 1000)),
    refresh_token: parsed.data.refresh_token,
    scope: parsed.data.scope,
  };
}

type RefreshOutcome =
  | { kind: 'issued'; response: OAuthTokenResponse }
  | { kind: 'reuse'; familyId: string; legacyAccessTokenId: string | null };

/**
 * Refresh-token rotation (OAuth 2.1 §4.3.1): every use returns a new refresh
 * token. Presenting an already-rotated token outside the grace window is
 * treated as theft and revokes the whole family.
 */
export async function refreshAccessToken(
  db: Database,
  input: { refreshToken: string; clientId: string; scope?: string; resource?: string[]; baseUrl: string },
  clock: () => Date = () => new Date()
): Promise<OAuthTokenResponse> {
  const client = await getClientByPublicId(db, input.clientId);
  if (!client) {
    throw new OAuthError('invalid_client', 'Unknown client_id', 401);
  }

  const tokenHash = hashSecret(input.refreshToken);
  const now = clock();

  const outcome = await db.transaction(async (tx): Promise<RefreshOutcome> => {
    const [row] = await tx
      .select()
      .from(mcpOAuthRefreshTokens)
      .where(eq(mcpOAuthRefreshTokens.tokenHash, tokenHash))
      .for('update');

    if (!row || row.clientId !== client.id) {
      throw new OAuthError('invalid_grant', 'Invalid refresh token');
    }
    if (row.revokedAt) {
      throw new OAuthError('invalid_grant', 'Refresh token has been revoked');
    }
    if (row.expiresAt <= now) {
      throw new OAuthError('invalid_grant', 'Refresh token has expired');
    }

    const familyId = row.familyId ?? row.id;

    if (row.rotatedAt) {
      const ageMs = now.getTime() - row.rotatedAt.getTime();
      if (ageMs <= REFRESH_REUSE_GRACE_SECONDS * 1000 && row.rotationGracePayload) {
        const successor = openGracePayload(input.refreshToken, row.rotationGracePayload, now);
        if (successor) {
          return { kind: 'issued', response: successor };
        }
      }
      return { kind: 'reuse', familyId, legacyAccessTokenId: row.accessTokenId };
    }

    const currentScopes = splitScopeString(row.scope);
    const nextScopes = input.scope ? splitScopeString(input.scope) : currentScopes;

    if (!isSubset(nextScopes, currentScopes)) {
      throw new OAuthError('invalid_scope', 'Requested scope must be a subset of granted scopes');
    }
    if (!hasExactlyOneWorkspaceScope(nextScopes)) {
      throw new OAuthError('invalid_scope', 'Exactly one workspace scope is required');
    }
    validateToolScopePresence(nextScopes, 'invalid_scope');
    const toolValidation = validateToolScopes(nextScopes);
    if (!toolValidation.ok) {
      throw new OAuthError('invalid_scope', `Unknown tool scopes: ${toolValidation.invalidTools.join(', ')}`);
    }

    const boundResource = row.resource ?? resolveRequestedResource([], input.baseUrl);
    if (input.resource && input.resource.length > 0) {
      const requested = resolveRequestedResource(input.resource, input.baseUrl);
      if (normalizeResource(boundResource) !== requested) {
        throw new OAuthError('invalid_target', 'resource does not match the original grant');
      }
    }

    const issued = await issueTokenPair(tx, {
      clientInternalId: client.id,
      userId: row.userId,
      workspaceId: row.workspaceId,
      scope: normalizeScopeString(nextScopes.join(' ')),
      resource: boundResource,
      familyId,
      now,
    });

    await tx
      .update(mcpOAuthRefreshTokens)
      .set({
        familyId,
        rotatedAt: now,
        replacedByTokenId: issued.refreshTokenId,
        rotationGracePayload: sealGracePayload(
          input.refreshToken,
          issued.response,
          now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000
        ),
      })
      .where(eq(mcpOAuthRefreshTokens.id, row.id));

    return { kind: 'issued', response: issued.response };
  });

  if (outcome.kind === 'reuse') {
    await revokeTokenFamily(db, outcome.familyId, { legacyAccessTokenId: outcome.legacyAccessTokenId, now });
    console.warn('MCP OAuth refresh token reuse detected; token family revoked', { familyId: outcome.familyId });
    throw new OAuthError('invalid_grant', 'Refresh token has already been used');
  }

  return outcome.response;
}

/** RFC 7009 revocation. Revoking a refresh token revokes its whole family, access tokens included. */
export async function revokeToken(
  db: Database,
  input: { token: string; tokenTypeHint?: 'access_token' | 'refresh_token'; clientId?: string }
): Promise<void> {
  const tokenHash = hashSecret(input.token);
  const now = new Date();

  const tryRevokeAccess = async (): Promise<boolean> => {
    const [row] = await db
      .select({ id: mcpOAuthAccessTokens.id, clientId: mcpOAuthClients.clientId })
      .from(mcpOAuthAccessTokens)
      .innerJoin(mcpOAuthClients, eq(mcpOAuthAccessTokens.clientId, mcpOAuthClients.id))
      .where(eq(mcpOAuthAccessTokens.tokenHash, tokenHash));

    if (!row || (input.clientId && row.clientId !== input.clientId)) {
      return false;
    }

    await db.update(mcpOAuthAccessTokens).set({ revokedAt: now }).where(eq(mcpOAuthAccessTokens.id, row.id));
    return true;
  };

  const tryRevokeRefresh = async (): Promise<boolean> => {
    const [row] = await db
      .select({
        id: mcpOAuthRefreshTokens.id,
        familyId: mcpOAuthRefreshTokens.familyId,
        accessTokenId: mcpOAuthRefreshTokens.accessTokenId,
        clientId: mcpOAuthClients.clientId,
      })
      .from(mcpOAuthRefreshTokens)
      .innerJoin(mcpOAuthClients, eq(mcpOAuthRefreshTokens.clientId, mcpOAuthClients.id))
      .where(eq(mcpOAuthRefreshTokens.tokenHash, tokenHash));

    if (!row || (input.clientId && row.clientId !== input.clientId)) {
      return false;
    }

    const familyId = row.familyId ?? row.id;
    await db.update(mcpOAuthRefreshTokens).set({ familyId }).where(eq(mcpOAuthRefreshTokens.id, row.id));
    await revokeTokenFamily(db, familyId, { legacyAccessTokenId: row.accessTokenId, now });
    return true;
  };

  if (input.tokenTypeHint === 'refresh_token') {
    if (!(await tryRevokeRefresh())) {
      await tryRevokeAccess();
    }
    return;
  }

  if (!(await tryRevokeAccess())) {
    await tryRevokeRefresh();
  }
}

export async function authenticateAccessToken(
  db: Database,
  token: string,
  options: { baseUrl: string }
): Promise<OAuthMcpAuthContext> {
  const tokenHash = hashSecret(token);
  const now = new Date();

  const [row] = await db
    .select({
      accessTokenId: mcpOAuthAccessTokens.id,
      userId: mcpOAuthAccessTokens.userId,
      workspaceId: mcpOAuthAccessTokens.workspaceId,
      scope: mcpOAuthAccessTokens.scope,
      resource: mcpOAuthAccessTokens.resource,
      clientId: mcpOAuthClients.clientId,
      clientName: mcpOAuthClients.clientName,
    })
    .from(mcpOAuthAccessTokens)
    .innerJoin(mcpOAuthClients, eq(mcpOAuthAccessTokens.clientId, mcpOAuthClients.id))
    .where(
      and(
        eq(mcpOAuthAccessTokens.tokenHash, tokenHash),
        isNull(mcpOAuthAccessTokens.revokedAt),
        gt(mcpOAuthAccessTokens.expiresAt, now)
      )
    );

  if (!row) {
    throw new OAuthError('invalid_token', 'Access token is invalid or expired', 401);
  }

  if (!tokenResourceMatches(row.resource, options.baseUrl)) {
    throw new OAuthError('invalid_token', 'Access token was issued for a different resource', 401);
  }

  const scopes = splitScopeString(row.scope);

  if (!hasExactlyOneWorkspaceScope(scopes)) {
    throw new OAuthError('invalid_token', 'Token has invalid workspace scopes', 401);
  }

  const workspaceId = parseWorkspaceScope(scopes);
  if (!workspaceId || workspaceId !== row.workspaceId) {
    throw new OAuthError('invalid_token', 'Token workspace scope does not match token binding', 401);
  }

  validateToolScopePresence(scopes, 'invalid_token');

  const toolValidation = validateToolScopes(scopes);
  if (!toolValidation.ok) {
    throw new OAuthError('invalid_token', 'Token includes unsupported tool scopes', 401);
  }

  return {
    accessTokenId: row.accessTokenId,
    userId: row.userId,
    workspaceId,
    scopes,
    toolPermissions: expandToolPermissions(parseToolScopes(scopes)),
    clientId: row.clientId,
    clientName: row.clientName,
    resource: row.resource,
  };
}
