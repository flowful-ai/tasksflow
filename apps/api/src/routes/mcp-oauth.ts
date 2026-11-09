import { Hono, type Context } from 'hono';
import { getAuth } from '@flowtask/auth';
import { AGENT_TOOLS } from '@flowtask/domain';
import {
  McpOAuthService,
  McpScope,
  OAuthError,
  encodeQuery,
  getAllMcpToolNames,
  normalizeScopes,
  resolveRequestedResource,
} from '../services/mcp-oauth-service.js';
import { describeRedirectTarget } from '../services/mcp-oauth/redirect-uri.js';
import { getBaseUrl } from '../lib/base-url.js';
import { ipRateLimit } from '../lib/mcp/rate-limit.js';

const mcpOAuth = new Hono();
const oauthService = new McpOAuthService();

type ParsedBody = Record<string, string | File | (string | File)[]>;

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function readBodyValue(body: ParsedBody, key: string): string | null {
  const raw = body[key];
  if (raw === undefined) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return typeof first === 'string' ? first : null;
  }
  return typeof raw === 'string' ? raw : null;
}

function readBodyArray(body: ParsedBody, key: string): string[] {
  const raw = body[key];
  if (raw === undefined) return [];
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string');
  }
  return typeof raw === 'string' ? [raw] : [];
}

function oauthErrorBody(error: OAuthError) {
  return {
    error: error.oauthError,
    error_description: error.message,
  };
}

function oauthJsonError(c: Context, error: OAuthError): Response {
  return c.json(oauthErrorBody(error), error.statusCode);
}

function rateLimitedJson(c: Context): Response {
  return c.json({ error: 'slow_down', error_description: 'Too many requests, retry later' }, 429);
}

