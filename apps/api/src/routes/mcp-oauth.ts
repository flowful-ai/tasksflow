import { Hono } from 'hono';
import { McpOAuthService, McpScope, OAuthError, encodeQuery, normalizeScopes } from '../services/mcp-oauth-service.js';
import { getAuth } from '@flowtask/auth';

const mcpOAuth = new Hono();
const oauthService = new McpOAuthService();

function getBaseUrl(requestUrl: string, headers: Headers): string {
  const url = new URL(requestUrl);
  const forwardedProto = headers.get('x-forwarded-proto');
  const forwardedHost = headers.get('x-forwarded-host');

  const protocol = forwardedProto || url.protocol.replace(':', '');
  const host = forwardedHost || url.host;

  return `${protocol}://${host}`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readBodyValue(body: Record<string, string | File | (string | File)[]>, key: string): string | null {
  const raw = body[key];
  if (raw === undefined) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === 'string' ? first : null;
  }
  return typeof raw === 'string' ? raw : null;
}

function readBodyArray(body: Record<string, string | File | (string | File)[]>, key: string): string[] {
  const raw = body[key];
  if (raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string');
  }
  return typeof raw === 'string' ? [raw] : [];
}

function oauthErrorResponse(error: OAuthError) {
  return {
    error: error.oauthError,
    error_description: error.message,
  };
}

function buildAuthorizeErrorRedirect(redirectUri: string, params: {
  error: string;
  errorDescription?: string;
  state?: string;
}) {
  const url = new URL(redirectUri);
  url.searchParams.set('error', params.error);
  if (params.errorDescription) {
    url.searchParams.set('error_description', params.errorDescription);
  }
  if (params.state) {
    url.searchParams.set('state', params.state);
  }
  return url.toString();
}

async function getSessionUser(c: any): Promise<{ id: string; email: string; name?: string | null } | null> {
  const auth = getAuth();
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session?.user) {
    return null;
  }
  return {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
  };
}

