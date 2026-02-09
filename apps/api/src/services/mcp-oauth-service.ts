import { randomBytes, createHash } from 'node:crypto';
import { and, desc, eq, gt, inArray, isNull, max } from 'drizzle-orm';
import { getDatabase } from '@flowtask/database';
import {
  mcpOAuthClients,
  mcpOAuthConsents,
  mcpOAuthAuthorizationCodes,
  mcpOAuthAccessTokens,
  mcpOAuthRefreshTokens,
  workspaceMembers,
  workspaces,
  users,
} from '@flowtask/database/schema';
import type {
  McpOAuthClient,
  NewMcpOAuthClient,
  NewMcpOAuthConsent,
  NewMcpOAuthAuthorizationCode,
  NewMcpOAuthAccessToken,
  NewMcpOAuthRefreshToken,
} from '@flowtask/database/schema';
import { AgentToolSchema } from '@flowtask/shared';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;
const AUTH_CODE_TTL_SECONDS = 5 * 60;

const TOOL_SCOPE_PREFIX = 'mcp:tool:';
const WORKSPACE_SCOPE_PREFIX = 'mcp:workspace:';
const ALLOWED_ADMIN_ROLES = new Set(['owner', 'admin']);

const agentTools = AgentToolSchema.options;

function nowPlusSeconds(seconds: number): Date {
  return new Date(Date.now() + seconds * 1000);
}

function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function randomOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

function randomClientId(): string {
  return `ft_mcp_client_${randomOpaqueToken(24)}`;
}

function normalizeScopeString(scope: string): string {
  return Array.from(new Set(scope.split(/\s+/).filter(Boolean))).join(' ');
}

export function buildS256CodeChallenge(codeVerifier: string): string {
  return createHash('sha256').update(codeVerifier).digest('base64url');
}

function isSubset(subset: string[], superset: string[]): boolean {
  const supersetSet = new Set(superset);
  return subset.every((item) => supersetSet.has(item));
}

function hasExactlyOneWorkspaceScope(scopes: string[]): boolean {
  return scopes.filter((scope) => scope.startsWith(WORKSPACE_SCOPE_PREFIX)).length === 1;
}

function parseWorkspaceScope(scopes: string[]): string | null {
  const workspaceScopes = scopes.filter((scope) => scope.startsWith(WORKSPACE_SCOPE_PREFIX));
  if (workspaceScopes.length !== 1) {
    return null;
  }
  const workspaceScope = workspaceScopes[0];
  if (!workspaceScope) {
    return null;
  }
  const workspaceId = workspaceScope.slice(WORKSPACE_SCOPE_PREFIX.length);
  return workspaceId || null;
}

function parseToolScopes(scopes: string[]): string[] {
  return scopes
    .filter((scope) => scope.startsWith(TOOL_SCOPE_PREFIX))
    .map((scope) => scope.slice(TOOL_SCOPE_PREFIX.length));
}

function validateToolScopes(scopes: string[]): { ok: boolean; invalidTools: string[] } {
  const toolScopes = parseToolScopes(scopes);
  const invalidTools = toolScopes.filter((tool) => !agentTools.includes(tool as (typeof agentTools)[number]));
  return { ok: invalidTools.length === 0, invalidTools };
}

function parseStoredScopes(rawScopes: unknown): string[] {
  if (!Array.isArray(rawScopes)) {
    return [];
  }

  return rawScopes.filter((scope): scope is string => typeof scope === 'string');
}

function buildScopeString(workspaceId: string, toolScopes: string[]): string {
  const normalizedToolScopes = normalizeScopes(toolScopes.map((tool) => `${TOOL_SCOPE_PREFIX}${tool}`));
  return normalizeScopeString([`${WORKSPACE_SCOPE_PREFIX}${workspaceId}`, ...normalizedToolScopes].join(' '));
}

