import { and, desc, eq, inArray, isNull, max } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import {
  mcpOAuthAccessTokens,
  mcpOAuthClients,
  mcpOAuthConsents,
  mcpOAuthRefreshTokens,
  users,
  workspaceMembers,
  workspaces,
  type NewMcpOAuthConsent,
} from '../../db/schema.js';
import { OAuthError } from './errors.js';
import {
  TOOL_SCOPE_PREFIX,
  WORKSPACE_SCOPE_PREFIX,
  normalizeScopeString,
  normalizeScopes,
  parseStoredScopes,
  parseToolScopes,
  validateToolScopes,
} from './scopes.js';

export interface McpOAuthConnection {
  consentId: string;
  workspaceId: string;
  clientId: string;
  clientName: string;
  grantedBy: {
    id: string;
    email: string;
    name: string | null;
  };
  grantedByRole: string;
  toolScopes: string[];
  createdAt: Date;
  updatedAt: Date;
  revokedAt: Date | null;
  lastActivityAt: Date | null;
}

export async function listAuthorizableWorkspaces(db: Database, userId: string): Promise<Array<{ id: string; name: string; role: string }>> {
  const rows = await db
    .select({
      id: workspaces.id,
      name: workspaces.name,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
    .where(and(eq(workspaceMembers.userId, userId), inArray(workspaceMembers.role, ['owner', 'admin'])));

  return rows.map((row) => ({ id: row.id, name: row.name, role: row.role }));
}

export async function getUserWorkspaceRole(db: Database, workspaceId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({ role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));

  return row?.role || null;
}

export async function listWorkspaceConnections(db: Database, workspaceId: string): Promise<McpOAuthConnection[]> {
  const rows = await db
    .select({
      consentId: mcpOAuthConsents.id,
      workspaceId: mcpOAuthConsents.workspaceId,
      approvedScopes: mcpOAuthConsents.approvedScopes,
      grantedByRole: mcpOAuthConsents.grantedByRole,
      createdAt: mcpOAuthConsents.createdAt,
      updatedAt: mcpOAuthConsents.updatedAt,
      revokedAt: mcpOAuthConsents.revokedAt,
      clientInternalId: mcpOAuthConsents.clientId,
      clientPublicId: mcpOAuthClients.clientId,
      clientName: mcpOAuthClients.clientName,
      grantedById: users.id,
      grantedByEmail: users.email,
      grantedByName: users.name,
    })
    .from(mcpOAuthConsents)
    .innerJoin(mcpOAuthClients, eq(mcpOAuthConsents.clientId, mcpOAuthClients.id))
    .innerJoin(users, eq(mcpOAuthConsents.userId, users.id))
    .where(eq(mcpOAuthConsents.workspaceId, workspaceId))
    .orderBy(desc(mcpOAuthConsents.updatedAt));

  if (rows.length === 0) {
    return [];
  }

  const activityRows = await db
    .select({
      userId: mcpOAuthAccessTokens.userId,
      clientInternalId: mcpOAuthAccessTokens.clientId,
      workspaceId: mcpOAuthAccessTokens.workspaceId,
      lastActivityAt: max(mcpOAuthAccessTokens.createdAt),
    })
    .from(mcpOAuthAccessTokens)
    .where(eq(mcpOAuthAccessTokens.workspaceId, workspaceId))
    .groupBy(mcpOAuthAccessTokens.userId, mcpOAuthAccessTokens.clientId, mcpOAuthAccessTokens.workspaceId);

  const activityMap = new Map<string, Date | null>();
  for (const row of activityRows) {
    activityMap.set(`${row.userId}:${row.clientInternalId}:${row.workspaceId}`, row.lastActivityAt || null);
  }

  return rows.map((row) => {
    const scopes = parseStoredScopes(row.approvedScopes);
    const toolScopes = parseToolScopes(scopes);
    const key = `${row.grantedById}:${row.clientInternalId}:${row.workspaceId}`;

    return {
      consentId: row.consentId,
      workspaceId: row.workspaceId,
      clientId: row.clientPublicId,
      clientName: row.clientName,
      grantedBy: {
        id: row.grantedById,
        email: row.grantedByEmail,
        name: row.grantedByName,
      },
      grantedByRole: row.grantedByRole,
      toolScopes,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      revokedAt: row.revokedAt,
      lastActivityAt: activityMap.get(key) || null,
    };
  });
}

export async function updateConsentToolScopes(db: Database, input: {
  consentId: string;
  workspaceId: string;
  toolScopes: string[];
  actorUserId: string;
}): Promise<McpOAuthConnection> {
  const normalizedTools = normalizeScopes(input.toolScopes);
  if (normalizedTools.length === 0) {
    throw new OAuthError('invalid_scope', 'At least one tool scope is required');
  }

  const scopeValidation = validateToolScopes(normalizedTools.map((tool) => `${TOOL_SCOPE_PREFIX}${tool}`));
  if (!scopeValidation.ok) {
    throw new OAuthError('invalid_scope', `Unknown tool scopes: ${scopeValidation.invalidTools.join(', ')}`);
  }

  const result = await db.transaction(async (tx) => {
    const [consent] = await tx
      .select()
      .from(mcpOAuthConsents)
      .where(and(eq(mcpOAuthConsents.id, input.consentId), eq(mcpOAuthConsents.workspaceId, input.workspaceId)));

    if (!consent) {
      throw new OAuthError('not_found', 'OAuth connection not found', 404);
    }

    if (consent.revokedAt) {
      throw new OAuthError('invalid_request', 'OAuth connection is revoked', 400);
    }

    const existingScopes = parseStoredScopes(consent.approvedScopes);
    const workspaceScope = existingScopes.find((scope) => scope.startsWith(WORKSPACE_SCOPE_PREFIX));
    if (!workspaceScope) {
      throw new OAuthError('invalid_scope', 'Stored consent is missing workspace scope', 400);
    }

    const nextScopeString = normalizeScopeString([workspaceScope, ...normalizedTools.map((tool) => `${TOOL_SCOPE_PREFIX}${tool}`)].join(' '));
    const nextScopeArray = nextScopeString.split(' ').filter(Boolean);
    const now = new Date();

    await tx
      .update(mcpOAuthConsents)
      .set({
        approvedScopes: nextScopeArray,
        updatedAt: now,
      })
      .where(eq(mcpOAuthConsents.id, consent.id));

    await tx
      .update(mcpOAuthAccessTokens)
      .set({ scope: nextScopeString })
      .where(
        and(
          eq(mcpOAuthAccessTokens.userId, consent.userId),
          eq(mcpOAuthAccessTokens.clientId, consent.clientId),
          eq(mcpOAuthAccessTokens.workspaceId, consent.workspaceId),
          isNull(mcpOAuthAccessTokens.revokedAt)
        )
      );

    await tx
      .update(mcpOAuthRefreshTokens)
      .set({ scope: nextScopeString })
      .where(
        and(
          eq(mcpOAuthRefreshTokens.userId, consent.userId),
          eq(mcpOAuthRefreshTokens.clientId, consent.clientId),
          eq(mcpOAuthRefreshTokens.workspaceId, consent.workspaceId),
          isNull(mcpOAuthRefreshTokens.revokedAt)
        )
      );

    return {
      consentId: consent.id,
      clientInternalId: consent.clientId,
      userId: consent.userId,
    };
  });

  const workspaceConnections = await listWorkspaceConnections(db, input.workspaceId);
  const connection = workspaceConnections.find((connectionItem) => connectionItem.consentId === result.consentId);
  if (!connection) {
    throw new OAuthError('server_error', 'Failed to load updated OAuth connection', 500);
  }
  return connection;
}

export async function deleteConsent(db: Database, input: {
  consentId: string;
  workspaceId: string;
}): Promise<void> {
  await db.transaction(async (tx) => {
    const [consent] = await tx
      .select()
      .from(mcpOAuthConsents)
      .where(and(eq(mcpOAuthConsents.id, input.consentId), eq(mcpOAuthConsents.workspaceId, input.workspaceId)));

    if (!consent) {
      throw new OAuthError('not_found', 'OAuth connection not found', 404);
    }

    // Delete refresh tokens first (foreign key to access tokens)
    await tx.delete(mcpOAuthRefreshTokens).where(
      and(
        eq(mcpOAuthRefreshTokens.userId, consent.userId),
        eq(mcpOAuthRefreshTokens.clientId, consent.clientId),
        eq(mcpOAuthRefreshTokens.workspaceId, consent.workspaceId)
      )
    );

    // Delete access tokens
    await tx.delete(mcpOAuthAccessTokens).where(
      and(
        eq(mcpOAuthAccessTokens.userId, consent.userId),
        eq(mcpOAuthAccessTokens.clientId, consent.clientId),
        eq(mcpOAuthAccessTokens.workspaceId, consent.workspaceId)
      )
    );

    // Delete the consent record
    await tx.delete(mcpOAuthConsents).where(eq(mcpOAuthConsents.id, consent.id));
  });
}

export async function upsertConsent(
  db: Database,
  input: {
    userId: string;
    workspaceId: string;
    clientInternalId: string;
    approvedScopes: string[];
    grantedByRole: string;
  }
): Promise<void> {
  const now = new Date();
  const consentInsert: NewMcpOAuthConsent = {
    userId: input.userId,
    workspaceId: input.workspaceId,
    clientId: input.clientInternalId,
    approvedScopes: input.approvedScopes,
    grantedByRole: input.grantedByRole,
    createdAt: now,
    updatedAt: now,
  };

  await db
    .insert(mcpOAuthConsents)
    .values(consentInsert)
    .onConflictDoUpdate({
      target: [mcpOAuthConsents.userId, mcpOAuthConsents.workspaceId, mcpOAuthConsents.clientId],
      set: {
        approvedScopes: input.approvedScopes,
        grantedByRole: input.grantedByRole,
        revokedAt: null,
        updatedAt: now,
      },
    });
}
