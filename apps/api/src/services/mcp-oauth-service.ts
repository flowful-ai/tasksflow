import { getDatabase, type Database } from '../db/index.js';
import type { McpOAuthClient } from '../db/schema.js';
import { OAuthError } from './mcp-oauth/errors.js';
import { isAuthorizingRole } from './mcp-oauth/scopes.js';
import * as clients from './mcp-oauth/clients.js';
import * as codes from './mcp-oauth/codes.js';
import * as tokens from './mcp-oauth/tokens.js';
import * as connections from './mcp-oauth/connections.js';
import * as metadata from './mcp-oauth/metadata.js';
import type { McpResourcePath } from './mcp-oauth/resource.js';

export { OAuthError, isOAuthError } from './mcp-oauth/errors.js';
export { buildS256CodeChallenge } from './mcp-oauth/crypto.js';
export {
  McpScope,
  getAllMcpToolNames,
  isAuthorizingRole,
  normalizeScopes,
  validateRequestedMcpScopes,
  validateToolScopePresence,
} from './mcp-oauth/scopes.js';
export type { OAuthMcpAuthContext, OAuthTokenResponse } from './mcp-oauth/tokens.js';
export type { McpOAuthConnection } from './mcp-oauth/connections.js';
export type { McpOAuthClientRegistration, ParsedAuthorizeRequest } from './mcp-oauth/clients.js';
export type { McpResourcePath } from './mcp-oauth/resource.js';
export {
  MCP_CANONICAL_PATH,
  MCP_LEGACY_PATH,
  resolveRequestedResource,
} from './mcp-oauth/resource.js';

export function encodeQuery(params: Record<string, string | undefined>): string {
  const urlParams = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      urlParams.set(key, value);
    }
  }
  return urlParams.toString();
}

/**
 * Facade over the OAuth authorization server modules in ./mcp-oauth/.
 * The database is resolved lazily so importing routes never needs DATABASE_URL.
 */
export class McpOAuthService {
  constructor(private readonly dbProvider: () => Database = getDatabase) {}

  private get db(): Database {
    return this.dbProvider();
  }

  getAuthorizationServerMetadata(baseUrl: string) {
    return metadata.getAuthorizationServerMetadata(baseUrl);
  }

  getProtectedResourceMetadata(baseUrl: string, resourcePath?: McpResourcePath) {
    return metadata.getProtectedResourceMetadata(baseUrl, resourcePath);
  }

  buildWwwAuthenticateHeader(
    ...args: Parameters<typeof metadata.buildWwwAuthenticateHeader>
  ): string {
    return metadata.buildWwwAuthenticateHeader(...args);
  }

  registerClient(payload: unknown) {
    return clients.registerClient(this.db, payload);
  }

  getClientByPublicId(clientId: string): Promise<McpOAuthClient | null> {
    return clients.getClientByPublicId(this.db, clientId);
  }

  validateAuthorizeRequest(params: Parameters<typeof clients.validateAuthorizeRequest>[0]) {
    return clients.validateAuthorizeRequest(params);
  }

  validateClientRedirect(
    clientId: string | undefined,
    redirectUri: string | undefined
  ): Promise<{ client: McpOAuthClient; redirectUri: string }> {
    return clients.validateClientRedirect(this.db, clientId, redirectUri);
  }

  listAuthorizableWorkspaces(userId: string) {
    return connections.listAuthorizableWorkspaces(this.db, userId);
  }

  getUserWorkspaceRole(workspaceId: string, userId: string) {
    return connections.getUserWorkspaceRole(this.db, workspaceId, userId);
  }

  listWorkspaceConnections(workspaceId: string) {
    return connections.listWorkspaceConnections(this.db, workspaceId);
  }

  updateConsentToolScopes(input: Parameters<typeof connections.updateConsentToolScopes>[1]) {
    return connections.updateConsentToolScopes(this.db, input);
  }

  deleteConsent(input: Parameters<typeof connections.deleteConsent>[1]) {
    return connections.deleteConsent(this.db, input);
  }

  upsertConsent(input: Parameters<typeof connections.upsertConsent>[1]) {
    return connections.upsertConsent(this.db, input);
  }

  createAuthorizationCode(input: Parameters<typeof codes.createAuthorizationCode>[1]) {
    return codes.createAuthorizationCode(this.db, input);
  }

  exchangeAuthorizationCode(input: Parameters<typeof codes.exchangeAuthorizationCode>[1]) {
    return codes.exchangeAuthorizationCode(this.db, input);
  }

  refreshAccessToken(input: Parameters<typeof tokens.refreshAccessToken>[1]) {
    return tokens.refreshAccessToken(this.db, input);
  }

  revokeToken(input: Parameters<typeof tokens.revokeToken>[1]) {
    return tokens.revokeToken(this.db, input);
  }

  authenticateAccessToken(token: string, options: { baseUrl: string }) {
    return tokens.authenticateAccessToken(this.db, token, options);
  }

  ensureAdminRole(role: string | null): void {
    if (!isAuthorizingRole(role)) {
      throw new OAuthError(
        'access_denied',
        'Only workspace owners and admins can authorize MCP access',
        403
      );
    }
  }
}