export function validateRequestedMcpScopes(scope: string): { scopes: string[]; workspaceId: string; toolScopes: string[] } {
  const scopes = normalizeScopeString(scope).split(' ').filter(Boolean);

  if (!hasExactlyOneWorkspaceScope(scopes)) {
    throw new OAuthError('invalid_scope', 'Exactly one workspace scope is required');
  }

  const toolScopes = parseToolScopes(scopes);
  if (toolScopes.length === 0) {
    throw new OAuthError('invalid_scope', 'At least one tool scope is required');
  }

  const validation = validateToolScopes(scopes);
  if (!validation.ok) {
    throw new OAuthError('invalid_scope', `Unknown tool scopes: ${validation.invalidTools.join(', ')}`);
  }

  const workspaceId = parseWorkspaceScope(scopes);
  if (!workspaceId) {
    throw new OAuthError('invalid_scope', 'Invalid workspace scope');
  }

  return {
    scopes,
    workspaceId,
    toolScopes,
  };
}

export function isAuthorizingRole(role: string | null): boolean {
  return Boolean(role && ALLOWED_ADMIN_ROLES.has(role));
}

export function getAllMcpToolNames(): string[] {
  return [...agentTools];
}

export interface McpOAuthClientRegistrationInput {
  client_name: string;
  redirect_uris: string[];
  grant_types?: string[];
  response_types?: string[];
  token_endpoint_auth_method?: string;
  scope?: string;
  client_uri?: string;
  logo_uri?: string;
  tos_uri?: string;
  policy_uri?: string;
}

export interface OAuthMcpAuthContext {
  accessTokenId: string;
  userId: string;
  workspaceId: string;
  scopes: string[];
  toolPermissions: string[];
  clientId: string;
}

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

export class OAuthError extends Error {
  public readonly statusCode: number;
  public readonly oauthError: string;

  constructor(oauthError: string, message: string, statusCode = 400) {
    super(message);
    this.name = 'OAuthError';
    this.statusCode = statusCode;
    this.oauthError = oauthError;
  }
}

export class McpOAuthService {
  private readonly db = getDatabase();

