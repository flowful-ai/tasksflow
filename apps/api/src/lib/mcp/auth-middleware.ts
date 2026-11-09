import type { Context, MiddlewareHandler } from 'hono';
import { getDatabase } from '../../db/index.js';
import { WorkspaceService } from '../../domain/index.js';
import type { WorkspaceRole } from '@flowtask/shared';
import { getBaseUrl } from '../base-url.js';
import { extractBearerToken } from './bearer.js';
import {
  MCP_CANONICAL_PATH,
  MCP_LEGACY_PATH,
  McpOAuthService,
  OAuthError,
  isAuthorizingRole,
  type McpResourcePath,
  type OAuthMcpAuthContext,
} from '../../services/mcp-oauth-service.js';

export interface McpRequestAuth extends OAuthMcpAuthContext {
  role: WorkspaceRole;
}

export type McpAuthEnv = {
  Variables: {
    mcpAuth: McpRequestAuth;
  };
};

export interface McpAuthDeps {
  authenticate: (token: string, baseUrl: string) => Promise<OAuthMcpAuthContext>;
  getRole: (workspaceId: string, userId: string) => Promise<WorkspaceRole | null>;
}

function defaultDeps(): McpAuthDeps {
  const oauthService = new McpOAuthService();
  let workspaceService: WorkspaceService | null = null;
  return {
    authenticate: (token, baseUrl) => oauthService.authenticateAccessToken(token, { baseUrl }),
    getRole: async (workspaceId, userId) => {
      workspaceService ??= new WorkspaceService(getDatabase());
      const result = await workspaceService.getMemberRole(workspaceId, userId);
      return result.ok ? result.value : null;
    },
  };
}

function resourcePathForRequest(path: string): McpResourcePath {
  return path === MCP_LEGACY_PATH || path.startsWith(`${MCP_LEGACY_PATH}/`) ? MCP_LEGACY_PATH : MCP_CANONICAL_PATH;
}

function unauthorized(c: Context, description: string, withError: boolean): Response {
  const oauthService = new McpOAuthService();
  c.header(
    'WWW-Authenticate',
    oauthService.buildWwwAuthenticateHeader(
      getBaseUrl(c.req.raw),
      resourcePathForRequest(c.req.path),
      withError ? { code: 'invalid_token', description } : undefined
    )
  );
  return c.json({ error: withError ? 'invalid_token' : 'unauthorized', error_description: description }, 401);
}

/**
 * The single authentication gate for MCP runtime endpoints.
 * - 401 + WWW-Authenticate: missing, invalid, expired, wrong-audience token, or the user left the workspace.
 * - 403: valid token, but the user's workspace role no longer allows MCP access.
 * Per-tool scope checks happen in the tool context, not here.
 */
export function createMcpAuth(deps: McpAuthDeps = defaultDeps()): MiddlewareHandler<McpAuthEnv> {
  return async (c, next) => {
    const token = extractBearerToken(c.req.header('Authorization'));
    if (!token) {
      return unauthorized(c, 'OAuth bearer token required', false);
    }

    let auth: OAuthMcpAuthContext;
    try {
      auth = await deps.authenticate(token, getBaseUrl(c.req.raw));
    } catch (error) {
      if (error instanceof OAuthError && error.statusCode === 401) {
        console.warn('MCP auth failed', { route: c.req.path, oauthError: error.oauthError });
        return unauthorized(c, error.message, true);
      }
      throw error;
    }

    const role = await deps.getRole(auth.workspaceId, auth.userId);
    if (!role) {
      return unauthorized(c, 'User is no longer a member of the authorized workspace', true);
    }
    if (!isAuthorizingRole(role)) {
      return c.json(
        { error: 'insufficient_role', error_description: 'Only workspace owners and admins can use MCP access' },
        403
      );
    }

    c.set('mcpAuth', { ...auth, role });
    await next();
  };
}

export const mcpAuth = createMcpAuth();
