import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AgentToolSchema, type AgentTool } from '@flowtask/shared';
import { buildToolContext } from '../lib/mcp/tool-context.js';
import { setMcpRateLimiter } from '../lib/mcp/rate-limit.js';
import { createMcpServer, mcpSseRoutes } from './mcp-sse.js';
import {
  USER_ADMIN,
  WS_A,
  createScopeDeps,
  createServices,
} from '../services/agent-tools/test-fixtures.js';

async function connect(grantedTools: AgentTool[]) {
  const ctx = buildToolContext(
    { workspaceId: WS_A, userId: USER_ADMIN, role: 'admin', grantedTools },
    createScopeDeps()
  );
  const { services } = createServices();
  const server = createMcpServer(ctx, services);
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('MCP server', () => {
  it('lists only granted tools with output schemas and annotations', async () => {
    const client = await connect(['query_tasks', 'list_projects']);
    const { tools } = await client.listTools();
    expect(tools.map((entry) => entry.name).sort()).toEqual(['list_projects', 'query_tasks']);
    const query = tools.find((entry) => entry.name === 'query_tasks');
    expect(query?.outputSchema?.type).toBe('object');
    expect(query?.annotations?.readOnlyHint).toBe(true);
  });

  it('returns structuredContent that satisfies the advertised output schema', async () => {
    // The SDK client validates structuredContent against outputSchema and throws on mismatch.
    const client = await connect([...AgentToolSchema.options]);
    await client.listTools();
    const projects = await client.callTool({ name: 'list_projects', arguments: {} });
    expect(projects.isError).toBeFalsy();
    expect(projects.structuredContent).toMatchObject({
      projects: [{ identifier: 'ENG' }, { identifier: 'SEC' }],
    });

    const tasks = await client.callTool({ name: 'query_tasks', arguments: { limit: 1 } });
    expect(tasks.isError).toBeFalsy();
    expect(tasks.structuredContent).toMatchObject({ total: 3 });
    expect(tasks.structuredContent).toHaveProperty('nextCursor', expect.any(String));

    const members = await client.callTool({ name: 'list_members', arguments: {} });
    expect(members.structuredContent).toMatchObject({ total: 2 });
  });

  it('answers unknown and non-granted tools with a JSON-RPC error', async () => {
    const client = await connect(['query_tasks']);
    await expect(
      client.callTool({ name: 'delete_task', arguments: { taskId: 'ENG-1' } })
    ).rejects.toThrow(/not granted/);
    await expect(client.callTool({ name: 'drop_database', arguments: {} })).rejects.toThrow(
      /not found/
    );
  });

  it('returns validation errors to the model as tool errors', async () => {
    const client = await connect(['query_tasks']);
    const result = await client.callTool({ name: 'query_tasks', arguments: { limit: 'ten' } });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result.content)).toContain('VALIDATION_ERROR');
  });
});

describe('MCP HTTP routes', () => {
  const app = new Hono().route('/api/mcp', mcpSseRoutes);
  const calls: string[] = [];

  beforeAll(() => {
    setMcpRateLimiter({
      checkMinuteLimit: async (key, limit) => {
        calls.push(key);
        return { allowed: true, remaining: limit - 1, resetIn: 60 };
      },
    });
  });

  afterAll(() => setMcpRateLimiter(null));

  it('serves the canonical /api/mcp endpoint and the legacy alias behind OAuth', async () => {
    for (const path of ['/api/mcp', '/api/mcp/sse']) {
      const response = await app.request(`http://localhost${path}`, { method: 'POST', body: '{}' });
      expect(response.status).toBe(401);
      expect(response.headers.get('WWW-Authenticate')).toContain(
        `/.well-known/oauth-protected-resource${path}"`
      );
    }
    expect(calls.every((key) => key.startsWith('mcp:mcp:'))).toBe(true);
  });

  it('requires a token for GET /api/mcp/tools', async () => {
    const response = await app.request('http://localhost/api/mcp/tools');
    expect(response.status).toBe(401);
  });

  it('no longer serves the removed split SSE endpoints', async () => {
    expect((await app.request('http://localhost/api/mcp/sse/stream')).status).toBe(404);
    const message = await app.request('http://localhost/api/mcp/sse/message', { method: 'POST' });
    expect(message.status).toBe(404);
  });

  it('rejects requests over the per-IP limit', async () => {
    setMcpRateLimiter({
      checkMinuteLimit: async () => ({ allowed: false, remaining: 0, resetIn: 42 }),
    });
    const response = await app.request('http://localhost/api/mcp', { method: 'POST', body: '{}' });
    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe('42');
  });
});
