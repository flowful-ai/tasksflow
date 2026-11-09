import { Hono, type Context } from 'hono';

/**
 * Legacy MCP token agents (ft_v1_* tokens) were removed. AGENTS.md requires
 * these routes to stay hard-disabled with an explicit deprecation response.
 */
const workspaceAgentsRouter = new Hono();

const DEPRECATED_ERROR = {
  success: false as const,
  error: {
    code: 'MCP_TOKEN_AUTH_DEPRECATED',
    message: 'Legacy MCP token agents are deprecated. Use OAuth Connections.',
  },
};

function deprecatedResponse(c: Context): Response {
  return c.json(DEPRECATED_ERROR, 410);
}

workspaceAgentsRouter.all('/:workspaceId/agents', deprecatedResponse);
workspaceAgentsRouter.all('/:workspaceId/agents/*', deprecatedResponse);

export { workspaceAgentsRouter as workspaceAgentRoutes };