  getAuthorizationServerMetadata(baseUrl: string) {
    const issuer = baseUrl;
    return {
      issuer,
      authorization_endpoint: `${baseUrl}/api/mcp/oauth/authorize`,
      token_endpoint: `${baseUrl}/api/mcp/oauth/token`,
      registration_endpoint: `${baseUrl}/api/mcp/oauth/register`,
      revocation_endpoint: `${baseUrl}/api/mcp/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      token_endpoint_auth_methods_supported: ['none'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: [
        `${WORKSPACE_SCOPE_PREFIX}{workspaceId}`,
        ...agentTools.map((tool) => `${TOOL_SCOPE_PREFIX}${tool}`),
      ],
    };
  }

  getProtectedResourceMetadata(baseUrl: string) {
    return {
      resource: `${baseUrl}/api/mcp/sse`,
      authorization_servers: [baseUrl],
      scopes_supported: [
        `${WORKSPACE_SCOPE_PREFIX}{workspaceId}`,
        ...agentTools.map((tool) => `${TOOL_SCOPE_PREFIX}${tool}`),
      ],
      bearer_methods_supported: ['header'],
    };
  }

  async registerClient(input: McpOAuthClientRegistrationInput) {
    if (!input.client_name?.trim()) {
      throw new OAuthError('invalid_client_metadata', 'client_name is required');
    }

    if (!Array.isArray(input.redirect_uris) || input.redirect_uris.length === 0) {
      throw new OAuthError('invalid_redirect_uri', 'redirect_uris must contain at least one URI');
    }

    if ((input.token_endpoint_auth_method || 'none') !== 'none') {
      throw new OAuthError('invalid_client_metadata', 'Only token_endpoint_auth_method=none is supported');
    }

    if (input.grant_types && !isSubset(input.grant_types, ['authorization_code', 'refresh_token'])) {
      throw new OAuthError('invalid_client_metadata', 'Unsupported grant_types requested');
    }

    if (input.response_types && !isSubset(input.response_types, ['code'])) {
      throw new OAuthError('invalid_client_metadata', 'Unsupported response_types requested');
    }

    const clientId = randomClientId();
    const now = new Date();

    const insertData: NewMcpOAuthClient = {
      clientId,
      clientName: input.client_name.trim(),
      redirectUris: input.redirect_uris,
      grantTypes: input.grant_types || ['authorization_code', 'refresh_token'],
      responseTypes: input.response_types || ['code'],
      tokenEndpointAuthMethod: 'none',
      scope: input.scope,
      clientUri: input.client_uri,
      logoUri: input.logo_uri,
      tosUri: input.tos_uri,
      policyUri: input.policy_uri,
      createdAt: now,
      updatedAt: now,
    };

    const [client] = await this.db.insert(mcpOAuthClients).values(insertData).returning();
    if (!client) {
      throw new OAuthError('server_error', 'Failed to persist OAuth client', 500);
    }

    return {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      grant_types: client.grantTypes,
      response_types: client.responseTypes,
      token_endpoint_auth_method: client.tokenEndpointAuthMethod,
      scope: client.scope || undefined,
      client_uri: client.clientUri || undefined,
      logo_uri: client.logoUri || undefined,
      tos_uri: client.tosUri || undefined,
      policy_uri: client.policyUri || undefined,
    };
  }

  async getClientByPublicId(clientId: string): Promise<McpOAuthClient | null> {
    const [client] = await this.db.select().from(mcpOAuthClients).where(eq(mcpOAuthClients.clientId, clientId));
    return client || null;
  }

  validateAuthorizeRequest(params: {
    responseType?: string;
    clientId?: string;
    redirectUri?: string;
    scope?: string;
    codeChallenge?: string;
    codeChallengeMethod?: string;
  }) {
    if (params.responseType !== 'code') {
      throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported');
    }

    if (!params.clientId) {
      throw new OAuthError('invalid_request', 'client_id is required');
    }

    if (!params.redirectUri) {
      throw new OAuthError('invalid_request', 'redirect_uri is required');
    }

    if (!params.codeChallenge) {
      throw new OAuthError('invalid_request', 'code_challenge is required');
    }

    if (params.codeChallengeMethod !== 'S256') {
      throw new OAuthError('invalid_request', 'Only code_challenge_method=S256 is supported');
    }

    const scopeString = (params.scope || '').trim();
    const scopes = scopeString ? normalizeScopeString(scopeString).split(' ').filter(Boolean) : [];
    const workspaceScopes = scopes.filter((scope) => scope.startsWith(WORKSPACE_SCOPE_PREFIX));

    if (workspaceScopes.length > 1) {
      throw new OAuthError('invalid_scope', 'Only one workspace scope may be requested');
    }

    const toolScopes = parseToolScopes(scopes);
    const toolValidation = validateToolScopes(scopes);
    if (!toolValidation.ok) {
      throw new OAuthError('invalid_scope', `Unknown tool scopes: ${toolValidation.invalidTools.join(', ')}`);
    }

    const requestedWorkspaceIdRaw = workspaceScopes.length === 1
      ? workspaceScopes[0]?.slice(WORKSPACE_SCOPE_PREFIX.length) || null
      : null;

    // Some MCP clients (including ChatGPT) send template placeholder scopes like "{workspaceId}".
    // Treat those as "workspace to be selected at consent time" instead of a literal workspace id.
    const requestedWorkspaceId = requestedWorkspaceIdRaw && !/^\{.+\}$/.test(requestedWorkspaceIdRaw)
      ? requestedWorkspaceIdRaw
      : null;

    return {
      scopes,
      requestedWorkspaceId,
      requestedToolScopes: toolScopes,
    };
  }

  async validateClientRedirect(clientId: string, redirectUri: string): Promise<McpOAuthClient> {
    const client = await this.getClientByPublicId(clientId);
    if (!client) {
      throw new OAuthError('invalid_client', 'Unknown client_id', 401);
    }

    if (!(client.redirectUris as string[]).includes(redirectUri)) {
      throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client');
    }

    return client;
  }

  async listAuthorizableWorkspaces(userId: string): Promise<Array<{ id: string; name: string; role: string }>> {
    const rows = await this.db
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

  async getUserWorkspaceRole(workspaceId: string, userId: string): Promise<string | null> {
    const [row] = await this.db
      .select({ role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));

    return row?.role || null;
  }

  async listWorkspaceConnections(workspaceId: string): Promise<McpOAuthConnection[]> {
    const rows = await this.db
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

    const activityRows = await this.db
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

  async updateConsentToolScopes(input: {
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

    const result = await this.db.transaction(async (tx) => {
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

    const workspaceConnections = await this.listWorkspaceConnections(input.workspaceId);
    const connection = workspaceConnections.find((connectionItem) => connectionItem.consentId === result.consentId);
    if (!connection) {
      throw new OAuthError('server_error', 'Failed to load updated OAuth connection', 500);
    }
    return connection;
  }

  async revokeConsent(input: {
    consentId: string;
    workspaceId: string;
  }): Promise<void> {
    const now = new Date();

    await this.db.transaction(async (tx) => {
      const [consent] = await tx
        .select()
        .from(mcpOAuthConsents)
        .where(and(eq(mcpOAuthConsents.id, input.consentId), eq(mcpOAuthConsents.workspaceId, input.workspaceId)));

      if (!consent) {
        throw new OAuthError('not_found', 'OAuth connection not found', 404);
      }

      if (consent.revokedAt) {
        return;
      }

      await tx
        .update(mcpOAuthConsents)
        .set({ revokedAt: now, updatedAt: now })
        .where(eq(mcpOAuthConsents.id, consent.id));

      await tx
        .update(mcpOAuthAccessTokens)
        .set({ revokedAt: now })
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
        .set({ revokedAt: now })
        .where(
          and(
            eq(mcpOAuthRefreshTokens.userId, consent.userId),
            eq(mcpOAuthRefreshTokens.clientId, consent.clientId),
            eq(mcpOAuthRefreshTokens.workspaceId, consent.workspaceId),
            isNull(mcpOAuthRefreshTokens.revokedAt)
          )
        );
    });
  }

  async upsertConsent(input: {
    userId: string;
    workspaceId: string;
    clientInternalId: string;
    approvedScopes: string[];
    grantedByRole: string;
  }): Promise<void> {
    const existing = await this.db
      .select({ id: mcpOAuthConsents.id })
      .from(mcpOAuthConsents)
      .where(
        and(
          eq(mcpOAuthConsents.userId, input.userId),
          eq(mcpOAuthConsents.workspaceId, input.workspaceId),
          eq(mcpOAuthConsents.clientId, input.clientInternalId)
        )
      );

    if (existing.length > 0) {
      const existingConsent = existing[0];
      if (!existingConsent) {
        throw new OAuthError('server_error', 'Consent lookup failed', 500);
      }
      await this.db
        .update(mcpOAuthConsents)
        .set({
          approvedScopes: input.approvedScopes,
          grantedByRole: input.grantedByRole,
          revokedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(mcpOAuthConsents.id, existingConsent.id));
      return;
    }

    const consentInsert: NewMcpOAuthConsent = {
      userId: input.userId,
      workspaceId: input.workspaceId,
      clientId: input.clientInternalId,
      approvedScopes: input.approvedScopes,
      grantedByRole: input.grantedByRole,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.db.insert(mcpOAuthConsents).values(consentInsert);
  }

  async createAuthorizationCode(input: {
    clientInternalId: string;
    userId: string;
    workspaceId: string;
    redirectUri: string;
    scopes: string[];
    codeChallenge: string;
    codeChallengeMethod: 'S256';
  }): Promise<string> {
    const code = randomOpaqueToken(32);
    const codeHash = hashSecret(code);

    const insertData: NewMcpOAuthAuthorizationCode = {
      clientId: input.clientInternalId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      codeHash,
      redirectUri: input.redirectUri,
      scope: normalizeScopeString(input.scopes.join(' ')),
      codeChallenge: input.codeChallenge,
      codeChallengeMethod: input.codeChallengeMethod,
      expiresAt: nowPlusSeconds(AUTH_CODE_TTL_SECONDS),
      createdAt: new Date(),
    };

    await this.db.insert(mcpOAuthAuthorizationCodes).values(insertData);

    return code;
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }) {
    const codeHash = hashSecret(input.code);
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      const [authCode] = await tx
        .select()
        .from(mcpOAuthAuthorizationCodes)
        .where(eq(mcpOAuthAuthorizationCodes.codeHash, codeHash));

      if (!authCode) {
        throw new OAuthError('invalid_grant', 'Authorization code is invalid');
      }

      if (authCode.usedAt) {
        throw new OAuthError('invalid_grant', 'Authorization code has already been used');
      }

      if (authCode.expiresAt <= now) {
        throw new OAuthError('invalid_grant', 'Authorization code has expired');
      }

      const [client] = await tx
        .select()
        .from(mcpOAuthClients)
        .where(and(eq(mcpOAuthClients.id, authCode.clientId), eq(mcpOAuthClients.clientId, input.clientId)));

      if (!client) {
        throw new OAuthError('invalid_client', 'Unknown client_id', 401);
      }

      if (authCode.redirectUri !== input.redirectUri) {
        throw new OAuthError('invalid_grant', 'redirect_uri mismatch');
      }

      const expectedChallenge = buildS256CodeChallenge(input.codeVerifier);
      if (expectedChallenge !== authCode.codeChallenge) {
        throw new OAuthError('invalid_grant', 'Invalid code_verifier');
      }

      await tx
        .update(mcpOAuthAuthorizationCodes)
        .set({ usedAt: now })
        .where(eq(mcpOAuthAuthorizationCodes.id, authCode.id));

      const accessToken = randomOpaqueToken(32);
      const refreshToken = randomOpaqueToken(32);

      const accessInsert: NewMcpOAuthAccessToken = {
        clientId: client.id,
        userId: authCode.userId,
        workspaceId: authCode.workspaceId,
        tokenHash: hashSecret(accessToken),
        scope: authCode.scope,
        expiresAt: nowPlusSeconds(ACCESS_TOKEN_TTL_SECONDS),
        createdAt: now,
      };

      const [accessTokenRow] = await tx.insert(mcpOAuthAccessTokens).values(accessInsert).returning();
      if (!accessTokenRow) {
        throw new OAuthError('server_error', 'Failed to create access token', 500);
      }

      const refreshInsert: NewMcpOAuthRefreshToken = {
        accessTokenId: accessTokenRow.id,
        clientId: client.id,
        userId: authCode.userId,
        workspaceId: authCode.workspaceId,
        tokenHash: hashSecret(refreshToken),
        scope: authCode.scope,
        expiresAt: nowPlusSeconds(REFRESH_TOKEN_TTL_SECONDS),
        createdAt: now,
      };

      await tx.insert(mcpOAuthRefreshTokens).values(refreshInsert);

      return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: refreshToken,
        scope: authCode.scope,
      };
    });
  }

  async refreshAccessToken(input: {
    refreshToken: string;
    clientId: string;
    scope?: string;
  }) {
    const refreshTokenHash = hashSecret(input.refreshToken);
    const now = new Date();

    return await this.db.transaction(async (tx) => {
      const [refreshRow] = await tx
        .select()
        .from(mcpOAuthRefreshTokens)
        .where(eq(mcpOAuthRefreshTokens.tokenHash, refreshTokenHash));

      if (!refreshRow) {
        throw new OAuthError('invalid_grant', 'Invalid refresh token');
      }

      if (refreshRow.revokedAt) {
        throw new OAuthError('invalid_grant', 'Refresh token has been revoked');
      }

      if (refreshRow.expiresAt <= now) {
        throw new OAuthError('invalid_grant', 'Refresh token has expired');
      }

      const [client] = await tx
        .select()
        .from(mcpOAuthClients)
        .where(and(eq(mcpOAuthClients.id, refreshRow.clientId), eq(mcpOAuthClients.clientId, input.clientId)));

      if (!client) {
        throw new OAuthError('invalid_client', 'Unknown client_id', 401);
      }

      const currentScopes = normalizeScopeString(refreshRow.scope).split(' ').filter(Boolean);
      const nextScopes = input.scope ? normalizeScopeString(input.scope).split(' ').filter(Boolean) : currentScopes;

      if (!isSubset(nextScopes, currentScopes)) {
        throw new OAuthError('invalid_scope', 'Requested scope must be a subset of granted scopes');
      }

      if (!hasExactlyOneWorkspaceScope(nextScopes)) {
        throw new OAuthError('invalid_scope', 'Exactly one workspace scope is required');
      }

      const toolValidation = validateToolScopes(nextScopes);
      if (!toolValidation.ok) {
        throw new OAuthError('invalid_scope', `Unknown tool scopes: ${toolValidation.invalidTools.join(', ')}`);
      }

      const nextScopeString = normalizeScopeString(nextScopes.join(' '));
      const accessToken = randomOpaqueToken(32);
      const newRefreshToken = randomOpaqueToken(32);

      const [newAccessRow] = await tx
        .insert(mcpOAuthAccessTokens)
        .values({
          clientId: client.id,
          userId: refreshRow.userId,
          workspaceId: refreshRow.workspaceId,
          tokenHash: hashSecret(accessToken),
          scope: nextScopeString,
          expiresAt: nowPlusSeconds(ACCESS_TOKEN_TTL_SECONDS),
          createdAt: now,
        })
        .returning();
      if (!newAccessRow) {
        throw new OAuthError('server_error', 'Failed to rotate access token', 500);
      }

      const [newRefreshRow] = await tx
        .insert(mcpOAuthRefreshTokens)
        .values({
          accessTokenId: newAccessRow.id,
          clientId: client.id,
          userId: refreshRow.userId,
          workspaceId: refreshRow.workspaceId,
          tokenHash: hashSecret(newRefreshToken),
          scope: nextScopeString,
          expiresAt: nowPlusSeconds(REFRESH_TOKEN_TTL_SECONDS),
          createdAt: now,
        })
        .returning();
      if (!newRefreshRow) {
        throw new OAuthError('server_error', 'Failed to rotate refresh token', 500);
      }

      await tx
        .update(mcpOAuthRefreshTokens)
        .set({
          revokedAt: now,
          replacedByTokenId: newRefreshRow.id,
        })
        .where(eq(mcpOAuthRefreshTokens.id, refreshRow.id));

      return {
        access_token: accessToken,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SECONDS,
        refresh_token: newRefreshToken,
        scope: nextScopeString,
      };
    });
  }

  async revokeToken(input: {
    token: string;
    tokenTypeHint?: 'access_token' | 'refresh_token';
    clientId?: string;
  }): Promise<void> {
    const tokenHash = hashSecret(input.token);
    const now = new Date();

    const tryRevokeAccess = async () => {
      const rows = await this.db
        .select({ id: mcpOAuthAccessTokens.id, clientId: mcpOAuthClients.clientId })
        .from(mcpOAuthAccessTokens)
        .innerJoin(mcpOAuthClients, eq(mcpOAuthAccessTokens.clientId, mcpOAuthClients.id))
        .where(eq(mcpOAuthAccessTokens.tokenHash, tokenHash));

      if (rows.length === 0) {
        return false;
      }

      const row = rows[0];
      if (!row) {
        return false;
      }

      if (input.clientId && row.clientId !== input.clientId) {
        return false;
      }

      await this.db
        .update(mcpOAuthAccessTokens)
        .set({ revokedAt: now })
        .where(eq(mcpOAuthAccessTokens.id, row.id));

      return true;
    };

    const tryRevokeRefresh = async () => {
      const rows = await this.db
        .select({ id: mcpOAuthRefreshTokens.id, clientId: mcpOAuthClients.clientId })
        .from(mcpOAuthRefreshTokens)
        .innerJoin(mcpOAuthClients, eq(mcpOAuthRefreshTokens.clientId, mcpOAuthClients.id))
        .where(eq(mcpOAuthRefreshTokens.tokenHash, tokenHash));

      if (rows.length === 0) {
        return false;
      }

      const row = rows[0];
      if (!row) {
        return false;
      }

      if (input.clientId && row.clientId !== input.clientId) {
        return false;
      }

      await this.db
        .update(mcpOAuthRefreshTokens)
        .set({ revokedAt: now })
        .where(eq(mcpOAuthRefreshTokens.id, row.id));

      return true;
    };

    if (input.tokenTypeHint === 'access_token') {
      await tryRevokeAccess();
      return;
    }

    if (input.tokenTypeHint === 'refresh_token') {
      await tryRevokeRefresh();
      return;
    }

    const revokedAccess = await tryRevokeAccess();
    if (!revokedAccess) {
      await tryRevokeRefresh();
    }
  }

  async authenticateAccessToken(token: string): Promise<OAuthMcpAuthContext> {
    const tokenHash = hashSecret(token);
    const now = new Date();

    const [row] = await this.db
      .select({
        accessTokenId: mcpOAuthAccessTokens.id,
        userId: mcpOAuthAccessTokens.userId,
        workspaceId: mcpOAuthAccessTokens.workspaceId,
        scope: mcpOAuthAccessTokens.scope,
        clientId: mcpOAuthClients.clientId,
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

    const scopes = normalizeScopeString(row.scope).split(' ').filter(Boolean);

    if (!hasExactlyOneWorkspaceScope(scopes)) {
      throw new OAuthError('invalid_token', 'Token has invalid workspace scopes', 401);
    }

    const workspaceId = parseWorkspaceScope(scopes);
    if (!workspaceId || workspaceId !== row.workspaceId) {
      throw new OAuthError('invalid_token', 'Token workspace scope does not match token binding', 401);
    }

    const toolValidation = validateToolScopes(scopes);
    if (!toolValidation.ok) {
      throw new OAuthError('invalid_token', 'Token includes unsupported tool scopes', 401);
    }

    const toolPermissions = parseToolScopes(scopes);

    return {
      accessTokenId: row.accessTokenId,
      userId: row.userId,
      workspaceId,
      scopes,
      toolPermissions,
      clientId: row.clientId,
    };
  }

  ensureToolAllowed(context: OAuthMcpAuthContext, toolName: string): void {
    if (!context.toolPermissions.includes(toolName)) {
      throw new OAuthError('insufficient_scope', `Token is missing scope for tool: ${toolName}`, 403);
    }
  }

  ensureAdminRole(role: string | null): void {
    if (!isAuthorizingRole(role)) {
      throw new OAuthError('access_denied', 'Only workspace owners and admins can authorize MCP access', 403);
    }
  }

  buildWwwAuthenticateHeader(baseUrl: string): string {
    const resourceMetadataUrl = `${baseUrl}/.well-known/oauth-protected-resource/api/mcp/sse`;
    return `Bearer realm=\"flowtask-mcp\", resource_metadata=\"${resourceMetadataUrl}\"`;
  }
}

export function isOAuthError(error: unknown): error is OAuthError {
  return error instanceof OAuthError;
}

export function encodeQuery(params: Record<string, string | undefined>): string {
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      urlParams.set(key, value);
    }
  }
  return urlParams.toString();
}

export function normalizeScopes(scopes: string[]): string[] {
  return Array.from(new Set(scopes.filter(Boolean)));
}

export const McpScope = {
  toolPrefix: TOOL_SCOPE_PREFIX,
  workspacePrefix: WORKSPACE_SCOPE_PREFIX,
};
