import type { Context, Next } from 'hono';
import { TOKEN_REGEX, API_TOKEN_PREFIX } from '@flowtask/shared';
import type { ApiTokenPermission } from '@flowtask/shared';

/**
 * Context set by token auth middleware.
 * Now workspace-scoped with optional project restrictions.
 */
export interface TokenAuthContext {
  tokenId: string;
  workspaceId: string;
  restrictedProjectIds: string[] | null; // null = all projects in workspace
  name: string;
  permissions: ApiTokenPermission[];
}

/**
 * Extract Bearer token from Authorization header.
 * Returns null if header is missing or malformed.
 */
export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) {
    return null;
  }

  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1]) {
    return null;
  }

  return match[1].trim();
}

/**
 * Check if a token looks like a FlowTask API token.
 */
export function isFlowTaskToken(token: string): boolean {
  return token.startsWith(API_TOKEN_PREFIX);
}

/**
 * Validate token format strictly.
 */
export function isValidTokenFormat(token: string): boolean {
  return TOKEN_REGEX.test(token);
}

/**
 * Helper to get token auth context from Hono context.
 * Returns null if not authenticated via token.
 */
export function getTokenAuth(ctx: Context): TokenAuthContext | null {
  return ctx.get('tokenAuth') as TokenAuthContext | null;
}

/**
 * Helper to check if request is authenticated via API token.
 */
export function isTokenAuthenticated(ctx: Context): boolean {
  return ctx.get('tokenAuth') !== undefined;
}

/**
 * Create error response for token auth failures.
 */
export function createTokenAuthError(
  code: string,
  message: string,
  statusCode: 401 | 403 | 429 = 401
): { body: { error: { code: string; message: string } }; status: 401 | 403 | 429 } {
  return {
    body: { error: { code, message } },
    status: statusCode,
  };
}

/**
 * Token auth middleware factory.
 * This middleware only handles the token extraction and format validation.
 * The actual token verification is done by the route handler using WorkspaceAgentService.
 *
 * This allows routes to have access to the database and Redis instances
 * configured at the API layer.
 *
 * Usage in routes:
 * ```
 * import { tokenAuthMiddleware, getTokenAuth } from '@flowtask/auth';
 *
 * app.use('/api/mcp/*', async (c, next) => {
 *   const authHeader = c.req.header('Authorization');
 *   const token = extractBearerToken(authHeader);
 *
 *   if (token && isFlowTaskToken(token)) {
 *     // Verify token using WorkspaceAgentService
 *     const result = await agentService.verifyToken(token, { checkRateLimit: true });
 *     if (!result.ok) {
 *       return c.json(result.error, result.error.code === 'RATE_LIMITED' ? 429 : 401);
 *     }
 *     c.set('tokenAuth', {
 *       tokenId: result.value.id,
 *       workspaceId: result.value.workspaceId,
 *       restrictedProjectIds: result.value.restrictedProjectIds,
 *       name: result.value.name,
 *       permissions: result.value.permissions,
 *     });
 *   }
 *
 *   await next();
 * });
 * ```
 */
export function createTokenAuthMiddleware() {
  return async (ctx: Context, next: Next) => {
    const authHeader = ctx.req.header('Authorization');
    const token = extractBearerToken(authHeader);

    // If no token or not a FlowTask token, skip token auth
    // This allows falling through to session auth
    if (!token || !isFlowTaskToken(token)) {
      await next();
      return;
    }

    // Validate format
    if (!isValidTokenFormat(token)) {
      return ctx.json({ error: { code: 'INVALID_TOKEN_FORMAT', message: 'Invalid API token format' } }, 401);
    }

    // Store the raw token for verification by the route handler
    ctx.set('rawApiToken', token);

    await next();
  };
}
