import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase } from '@flowtask/database';
import { WorkspaceService, ProjectService } from '@flowtask/domain';
import type { AgentTool } from '@flowtask/shared';
import { extractBearerToken } from '@flowtask/auth';
import { McpOAuthService, OAuthError, type OAuthMcpAuthContext } from '../services/mcp-oauth-service.js';
import { TaskGitHubLinkError } from '../services/task-github-link-service.js';
import {
  executeAgentTool,
  listToolDefinitions,
  ToolExecutionError,
} from '../services/agent-tool-runtime.js';

/**
 * MCP (Model Context Protocol) endpoints for AI agent tool execution.
 * These endpoints require OAuth access tokens.
 */

const mcp = new Hono();
const db = getDatabase();

const workspaceService = new WorkspaceService(db);
const projectService = new ProjectService(db);
const oauthService = new McpOAuthService();

function getBaseUrl(requestUrl: string, headers: Headers): string {
  const url = new URL(requestUrl);
  const forwardedProto = headers.get('x-forwarded-proto');
  const forwardedHost = headers.get('x-forwarded-host');
  const protocol = forwardedProto || url.protocol.replace(':', '');
  const host = forwardedHost || url.host;
  return `${protocol}://${host}`;
}

function setOAuthChallenge(c: any): void {
  const baseUrl = getBaseUrl(c.req.url, c.req.raw.headers);
  c.header('WWW-Authenticate', oauthService.buildWwwAuthenticateHeader(baseUrl));
}

async function mcpAuthMiddleware(ctx: any, next: () => Promise<void>) {
  const authHeader = ctx.req.header('Authorization');
  const bearerToken = extractBearerToken(authHeader);
  if (!bearerToken) {
    setOAuthChallenge(ctx);
    return ctx.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'OAuth bearer token required' } }, 401);
  }

  try {
    const oauthAuth = await oauthService.authenticateAccessToken(bearerToken);
    const roleResult = await workspaceService.getMemberRole(oauthAuth.workspaceId, oauthAuth.userId);
    const role = roleResult.ok ? roleResult.value : null;
    oauthService.ensureAdminRole(role);
    ctx.set('oauthAuth', oauthAuth);
    return next();
  } catch (error) {
    setOAuthChallenge(ctx);
    if (error instanceof OAuthError) {
      return ctx.json({ success: false, error: { code: error.oauthError.toUpperCase(), message: error.message } }, error.statusCode as 401 | 403);
    }
    return ctx.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid OAuth access token' } }, 401);
  }
}

// List available tools
mcp.get('/tools', async (c) => {
  return c.json({
    success: true,
    data: listToolDefinitions(),
  });
});

// Execute a tool
mcp.post(
  '/tools/:toolName/execute',
  mcpAuthMiddleware,
  zValidator(
    'json',
    z.object({
      arguments: z.record(z.unknown()),
    })
  ),
  async (c) => {
    const toolName = c.req.param('toolName');
    const { arguments: args } = c.req.valid('json');

    const oauthAuth = (c as any).get('oauthAuth') as OAuthMcpAuthContext;

    try {
      oauthService.ensureToolAllowed(oauthAuth, toolName);

      const result = await executeAgentTool(toolName, args, {
        workspaceId: oauthAuth.workspaceId,
        userId: oauthAuth.userId,
        mcpClientId: oauthAuth.clientId,
        allowedToolNames: new Set(oauthAuth.toolPermissions as AgentTool[]),
        canAccessProject: async (projectId: string) => {
          const projectResult = await projectService.getById(projectId);
          return projectResult.ok && projectResult.value.workspaceId === oauthAuth.workspaceId;
        },
      });

      return c.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof OAuthError) {
        if (error.statusCode === 401) {
          setOAuthChallenge(c);
        }
        return c.json({
          success: false,
          error: {
            code: error.oauthError.toUpperCase(),
            message: error.message,
          },
        }, error.statusCode as 400 | 401 | 403);
      }

      if (error instanceof TaskGitHubLinkError) {
        return c.json({
          success: false,
          error: {
            code: error.code,
            message: error.message,
          },
        }, error.status);
      }

      if (error instanceof ToolExecutionError) {
        return c.json({ success: false, error: { code: error.code, message: error.message } }, error.status as 400 | 401 | 403 | 404);
      }

      return c.json({
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: process.env.NODE_ENV === 'production' ? 'Tool execution failed' : (error instanceof Error ? error.message : 'Unknown error'),
        },
      }, 400);
    }
  }
);

export { mcp as mcpRoutes };
