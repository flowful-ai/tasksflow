import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { WorkspaceService } from '@flowtask/domain';
import { getDatabase } from '@flowtask/database';
import { getCurrentUser } from '@flowtask/auth';
import { AgentToolSchema } from '@flowtask/shared';
import { McpOAuthService, OAuthError } from '../services/mcp-oauth-service.js';

const mcpConnectionsRoutes = new Hono();
const db = getDatabase();
const workspaceService = new WorkspaceService(db);
const oauthService = new McpOAuthService();

async function requireWorkspaceAdminOrOwner(workspaceId: string, userId: string): Promise<void> {
  const roleResult = await workspaceService.getMemberRole(workspaceId, userId);
  const role = roleResult.ok ? roleResult.value : null;
  if (!role || (role !== 'owner' && role !== 'admin')) {
    throw new OAuthError('access_denied', 'Only workspace owners and admins can manage MCP OAuth connections', 403);
  }
}

mcpConnectionsRoutes.get('/:workspaceId/mcp-connections', async (c) => {
  try {
    const user = getCurrentUser(c);
    const workspaceId = c.req.param('workspaceId');

    await requireWorkspaceAdminOrOwner(workspaceId, user.id);

    const connections = await oauthService.listWorkspaceConnections(workspaceId);
    return c.json({ success: true, data: { connections } });
  } catch (error) {
    if (error instanceof OAuthError) {
      return c.json({ success: false, error: { code: error.oauthError.toUpperCase(), message: error.message } }, error.statusCode as 403 | 404);
    }

    return c.json({ success: false, error: { code: 'LIST_FAILED', message: 'Failed to list MCP OAuth connections' } }, 500);
  }
});

mcpConnectionsRoutes.patch(
  '/:workspaceId/mcp-connections/:consentId/scopes',
  zValidator(
    'json',
    z.object({
      toolScopes: z.array(AgentToolSchema).min(1),
    })
  ),
  async (c) => {
    try {
      const user = getCurrentUser(c);
      const workspaceId = c.req.param('workspaceId');
      const consentId = c.req.param('consentId');
      const { toolScopes } = c.req.valid('json');

      await requireWorkspaceAdminOrOwner(workspaceId, user.id);

      const connection = await oauthService.updateConsentToolScopes({
        consentId,
        workspaceId,
        toolScopes,
        actorUserId: user.id,
      });

      return c.json({ success: true, data: connection });
    } catch (error) {
      if (error instanceof OAuthError) {
        return c.json({ success: false, error: { code: error.oauthError.toUpperCase(), message: error.message } }, error.statusCode as 400 | 403 | 404);
      }

      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: 'Failed to update MCP OAuth scopes' } }, 500);
    }
  }
);

mcpConnectionsRoutes.delete('/:workspaceId/mcp-connections/:consentId', async (c) => {
  try {
    const user = getCurrentUser(c);
    const workspaceId = c.req.param('workspaceId');
    const consentId = c.req.param('consentId');

    await requireWorkspaceAdminOrOwner(workspaceId, user.id);

    await oauthService.deleteConsent({ consentId, workspaceId });
    return c.json({ success: true, data: null });
  } catch (error) {
    if (error instanceof OAuthError) {
      return c.json({ success: false, error: { code: error.oauthError.toUpperCase(), message: error.message } }, error.statusCode as 403 | 404);
    }

    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: 'Failed to delete MCP OAuth connection' } }, 500);
  }
});

export { mcpConnectionsRoutes };