function buildAuthorizeErrorRedirect(
  redirectUri: string,
  params: { error: string; errorDescription?: string; state?: string }
): string {
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

/**
 * Error page shown when the redirect URI could not be validated. Redirecting
 * to an unverified URI would turn the authorize endpoint into an open redirect.
 */
function renderAuthorizeErrorPage(c: Context, error: unknown): Response {
  const description =
    error instanceof OAuthError ? error.message : 'The authorization request could not be processed.';
  const code = error instanceof OAuthError ? error.oauthError : 'server_error';
  const status = error instanceof OAuthError ? 400 : 500;
  return c.html(
    `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Authorization error</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      .container { max-width: 560px; margin: 40px auto; background: #fff; border-radius: 12px; padding: 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorization error</h1>
      <p>${escapeHtml(description)}</p>
      <p>Error code: <code>${escapeHtml(code)}</code></p>
      <p>You can close this window and retry from your MCP client.</p>
    </div>
  </body>
</html>`,
    status
  );
}

async function getSessionUser(c: Context): Promise<{ id: string; email: string; name?: string | null } | null> {
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

function describeToolScope(toolName: string): { label: string; badge: string | null } {
  const tool = AGENT_TOOLS.find((definition) => definition.name === toolName);
  if (!tool) {
    return { label: toolName, badge: null };
  }
  const annotations = tool.annotations;
  const badge = annotations?.destructiveHint ? 'destructive' : annotations?.readOnlyHint ? 'read-only' : 'writes';
  return { label: annotations?.title ?? toolName, badge };
}

function buildConsentHtml(input: {
  clientName: string;
  clientId: string;
  redirectUri: string;
  state?: string;
  responseType: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  resource: string;
  requestedScopes: string[];
  requestedToolScopes: string[];
  userEmail: string;
  workspaces: Array<{ id: string; name: string; role: string }>;
  selectedWorkspaceId: string;
  workspaceLocked: boolean;
}) {
  const hiddenScope = escapeHtml(input.requestedScopes.join(' '));
  const redirectTarget = describeRedirectTarget(input.redirectUri);
  const toolOptions = input.requestedToolScopes
    .map((scope) => {
      const toolName = scope.slice(McpScope.toolPrefix.length);
      const { label, badge } = describeToolScope(toolName);
      const badgeHtml = badge ? ` <span class="badge badge-${escapeHtml(badge)}">${escapeHtml(badge)}</span>` : '';
      return `<label class="tool"><input type="checkbox" name="approved_tools" value="${escapeHtml(toolName)}" checked /> <span>${escapeHtml(label)}</span> <code>${escapeHtml(toolName)}</code>${badgeHtml}</label>`;
    })
    .join('');
  const selectedWorkspace = input.workspaces.find((workspace) => workspace.id === input.selectedWorkspaceId);
  const workspaceOptions = input.workspaces
    .map((workspace) => {
      const selected = workspace.id === input.selectedWorkspaceId ? ' selected' : '';
      return `<option value="${escapeHtml(workspace.id)}"${selected}>${escapeHtml(workspace.name)} (${escapeHtml(workspace.role)})</option>`;
    })
    .join('');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>TasksFlow MCP Authorization</title>
    <style>
      body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #f8fafc; color: #0f172a; }
      .container { max-width: 720px; margin: 40px auto; background: #ffffff; border-radius: 12px; padding: 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
      h1 { margin-top: 0; }
      .muted { color: #475569; }
      .panel { background: #f1f5f9; border-radius: 8px; padding: 12px; margin: 12px 0; }
      .warning { background: #fef3c7; color: #78350f; border-radius: 8px; padding: 12px; margin: 12px 0; }
      .btns { display: flex; gap: 12px; margin-top: 24px; }
      button { border: 0; border-radius: 8px; padding: 10px 16px; cursor: pointer; }
      .approve { background: #0f766e; color: #fff; }
      .deny { background: #dc2626; color: #fff; }
      .inline { display: flex; align-items: center; gap: 8px; }
      .tool { display: flex; gap: 8px; align-items: center; margin: 6px 0; flex-wrap: wrap; }
      .badge { font-size: 11px; border-radius: 999px; padding: 1px 8px; background: #e2e8f0; color: #334155; }
      .badge-destructive { background: #fee2e2; color: #991b1b; }
      .badge-writes { background: #e0f2fe; color: #075985; }
      .badge-unverified { background: #fde68a; color: #78350f; font-weight: 600; }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>Authorize MCP Client</h1>
      <p class="muted"><strong>${escapeHtml(input.clientName)}</strong> <span class="badge badge-unverified">Unverified client</span> is requesting access to TasksFlow MCP tools.</p>

      <div class="warning">
        The client name is self-declared and has not been verified by TasksFlow.
        After you approve, you will be sent to <strong>${escapeHtml(redirectTarget)}</strong>.
        Only continue if you started this connection and recognise that destination.
      </div>

      <div class="panel">
        <div><strong>Signed in as:</strong> ${escapeHtml(input.userEmail)}</div>
        <div><strong>Redirects to:</strong> <code>${escapeHtml(redirectTarget)}</code></div>
        ${input.workspaceLocked
          ? `<div><strong>Workspace:</strong> ${escapeHtml(selectedWorkspace?.name || 'Unknown')} (${escapeHtml(selectedWorkspace?.role || '')})</div>`
          : '<div><strong>Workspace:</strong> Select below</div>'}
      </div>

      <form method="post" action="/api/mcp/oauth/authorize">
        <h3>Workspace</h3>
        ${input.workspaceLocked
          ? `<input type="hidden" name="workspace_id" value="${escapeHtml(input.selectedWorkspaceId)}" />
             <div style="margin:6px 0 12px 0;">${escapeHtml(selectedWorkspace?.name || '')} (${escapeHtml(selectedWorkspace?.role || '')})</div>`
          : `<select name="workspace_id" style="width:100%;padding:8px;border-radius:8px;border:1px solid #cbd5e1;margin:6px 0 12px 0;">${workspaceOptions}</select>`}

        <h3>Requested tool permissions</h3>
        <label class="inline"><input id="approve-all" type="checkbox" checked /> Select all requested tools</label>
        <div id="tool-list">${toolOptions}</div>

        <input type="hidden" name="response_type" value="${escapeHtml(input.responseType)}" />
        <input type="hidden" name="client_id" value="${escapeHtml(input.clientId)}" />
        <input type="hidden" name="redirect_uri" value="${escapeHtml(input.redirectUri)}" />
        <input type="hidden" name="state" value="${escapeHtml(input.state || '')}" />
        <input type="hidden" name="scope" value="${hiddenScope}" />
        <input type="hidden" name="resource" value="${escapeHtml(input.resource)}" />
        <input type="hidden" name="code_challenge" value="${escapeHtml(input.codeChallenge)}" />
        <input type="hidden" name="code_challenge_method" value="${escapeHtml(input.codeChallengeMethod)}" />

        <div class="btns">
          <button class="approve" type="submit" name="decision" value="approve">Approve</button>
          <button class="deny" type="submit" name="decision" value="deny">Deny</button>
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

function requestedToolScopesOrAll(requested: string[]): string[] {
  return (requested.length > 0 ? requested : getAllMcpToolNames()).map((tool) => `${McpScope.toolPrefix}${tool}`);
}

mcpOAuth.get('/.well-known/oauth-authorization-server', (c) => {
  return c.json(oauthService.getAuthorizationServerMetadata(getBaseUrl(c.req.raw)));
});

// Compatibility endpoint for clients that derive OIDC discovery from the token URL.
// Example probe: /api/mcp/oauth/token/.well-known/openid-configuration
mcpOAuth.get('/oauth/token/.well-known/openid-configuration', (c) => {
  return c.json(oauthService.getAuthorizationServerMetadata(getBaseUrl(c.req.raw)));
});

mcpOAuth.post('/oauth/register', ipRateLimit('register', rateLimitedJson), async (c) => {
  let payload: unknown;
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ error: 'invalid_client_metadata', error_description: 'Request body must be JSON' }, 400);
  }

  try {
    const registration = await oauthService.registerClient(payload);
    return c.json(registration, 201);
  } catch (error) {
    if (error instanceof OAuthError) {
      return oauthJsonError(c, error);
    }
    console.error('MCP OAuth client registration failed', error instanceof Error ? error.message : error);
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
  const resourceParams = c.req.queries('resource') ?? [];
  const baseUrl = getBaseUrl(c.req.raw);

  let trustedRedirectUri: string | null = null;

  try {
    const validated = await oauthService.validateClientRedirect(clientId, redirectUri);
    const client = validated.client;
    trustedRedirectUri = validated.redirectUri;

    const parsed = oauthService.validateAuthorizeRequest({
      responseType,
      scope,
      codeChallenge,
      codeChallengeMethod,
    });
    const resource = resolveRequestedResource(resourceParams, baseUrl);

    const user = await getSessionUser(c);
    if (!user) {
      const webUrl = process.env.WEB_URL || 'http://localhost:3000';
      const requestUrl = new URL(c.req.url);
      const returnTo = `${baseUrl}${requestUrl.pathname}${requestUrl.search}`;
      return c.redirect(`${webUrl}/auth/login?${encodeQuery({ redirect: returnTo })}`, 302);
    }

    const workspaces = await oauthService.listAuthorizableWorkspaces(user.id);
    if (workspaces.length === 0) {
      throw new OAuthError('access_denied', 'No admin/owner workspace available for authorization', 403);
    }

    const selectedWorkspace = parsed.requestedWorkspaceId
      ? workspaces.find((workspace) => workspace.id === parsed.requestedWorkspaceId)
      : workspaces[0];
    if (!selectedWorkspace) {
      throw new OAuthError('access_denied', 'Requested workspace is not available for authorization', 403);
    }
    oauthService.ensureAdminRole(await oauthService.getUserWorkspaceRole(selectedWorkspace.id, user.id));

    return c.html(
      buildConsentHtml({
        clientName: client.clientName,
        clientId: client.clientId,
        redirectUri: validated.redirectUri,
        state,
        responseType: 'code',
        codeChallenge: parsed.codeChallenge,
        codeChallengeMethod: 'S256',
        resource,
        requestedScopes: parsed.scopes,
        requestedToolScopes: requestedToolScopesOrAll(parsed.requestedToolScopes),
        userEmail: user.email,
        workspaces,
        selectedWorkspaceId: selectedWorkspace.id,
        workspaceLocked: Boolean(parsed.requestedWorkspaceId),
      })
    );
  } catch (error) {
    if (trustedRedirectUri) {
      return c.redirect(
        buildAuthorizeErrorRedirect(trustedRedirectUri, {
          error: error instanceof OAuthError ? error.oauthError : 'server_error',
          errorDescription: error instanceof OAuthError ? error.message : 'Authorization failed',
          state,
        }),
        302
      );
    }
    return renderAuthorizeErrorPage(c, error);
  }
});

mcpOAuth.post('/oauth/authorize', async (c) => {
  const body = await c.req.parseBody({ all: true });

  const responseType = readBodyValue(body, 'response_type') || undefined;
  const clientId = readBodyValue(body, 'client_id') || undefined;
  const redirectUri = readBodyValue(body, 'redirect_uri') || undefined;
  const scope = readBodyValue(body, 'scope') || undefined;
  const state = readBodyValue(body, 'state') || undefined;
  const codeChallenge = readBodyValue(body, 'code_challenge') || undefined;
  const codeChallengeMethod = readBodyValue(body, 'code_challenge_method') || undefined;
  const decision = readBodyValue(body, 'decision') || undefined;
  const workspaceIdFromBody = readBodyValue(body, 'workspace_id') || undefined;
  const resourceParams = readBodyArray(body, 'resource');
  const baseUrl = getBaseUrl(c.req.raw);

  let trustedRedirectUri: string | null = null;

  try {
    const { client, redirectUri: validatedRedirectUri } = await oauthService.validateClientRedirect(
      clientId,
      redirectUri
    );
    trustedRedirectUri = validatedRedirectUri;

    if (decision === 'deny') {
      throw new OAuthError('access_denied', 'User denied authorization');
    }

    const parsed = oauthService.validateAuthorizeRequest({
      responseType,
      scope,
      codeChallenge,
      codeChallengeMethod,
    });
    const resource = resolveRequestedResource(resourceParams, baseUrl);

    const user = await getSessionUser(c);
    if (!user) {
      throw new OAuthError('access_denied', 'Authentication required', 401);
    }

    const workspaceId = parsed.requestedWorkspaceId || workspaceIdFromBody;
    if (!workspaceId) {
      throw new OAuthError('invalid_request', 'workspace_id is required');
    }

    if (parsed.requestedWorkspaceId && workspaceIdFromBody && parsed.requestedWorkspaceId !== workspaceIdFromBody) {
      throw new OAuthError('invalid_request', 'workspace_id does not match requested workspace scope');
    }

    const requestedToolScopes = requestedToolScopesOrAll(parsed.requestedToolScopes);
    const approvedToolScopes = normalizeScopes(
      readBodyArray(body, 'approved_tools')
        .map((tool) => `${McpScope.toolPrefix}${tool}`)
        .filter((scopeValue) => requestedToolScopes.includes(scopeValue))
    );

    if (approvedToolScopes.length === 0) {
      throw new OAuthError('access_denied', 'At least one tool permission must be approved');
    }

    const role = await oauthService.getUserWorkspaceRole(workspaceId, user.id);
    oauthService.ensureAdminRole(role);
    if (!role) {
      throw new OAuthError('access_denied', 'Workspace membership required', 403);
    }

    const approvedScopes = [`${McpScope.workspacePrefix}${workspaceId}`, ...approvedToolScopes];

    await oauthService.upsertConsent({
      userId: user.id,
      workspaceId,
      clientInternalId: client.id,
      approvedScopes,
      grantedByRole: role,
    });

    const code = await oauthService.createAuthorizationCode({
      clientInternalId: client.id,
      userId: user.id,
      workspaceId,
      redirectUri: validatedRedirectUri,
      scopes: approvedScopes,
      codeChallenge: parsed.codeChallenge,
      codeChallengeMethod: 'S256',
      resource,
    });

    const successRedirect = new URL(validatedRedirectUri);
    successRedirect.searchParams.set('code', code);
    if (state) {
      successRedirect.searchParams.set('state', state);
    }

    return c.redirect(successRedirect.toString(), 302);
  } catch (error) {
    if (trustedRedirectUri) {
      return c.redirect(
        buildAuthorizeErrorRedirect(trustedRedirectUri, {
          error: error instanceof OAuthError ? error.oauthError : 'server_error',
          errorDescription: error instanceof OAuthError ? error.message : 'Authorization failed',
          state,
        }),
        302
      );
    }
    return renderAuthorizeErrorPage(c, error);
  }
});

mcpOAuth.post('/oauth/token', ipRateLimit('token', rateLimitedJson), async (c) => {
  const body = await c.req.parseBody({ all: true });
  const grantType = readBodyValue(body, 'grant_type');
  const baseUrl = getBaseUrl(c.req.raw);
  const resource = readBodyArray(body, 'resource');
  const tokenRequestContext = {
    grantType: grantType ?? null,
    hasClientId: Boolean(readBodyValue(body, 'client_id')),
    hasResource: resource.length > 0,
    userAgent: c.req.header('user-agent') ?? null,
  };

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
        resource,
        baseUrl,
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
        resource,
        baseUrl,
      });

      c.header('Cache-Control', 'no-store');
      c.header('Pragma', 'no-cache');
      return c.json(tokenResponse);
    }

    throw new OAuthError('unsupported_grant_type', 'Unsupported grant_type');
  } catch (error) {
    if (error instanceof OAuthError) {
      console.warn('MCP OAuth token exchange failed', {
        ...tokenRequestContext,
        oauthError: error.oauthError,
        statusCode: error.statusCode,
      });
      return oauthJsonError(c, error);
    }

    console.error('MCP OAuth token exchange failed with unexpected error', {
      ...tokenRequestContext,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return c.json({ error: 'server_error', error_description: 'Token exchange failed' }, 500);
  }
});

mcpOAuth.post('/oauth/revoke', ipRateLimit('token', rateLimitedJson), async (c) => {
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
