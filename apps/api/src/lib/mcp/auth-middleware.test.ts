import { describe, expect, it } from 'bun:test';
import { Hono } from 'hono';
import type { WorkspaceRole } from '@flowtask/shared';
import { OAuthError, type OAuthMcpAuthContext } from '../../services/mcp-oauth-service.js';
import { createMcpAuth, type McpAuthEnv } from './auth-middleware.js';

const AUTH: OAuthMcpAuthContext = {
  accessTokenId: 'at-1',
  userId: 'user-1',
  workspaceId: 'ws-1',
  scopes: ['mcp:workspace:ws-1', 'mcp:tool:query_tasks'],
  toolPermissions: ['query_tasks'],
  clientId: 'client-1',
  clientName: 'Client',
  resource: null,
};

function appWith(
  role: WorkspaceRole | null,
  authenticate?: (token: string) => Promise<OAuthMcpAuthContext>
) {
  const app = new Hono<McpAuthEnv>();
  const mcpAuth = createMcpAuth({
    authenticate:
      authenticate ??
      (async (token) => {
        if (token !== 'good')
          throw new OAuthError('invalid_token', 'Access token is invalid or expired', 401);
        return AUTH;
      }),
    getRole: async () => role,
  });
  app.all('/api/mcp', mcpAuth, (c) => c.json({ role: c.get('mcpAuth').role }));
  app.all('/api/mcp/sse', mcpAuth, (c) => c.json({ role: c.get('mcpAuth').role }));
  return app;
}

describe('mcpAuth', () => {
  it('returns 401 with a resource_metadata challenge when the token is missing', async () => {
    const response = await appWith('owner').request('http://localhost/api/mcp', { method: 'POST' });
    expect(response.status).toBe(401);
    const challenge = response.headers.get('WWW-Authenticate') ?? '';
    expect(challenge).toContain(
      'resource_metadata="http://localhost/.well-known/oauth-protected-resource/api/mcp"'
    );
    expect(challenge).not.toContain('error=');
  });

  it('points legacy-path challenges at the legacy metadata document', async () => {
    const response = await appWith('owner').request('http://localhost/api/mcp/sse', {
      method: 'POST',
    });
    expect(response.headers.get('WWW-Authenticate')).toContain(
      '/.well-known/oauth-protected-resource/api/mcp/sse"'
    );
  });

  it('returns 401 invalid_token for bad tokens', async () => {
    const response = await appWith('owner').request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer nope' },
    });
    expect(response.status).toBe(401);
    expect(response.headers.get('WWW-Authenticate')).toContain('error="invalid_token"');
  });

  it('returns 401 when the user left the workspace', async () => {
    const response = await appWith(null).request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer good' },
    });
    expect(response.status).toBe(401);
  });

  it('returns 403 for members (valid token, insufficient role)', async () => {
    const response = await appWith('member').request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer good' },
    });
    expect(response.status).toBe(403);
    expect(response.headers.get('WWW-Authenticate')).toBeNull();
  });

  it('passes admins through with their role', async () => {
    const response = await appWith('admin').request('http://localhost/api/mcp', {
      method: 'POST',
      headers: { Authorization: 'Bearer good' },
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: 'admin' });
  });
});
