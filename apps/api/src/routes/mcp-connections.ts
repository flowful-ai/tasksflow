import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { AgentToolSchema } from '@flowtask/shared';
import { McpOAuthService, OAuthError } from '../services/mcp-oauth-service.js';
import { requireWorkspace } from '../lib/authorize.js';
import { AppError, validationHook, handleRouteError } from '../lib/responses.js';

const mcpConnectionsRoutes = new Hono();
mcpConnectionsRoutes.onError(handleRouteError);
const oauthService = new McpOAuthService();

/** Map OAuth service errors to API errors; anything else becomes a generic failure. */
async function oauthCall<T>(fallback: { code: string; message: string }, fn: () => Promise<T>) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof OAuthError) {
      throw new AppError(error.statusCode, error.oauthError.toUpperCase(), error.message);
    }
    console.error(`[${fallback.code}]`, error);
    throw new AppError(500, fallback.code, fallback.message);
  }
}

mcpConnectionsRoutes.get('/:workspaceId/mcp-connections', async (c) => {
  const { workspaceId } = await requireWorkspace(
    c,
    c.req.param('workspaceId'),
    'workspace:manage_settings'
  );
  const connections = await oauthCall(
    { code: 'LIST_FAILED', message: 'Failed to list MCP OAuth connections' },
    () => oauthService.listWorkspaceConnections(workspaceId)
  );
  return c.json({ success: true, data: { connections } });
});

mcpConnectionsRoutes.patch(
  '/:workspaceId/mcp-connections/:consentId/scopes',
  zValidator('json', z.object({ toolScopes: z.array(AgentToolSchema).min(1) }), validationHook),
  async (c) => {
    const { workspaceId, user } = await requireWorkspace(
      c,
      c.req.param('workspaceId'),
      'workspace:manage_settings'
    );
    const consentId = c.req.param('consentId');
    const { toolScopes } = c.req.valid('json');

    const connection = await oauthCall(
      { code: 'UPDATE_FAILED', message: 'Failed to update MCP OAuth scopes' },
      () =>
        oauthService.updateConsentToolScopes({
          consentId,
          workspaceId,
          toolScopes,
          actorUserId: user.id,
        })
    );
    return c.json({ success: true, data: connection });
  }
);

mcpConnectionsRoutes.delete('/:workspaceId/mcp-connections/:consentId', async (c) => {
  const { workspaceId } = await requireWorkspace(
    c,
    c.req.param('workspaceId'),
    'workspace:manage_settings'
  );
  const consentId = c.req.param('consentId');
  await oauthCall({ code: 'DELETE_FAILED', message: 'Failed to delete MCP OAuth connection' }, () =>
    oauthService.deleteConsent({ consentId, workspaceId })
  );
  return c.json({ success: true, data: null });
});

export { mcpConnectionsRoutes };
