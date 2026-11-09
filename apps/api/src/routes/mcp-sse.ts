import { Hono, type Context } from 'hono';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js';
import { mcpAuth, type McpAuthEnv, type McpRequestAuth } from '../lib/mcp/auth-middleware.js';
import { ipRateLimit } from '../lib/mcp/rate-limit.js';
import { buildToolContext, type ToolContext } from '../lib/mcp/tool-context.js';
import { ToolExecutionError } from '../lib/mcp/errors.js';
import { API_VERSION } from '../lib/version.js';
import {
  listToolDefinitions,
  MCP_SERVER_INSTRUCTIONS,
  runAgentTool,
  type ToolServices,
} from '../services/agent-tool-runtime.js';

/**
 * MCP Streamable HTTP endpoint (stateless). Served at `/api/mcp` (canonical)
 * and `/api/mcp/sse` (legacy path kept for already-configured clients).
 * Works with Claude, ChatGPT, Cursor and any MCP-compatible client.
 */

const mcpSse = new Hono<McpAuthEnv>();

function contextFor(auth: McpRequestAuth): ToolContext {
  return buildToolContext({
    workspaceId: auth.workspaceId,
    userId: auth.userId,
    role: auth.role,
    grantedTools: auth.toolPermissions,
    mcpClientId: auth.clientId,
  });
}

export function createMcpServer(ctx: ToolContext, services?: ToolServices): Server {
  const server = new Server(
    { name: 'flowtask', version: API_VERSION },
    { capabilities: { tools: {} }, instructions: MCP_SERVER_INSTRUCTIONS }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: listToolDefinitions(ctx.grantedTools),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request): Promise<CallToolResult> => {
    const { name, arguments: args } = request.params;

    // Unknown or non-granted tools are protocol errors, not tool results.
    try {
      ctx.assertToolGranted(name);
    } catch (error) {
      throw new McpError(ErrorCode.InvalidParams, error instanceof ToolExecutionError ? error.message : 'Unknown tool');
    }

    const outcome = await runAgentTool(name, args ?? {}, ctx, services);
    if (!outcome.ok) {
      return {
        content: [{ type: 'text', text: `Error (${outcome.error.code}): ${outcome.error.message}` }],
        isError: true,
      };
    }

    return {
      content: [{ type: 'text', text: JSON.stringify(outcome.output) }],
      structuredContent: outcome.output,
    };
  });

  return server;
}

function methodNotAllowedResponse(c: Context): Response {
  c.header('Allow', 'POST');
  return c.json(
    {
      error: 'Method Not Allowed',
      code: 'MCP_METHOD_NOT_ALLOWED',
      message: 'Only POST is supported for the MCP endpoint in stateless mode',
    },
    405
  );
}

function legacySseDeprecatedResponse(c: Context): Response {
  return c.json(
    {
      error: 'Gone',
      code: 'MCP_LEGACY_SSE_DEPRECATED',
      message: 'Legacy SSE endpoints are deprecated and disabled.',
      hint: 'Use POST /api/mcp (Streamable HTTP).',
    },
    410
  );
}

function rateLimited(c: Context): Response {
  return c.json({ error: 'rate_limited', error_description: 'Too many MCP requests, retry later' }, 429);
}

const rateLimit = ipRateLimit('mcp', rateLimited);

async function handleMcpRequest(c: Context<McpAuthEnv>): Promise<Response> {
  if (c.req.method !== 'POST') {
    return methodNotAllowedResponse(c);
  }

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const server = createMcpServer(contextFor(c.get('mcpAuth')));
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
}

// Canonical endpoint and the legacy alias.
mcpSse.all('/', rateLimit, mcpAuth, handleMcpRequest);
mcpSse.all('/sse', rateLimit, mcpAuth, handleMcpRequest);

// Tools granted to the presented token (REST convenience; authenticated).
mcpSse.get('/tools', rateLimit, mcpAuth, (c) => {
  const ctx = contextFor(c.get('mcpAuth'));
  return c.json({ success: true, data: listToolDefinitions(ctx.grantedTools) });
});

mcpSse.get('/sse/stream', (c) => legacySseDeprecatedResponse(c));
mcpSse.post('/sse/message', (c) => legacySseDeprecatedResponse(c));

export { mcpSse as mcpSseRoutes };
