import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { getDatabase } from '@flowtask/database';
import { ProjectService, WorkspaceService } from '@flowtask/domain';
import type { AgentTool } from '@flowtask/shared';
import { extractBearerToken } from '@flowtask/auth';
import { McpOAuthService, OAuthError, type OAuthMcpAuthContext } from '../services/mcp-oauth-service.js';
import { executeAgentTool, listToolDefinitions } from '../services/agent-tool-runtime.js';

/**
 * MCP SSE transport endpoints for native MCP protocol support.
 * Works with Claude Code, OpenAI ChatGPT, LibreChat, and any MCP-compatible client.
 */

const mcpSse = new Hono();
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

function methodNotAllowedResponse(c: any): Response {
  c.header('Allow', 'POST');
  return c.json(
    {
      error: 'Method Not Allowed',
      code: 'MCP_METHOD_NOT_ALLOWED',
      message: 'Only POST is supported for /api/mcp/sse in stateless mode',
    },
    405
  );
}

function legacySseDeprecatedResponse(c: any): Response {
  return c.json(
    {
      error: 'Gone',
      code: 'MCP_LEGACY_SSE_DEPRECATED',
      message: 'Legacy SSE endpoints are deprecated and disabled.',
      hint: 'Use POST /api/mcp/sse (Streamable HTTP).',
    },
    410
  );
}

async function hasAdminWorkspaceRole(tokenAuth: OAuthMcpAuthContext): Promise<boolean> {
  const roleResult = await workspaceService.getMemberRole(tokenAuth.workspaceId, tokenAuth.userId);
  if (!roleResult.ok || !roleResult.value) {
    return false;
  }
  return roleResult.value === 'owner' || roleResult.value === 'admin';
}

function createMcpServer(tokenAuth: OAuthMcpAuthContext): McpServer {
  const mcpServer = new McpServer(
    {
      name: 'flowtask',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: 'Use query_tasks for structured filters (assigneeId="me" for my tasks), search_tasks for keywords, get_task for details; keep defaults (compact/ack) unless full data is required.',
    }
  );

  const allowedToolNames = new Set(tokenAuth.toolPermissions as AgentTool[]);

  mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: listToolDefinitions(allowedToolNames),
    };
  });

  mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      oauthService.ensureToolAllowed(tokenAuth, name);

      const result = await executeAgentTool(name, args as Record<string, unknown>, {
        workspaceId: tokenAuth.workspaceId,
        userId: tokenAuth.userId,
        mcpClientId: tokenAuth.clientId,
        allowedToolNames,
        canAccessProject: async (projectId: string) => {
          const projectResult = await projectService.getById(projectId);
          return projectResult.ok && projectResult.value.workspaceId === tokenAuth.workspaceId;
        },
      });

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result) }],
      };
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              process.env.NODE_ENV === 'production'
                ? 'Error: Tool execution failed'
                : `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  });

  return mcpServer;
}

async function verifyToken(
  authHeader: string | undefined,
  logContext: { route: string; hasSessionHeader: boolean }
): Promise<OAuthMcpAuthContext | null> {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return null;
  }

  try {
    const tokenAuth = await oauthService.authenticateAccessToken(token);
    const roleOk = await hasAdminWorkspaceRole(tokenAuth);
    if (!roleOk) {
      console.warn('MCP auth failed: non-admin workspace role', logContext);
      return null;
    }
    return tokenAuth;
  } catch (error) {
    if (error instanceof OAuthError) {
      console.warn('MCP auth failed', {
        ...logContext,
        oauthError: error.oauthError,
        statusCode: error.statusCode,
      });
    } else {
      console.warn('MCP auth failed', {
        ...logContext,
        oauthError: 'unknown_error',
      });
    }
    return null;
  }
}

mcpSse.all('/sse', async (c) => {
  const authHeader = c.req.header('Authorization');
  const tokenAuth = await verifyToken(authHeader, {
    route: '/api/mcp/sse',
    hasSessionHeader: Boolean(c.req.header('Mcp-Session-Id')),
  });

  if (!tokenAuth) {
    setOAuthChallenge(c);
    return c.json({ error: 'Unauthorized', message: 'Valid OAuth access token required' }, 401);
  }

  if (c.req.method !== 'POST') {
    return methodNotAllowedResponse(c);
  }

  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  const server = createMcpServer(tokenAuth);
  await server.connect(transport);

  return transport.handleRequest(c.req.raw);
});

mcpSse.get('/sse/stream', async (c) => {
  return legacySseDeprecatedResponse(c);
});

mcpSse.post('/sse/message', async (c) => {
  return legacySseDeprecatedResponse(c);
});

export { mcpSse as mcpSseRoutes };