function buildConsentHtml(input: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  requestedScopes: string[];
  requestedWorkspaceScope: string;
  requestedToolScopes: string[];
  userEmail: string;
  workspaceName: string;
  workspaceRole: string;
}) {
  const hiddenScope = escapeHtml(input.requestedScopes.join(' '));
  const toolOptions = input.requestedToolScopes
    .map((scope) => {
      const toolName = scope.slice(McpScope.toolPrefix.length);
      return `<label style=\"display:flex;gap:8px;align-items:center;margin:6px 0;\"><input type=\"checkbox\" name=\"approved_tools\" value=\"${escapeHtml(toolName)}\" checked /> <code>${escapeHtml(toolName)}</code></label>`;
    })
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\" />
    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
    <title>FlowTask MCP Authorization</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      .container { max-width: 720px; margin: 40px auto; background: #ffffff; border-radius: 12px; padding: 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; }
      .muted { color: #475569; }
      .panel { background: #f1f5f9; border-radius: 8px; padding: 12px; margin: 12px 0; }
      .btns { display: flex; gap: 12px; margin-top: 24px; }
      button { border: 0; border-radius: 8px; padding: 10px 16px; cursor: pointer; }
      .approve { background: #0f766e; color: #fff; }
      .deny { background: #dc2626; color: #fff; }
      .inline { display: flex; align-items: center; gap: 8px; }
    </style>
  </head>
  <body>
    <div class=\"container\">
      <h1>Authorize MCP Client</h1>
      <p class=\"muted\"><strong>${escapeHtml(input.clientName)}</strong> is requesting access to FlowTask MCP tools.</p>

      <div class=\"panel\">
        <div><strong>Signed in as:</strong> ${escapeHtml(input.userEmail)}</div>
        <div><strong>Workspace:</strong> ${escapeHtml(input.workspaceName)} (${escapeHtml(input.workspaceRole)})</div>
      </div>

      <form method=\"post\" action=\"/api/mcp/oauth/authorize\">
        <h3>Requested tool permissions</h3>
        <label class=\"inline\"><input id=\"approve-all\" type=\"checkbox\" checked /> Select all requested tools</label>
        <div id=\"tool-list\">${toolOptions}</div>

        <input type=\"hidden\" name=\"response_type\" value=\"${escapeHtml(input.responseType)}\" />
        <input type=\"hidden\" name=\"client_id\" value=\"${escapeHtml(input.clientId)}\" />
        <input type=\"hidden\" name=\"redirect_uri\" value=\"${escapeHtml(input.redirectUri)}\" />
        <input type=\"hidden\" name=\"state\" value=\"${escapeHtml(input.state || '')}\" />
        <input type=\"hidden\" name=\"scope\" value=\"${hiddenScope}\" />
        <input type=\"hidden\" name=\"workspace_scope\" value=\"${escapeHtml(input.requestedWorkspaceScope)}\" />
        <input type=\"hidden\" name=\"code_challenge\" value=\"${escapeHtml(input.codeChallenge)}\" />
        <input type=\"hidden\" name=\"code_challenge_method\" value=\"${escapeHtml(input.codeChallengeMethod)}\" />

        <div class=\"btns\">
          <button class=\"approve\" type=\"submit\" name=\"decision\" value=\"approve\">Approve</button>
          <button class=\"deny\" type=\"submit\" name=\"decision\" value=\"deny\">Deny</button>
        </div>
      </form>
    </div>

    <script>
      const approveAll = document.getElementById('approve-all');
      const toolInputs = Array.from(document.querySelectorAll('input[name="approved_tools"]'));

      const syncApproveAll = () => {
        approveAll.checked = toolInputs.every((input) => input.checked);
      };

      approveAll.addEventListener('change', () => {
        for (const input of toolInputs) {
          input.checked = approveAll.checked;
        }
      });

      for (const input of toolInputs) {
        input.addEventListener('change', syncApproveAll);
      }
    </script>
  </body>
</html>`;
}

mcpOAuth.get('/.well-known/oauth-authorization-server', (c) => {
  const baseUrl = getBaseUrl(c.req.url, c.req.raw.headers);
  return c.json(oauthService.getAuthorizationServerMetadata(baseUrl));
});

mcpOAuth.post('/oauth/register', async (c) => {
  try {
    const payload = await c.req.json();
    const registration = await oauthService.registerClient(payload);
    return c.json(registration, 201);
  } catch (error) {
    if (error instanceof OAuthError) {
      return c.json(oauthErrorResponse(error), error.statusCode as 400 | 401 | 403);
    }
    return c.json({ error: 'server_error', error_description: 'Unable to register client' }, 500);
  }
});

mcpOAuth.get('/oauth/authorize', async (c) => {
  const responseType = c.req.query('response_type');
  const clientId = c.req.query('client_id');
  const redirectUri = c.req.query('redirect_uri');
  const scope = c.req.query('scope');
  const state = c.req.query('state');
  const codeChallenge = c.req.query('code_challenge');
  const codeChallengeMethod = c.req.query('code_challenge_method');

  try {
    const parsed = oauthService.validateAuthorizeRequest({
      responseType,
      clientId,
      redirectUri,
      scope,
      codeChallenge,
      codeChallengeMethod,
    });

    const client = await oauthService.validateClientRedirect(clientId!, redirectUri!);
    const user = await getSessionUser(c);

    if (!user) {
      const webUrl = process.env.WEB_URL || 'http://localhost:3000';
      const loginUrl = `${webUrl}/auth/login?${encodeQuery({ redirect: c.req.url })}`;
      return c.redirect(loginUrl, 302);
    }

    const role = await oauthService.getUserWorkspaceRole(parsed.workspaceId, user.id);
    oauthService.ensureAdminRole(role);

    const workspaces = await oauthService.listAuthorizableWorkspaces(user.id);
    const selectedWorkspace = workspaces.find((workspace) => workspace.id === parsed.workspaceId);

    if (!selectedWorkspace) {
      throw new OAuthError('access_denied', 'No authorizable workspace found for requested scope', 403);
    }

    const requestedWorkspaceScope = parsed.scopes.find((item) => item.startsWith(McpScope.workspacePrefix));
    const requestedToolScopes = parsed.scopes.filter((item) => item.startsWith(McpScope.toolPrefix));

    return c.html(
      buildConsentHtml({
        clientName: client.clientName,
        clientId: client.clientId,
        redirectUri: redirectUri!,
        state,
        responseType: responseType!,
        codeChallenge: codeChallenge!,
        codeChallengeMethod: codeChallengeMethod!,
        requestedScopes: parsed.scopes,
        requestedWorkspaceScope: requestedWorkspaceScope!,
        requestedToolScopes,
        userEmail: user.email,
        workspaceName: selectedWorkspace.name,
        workspaceRole: selectedWorkspace.role,
      })
    );
  } catch (error) {
    if (redirectUri) {
      const errorValue = error instanceof OAuthError ? error.oauthError : 'server_error';
      const errorDescription = error instanceof Error ? error.message : 'Authorization failed';
      return c.redirect(
        buildAuthorizeErrorRedirect(redirectUri, {
          error: errorValue,
          errorDescription,
          state,
        }),
        302
      );
    }

    if (error instanceof OAuthError) {
      return c.json(oauthErrorResponse(error), error.statusCode as 400 | 401 | 403);
    }

    return c.json({ error: 'server_error', error_description: 'Authorization failed' }, 500);
  }
});

mcpOAuth.post('/oauth/authorize', async (c) => {
  const body = await c.req.parseBody();

  const responseType = readBodyValue(body, 'response_type') || undefined;
  const clientId = readBodyValue(body, 'client_id') || undefined;
  const redirectUri = readBodyValue(body, 'redirect_uri') || undefined;
  const scope = readBodyValue(body, 'scope') || undefined;
  const state = readBodyValue(body, 'state') || undefined;
  const codeChallenge = readBodyValue(body, 'code_challenge') || undefined;
  const codeChallengeMethod = readBodyValue(body, 'code_challenge_method') || undefined;
  const decision = readBodyValue(body, 'decision') || undefined;

  if (!redirectUri) {
    return c.json({ error: 'invalid_request', error_description: 'redirect_uri is required' }, 400);
  }

  try {
    if (decision === 'deny') {
      return c.redirect(
        buildAuthorizeErrorRedirect(redirectUri, {
          error: 'access_denied',
          errorDescription: 'User denied authorization',
          state,
        }),
        302
      );
    }

    const parsed = oauthService.validateAuthorizeRequest({
      responseType,
      clientId,
      redirectUri,
      scope,
      codeChallenge,
      codeChallengeMethod,
    });

    const client = await oauthService.validateClientRedirect(clientId!, redirectUri);
    const user = await getSessionUser(c);

    if (!user) {
      throw new OAuthError('access_denied', 'Authentication required', 401);
    }

    const requestedWorkspaceScope = parsed.scopes.find((item) => item.startsWith(McpScope.workspacePrefix));
    if (!requestedWorkspaceScope) {
      throw new OAuthError('invalid_scope', 'Missing workspace scope');
    }

    const approvedTools = readBodyArray(body, 'approved_tools');
    const requestedToolScopes = parsed.scopes.filter((item) => item.startsWith(McpScope.toolPrefix));
    const approvedToolScopes = normalizeScopes(
      approvedTools
        .map((tool) => `${McpScope.toolPrefix}${tool}`)
        .filter((scopeValue) => requestedToolScopes.includes(scopeValue))
    );

    if (approvedToolScopes.length === 0) {
      throw new OAuthError('access_denied', 'At least one tool permission must be approved');
    }

    const workspaceId = requestedWorkspaceScope.slice(McpScope.workspacePrefix.length);
    const role = await oauthService.getUserWorkspaceRole(workspaceId, user.id);
    oauthService.ensureAdminRole(role);

    const approvedScopes = [requestedWorkspaceScope, ...approvedToolScopes];

    await oauthService.upsertConsent({
      userId: user.id,
      workspaceId,
      clientInternalId: client.id,
      approvedScopes,
      grantedByRole: role!,
    });

    const code = await oauthService.createAuthorizationCode({
      clientInternalId: client.id,
      userId: user.id,
      workspaceId,
      redirectUri,
      scopes: approvedScopes,
      codeChallenge: codeChallenge!,
      codeChallengeMethod: 'S256',
    });

    const successRedirect = new URL(redirectUri);
    successRedirect.searchParams.set('code', code);
    if (state) {
      successRedirect.searchParams.set('state', state);
    }

    return c.redirect(successRedirect.toString(), 302);
  } catch (error) {
    const errorValue = error instanceof OAuthError ? error.oauthError : 'server_error';
    const errorDescription = error instanceof Error ? error.message : 'Authorization failed';

    return c.redirect(
      buildAuthorizeErrorRedirect(redirectUri, {
        error: errorValue,
        errorDescription,
        state,
      }),
      302
    );
  }
});

mcpOAuth.post('/oauth/token', async (c) => {
  const body = await c.req.parseBody();
  const grantType = readBodyValue(body, 'grant_type');

  try {
    if (grantType === 'authorization_code') {
      const code = readBodyValue(body, 'code');
      const clientId = readBodyValue(body, 'client_id');
      const redirectUri = readBodyValue(body, 'redirect_uri');
      const codeVerifier = readBodyValue(body, 'code_verifier');

      if (!code || !clientId || !redirectUri || !codeVerifier) {
        throw new OAuthError('invalid_request', 'code, client_id, redirect_uri, and code_verifier are required');
      }

      const tokenResponse = await oauthService.exchangeAuthorizationCode({
        code,
        clientId,
        redirectUri,
        codeVerifier,
      });

      c.header('Cache-Control', 'no-store');
      c.header('Pragma', 'no-cache');
      return c.json(tokenResponse);
    }

    if (grantType === 'refresh_token') {
      const refreshToken = readBodyValue(body, 'refresh_token');
      const clientId = readBodyValue(body, 'client_id');
      const scope = readBodyValue(body, 'scope') || undefined;

      if (!refreshToken || !clientId) {
        throw new OAuthError('invalid_request', 'refresh_token and client_id are required');
      }

      const tokenResponse = await oauthService.refreshAccessToken({
        refreshToken,
        clientId,
        scope,
      });

      c.header('Cache-Control', 'no-store');
      c.header('Pragma', 'no-cache');
      return c.json(tokenResponse);
    }

    throw new OAuthError('unsupported_grant_type', 'Unsupported grant_type');
  } catch (error) {
    if (error instanceof OAuthError) {
      return c.json(oauthErrorResponse(error), error.statusCode as 400 | 401 | 403);
    }

    return c.json({ error: 'server_error', error_description: 'Token exchange failed' }, 500);
  }
});

mcpOAuth.post('/oauth/revoke', async (c) => {
  const body = await c.req.parseBody();

  const token = readBodyValue(body, 'token');
  const clientId = readBodyValue(body, 'client_id') || undefined;
  const tokenTypeHint = readBodyValue(body, 'token_type_hint') || undefined;

  if (!token) {
    return c.json({ error: 'invalid_request', error_description: 'token is required' }, 400);
  }

  await oauthService.revokeToken({
    token,
    clientId,
    tokenTypeHint: tokenTypeHint === 'access_token' || tokenTypeHint === 'refresh_token' ? tokenTypeHint : undefined,
  });

  return c.body(null, 200);
});

export { mcpOAuth as mcpOAuthRoutes };
