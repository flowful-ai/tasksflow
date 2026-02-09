import { Hono } from 'hono';

const workspaceAgentsRouter = new Hono();

const DEPRECATED_ERROR = {
  success: false as const,
  error: {
    code: 'MCP_TOKEN_AUTH_DEPRECATED',
    message: 'Legacy MCP token agents are deprecated. Use OAuth Connections.',
  },
};

function deprecatedResponse(c: any) {
  return c.json(DEPRECATED_ERROR, 410);
}

workspaceAgentsRouter.get('/:workspaceId/agents', (c) => deprecatedResponse(c));
workspaceAgentsRouter.post('/:workspaceId/agents', (c) => deprecatedResponse(c));
workspaceAgentsRouter.get('/:workspaceId/agents/:agentId', (c) => deprecatedResponse(c));
workspaceAgentsRouter.patch('/:workspaceId/agents/:agentId', (c) => deprecatedResponse(c));
workspaceAgentsRouter.delete('/:workspaceId/agents/:agentId', (c) => deprecatedResponse(c));
workspaceAgentsRouter.post('/:workspaceId/agents/:agentId/regenerate', (c) => deprecatedResponse(c));

export { workspaceAgentsRouter as workspaceAgentRoutes };
