/**
 * OAuth flow tests against a real Postgres. Skipped unless TEST_DATABASE_URL
 * points at a database with the current schema, e.g.
 *   TEST_DATABASE_URL=postgresql://flowtask:flowtask@127.0.0.1:55432/flowtask_a2 bun test flows.integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createDatabase, type Database } from '../../db/index.js';
import { mcpOAuthClients, users, workspaceMembers, workspaces } from '../../db/schema.js';
import { OAuthError } from './errors.js';
import { buildS256CodeChallenge } from './crypto.js';
import { createAuthorizationCode, exchangeAuthorizationCode } from './codes.js';
import { authenticateAccessToken, refreshAccessToken, revokeToken, REFRESH_REUSE_GRACE_SECONDS } from './tokens.js';

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
const BASE_URL = 'https://tasks.test';
const REDIRECT_URI = 'http://127.0.0.1:33418/callback';
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

describe.skipIf(!TEST_DATABASE_URL)('MCP OAuth flows (database)', () => {
  let db: Database;
  const userId = randomUUID();
  const workspaceId = randomUUID();
  let clientInternalId = '';
  let clientId = '';

  beforeAll(async () => {
    db = createDatabase(TEST_DATABASE_URL);
    await db.insert(users).values({ id: userId, email: `oauth-${userId}@example.com`, name: 'OAuth Test' });
    await db.insert(workspaces).values({ id: workspaceId, name: 'OAuth WS', slug: `oauth-${workspaceId}` });
    await db.insert(workspaceMembers).values({ workspaceId, userId, role: 'owner' });
    clientId = `ft_mcp_client_test_${randomUUID()}`;
    const [client] = await db
      .insert(mcpOAuthClients)
      .values({ clientId, clientName: 'Test client', redirectUris: [REDIRECT_URI] })
      .returning();
    clientInternalId = client?.id ?? '';
  });

  afterAll(async () => {
    await db.delete(mcpOAuthClients).where(eq(mcpOAuthClients.id, clientInternalId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(users).where(eq(users.id, userId));
  });

  async function newCode(resource = `${BASE_URL}/api/mcp`) {
    return createAuthorizationCode(db, {
      clientInternalId,
      userId,
      workspaceId,
      redirectUri: REDIRECT_URI,
      scopes: [`mcp:workspace:${workspaceId}`, 'mcp:tool:query_tasks'],
      codeChallenge: buildS256CodeChallenge(VERIFIER),
      codeChallengeMethod: 'S256',
      resource,
    });
  }

  function redeem(code: string, resource?: string[]) {
    return exchangeAuthorizationCode(db, {
      code,
      clientId,
      redirectUri: REDIRECT_URI,
      codeVerifier: VERIFIER,
      resource,
      baseUrl: BASE_URL,
    });
  }

  async function oauthErrorOf(promise: Promise<unknown>): Promise<string | null> {
    try {
      await promise;
      return null;
    } catch (error) {
      return error instanceof OAuthError ? error.oauthError : 'unexpected';
    }
  }

  it('redeems a code exactly once under concurrency and revokes tokens on replay', async () => {
    const code = await newCode();
    const results = await Promise.allSettled([redeem(code), redeem(code), redeem(code)]);
    const fulfilled = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(2);
    for (const result of rejected) {
      expect(result.status === 'rejected' && result.reason instanceof OAuthError && result.reason.oauthError).toBe('invalid_grant');
    }

    // The replay revoked the family issued from that code.
    const winner = fulfilled[0];
    const accessToken = winner?.status === 'fulfilled' ? winner.value.access_token : '';
    expect(await oauthErrorOf(authenticateAccessToken(db, accessToken, { baseUrl: BASE_URL }))).toBe('invalid_token');
  });

  it('does not consume the code when the verifier is wrong', async () => {
    const code = await newCode();
    const wrong = exchangeAuthorizationCode(db, {
      code,
      clientId,
      redirectUri: REDIRECT_URI,
      codeVerifier: 'wrong-verifier-wrong-verifier-wrong-verifier-123',
      baseUrl: BASE_URL,
    });
    expect(await oauthErrorOf(wrong)).toBe('invalid_grant');
    const tokens = await redeem(code);
    expect(tokens.access_token).toBeTruthy();
  });

  it('rotates refresh tokens, tolerates a concurrent race, and revokes the family on reuse', async () => {
    const issued = await redeem(await newCode());
    const refresh = (token: string, clock?: () => Date) =>
      refreshAccessToken(db, { refreshToken: token, clientId, baseUrl: BASE_URL }, clock);

    // Concurrent refreshes of the same token get the same successor.
    const [first, second] = await Promise.all([refresh(issued.refresh_token), refresh(issued.refresh_token)]);
    expect(first.refresh_token).not.toBe(issued.refresh_token);
    expect(second.refresh_token).toBe(first.refresh_token);
    expect(second.access_token).toBe(first.access_token);

    // The successor keeps working.
    const third = await refresh(first.refresh_token);
    expect(third.refresh_token).not.toBe(first.refresh_token);

    // Replaying a rotated token after the grace window revokes the whole family.
    const later = () => new Date(Date.now() + (REFRESH_REUSE_GRACE_SECONDS + 5) * 1000);
    expect(await oauthErrorOf(refresh(issued.refresh_token, later))).toBe('invalid_grant');
    expect(await oauthErrorOf(refresh(third.refresh_token))).toBe('invalid_grant');
    expect(await oauthErrorOf(authenticateAccessToken(db, third.access_token, { baseUrl: BASE_URL }))).toBe('invalid_token');
  });

  it('revoking a refresh token also revokes its access tokens', async () => {
    const issued = await redeem(await newCode());
    await authenticateAccessToken(db, issued.access_token, { baseUrl: BASE_URL });
    await revokeToken(db, { token: issued.refresh_token, tokenTypeHint: 'refresh_token' });
    expect(await oauthErrorOf(authenticateAccessToken(db, issued.access_token, { baseUrl: BASE_URL }))).toBe('invalid_token');
  });

  it('binds tokens to the MCP resource', async () => {
    const issued = await redeem(await newCode(`${BASE_URL}/api/mcp/sse`));
    const auth = await authenticateAccessToken(db, issued.access_token, { baseUrl: BASE_URL });
    expect(auth.resource).toBe(`${BASE_URL}/api/mcp/sse`);
    expect(await oauthErrorOf(authenticateAccessToken(db, issued.access_token, { baseUrl: 'https://other.test' }))).toBe(
      'invalid_token'
    );

    expect(await oauthErrorOf(redeem(await newCode(), ['https://evil.test/api/mcp']))).toBe('invalid_target');
    expect(await oauthErrorOf(redeem(await newCode(), [`${BASE_URL}/api/mcp/sse`]))).toBe('invalid_target');
    const matching = await redeem(await newCode(), [`${BASE_URL}/api/mcp`]);
    expect(matching.access_token).toBeTruthy();
  });

  describe('authorize endpoint redirect safety', () => {
    async function oauthApp() {
      process.env.DATABASE_URL ??= TEST_DATABASE_URL;
      const { Hono } = await import('hono');
      const { mcpOAuthRoutes } = await import('../../routes/mcp-oauth.js');
      return new Hono().route('/api/mcp', mcpOAuthRoutes);
    }

    function authorizeUrl(params: Record<string, string>) {
      return `http://localhost/api/mcp/oauth/authorize?${new URLSearchParams(params).toString()}`;
    }

    it('never redirects to an unregistered redirect_uri', async () => {
      const app = await oauthApp();
      const unknownClient = await app.request(
        authorizeUrl({ client_id: 'nope', redirect_uri: 'https://evil.example/cb', response_type: 'code' })
      );
      expect(unknownClient.status).toBe(400);
      expect(unknownClient.headers.get('Location')).toBeNull();

      const unregistered = await app.request(
        authorizeUrl({ client_id: clientId, redirect_uri: 'https://evil.example/cb', response_type: 'token' })
      );
      expect(unregistered.status).toBe(400);
      expect(unregistered.headers.get('Location')).toBeNull();

      const deny = await app.request('http://localhost/api/mcp/oauth/authorize', {
        method: 'POST',
        body: new URLSearchParams({ client_id: clientId, redirect_uri: 'https://evil.example/cb', decision: 'deny' }),
      });
      expect(deny.status).toBe(400);
      expect(deny.headers.get('Location')).toBeNull();
    });

    it('redirects errors to a registered redirect_uri', async () => {
      const app = await oauthApp();
      const response = await app.request(
        authorizeUrl({ client_id: clientId, redirect_uri: REDIRECT_URI, response_type: 'token', state: 'xyz' })
      );
      expect(response.status).toBe(302);
      const location = new URL(response.headers.get('Location') ?? '');
      expect(`${location.origin}${location.pathname}`).toBe(REDIRECT_URI);
      expect(location.searchParams.get('error')).toBe('unsupported_response_type');
      expect(location.searchParams.get('state')).toBe('xyz');

      const deny = await app.request('http://localhost/api/mcp/oauth/authorize', {
        method: 'POST',
        body: new URLSearchParams({ client_id: clientId, redirect_uri: REDIRECT_URI, decision: 'deny', state: 's1' }),
      });
      expect(deny.status).toBe(302);
      expect(new URL(deny.headers.get('Location') ?? '').searchParams.get('error')).toBe('access_denied');
    });
  });
});
