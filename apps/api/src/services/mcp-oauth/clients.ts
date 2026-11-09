import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db/index.js';
import { mcpOAuthClients, type McpOAuthClient, type NewMcpOAuthClient } from '../../db/schema.js';
import { OAuthError } from './errors.js';
import { randomClientId } from './crypto.js';
import {
  sanitizeClientName,
  validateOptionalMetadataUrl,
  validateRedirectUris,
} from './redirect-uri.js';
import {
  isSubset,
  parseToolScopes,
  splitScopeString,
  validateToolScopes,
  WORKSPACE_SCOPE_PREFIX,
} from './scopes.js';

const ClientRegistrationSchema = z.object({
  client_name: z.string(),
  redirect_uris: z.array(z.string()),
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  token_endpoint_auth_method: z.string().optional(),
  scope: z.string().max(4000).optional(),
  client_uri: z.string().optional(),
  logo_uri: z.string().optional(),
  tos_uri: z.string().optional(),
  policy_uri: z.string().optional(),
});

export type McpOAuthClientRegistrationInput = z.infer<typeof ClientRegistrationSchema>;

export interface McpOAuthClientRegistration {
  client_id: string;
  client_id_issued_at: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope?: string;
  client_uri?: string;
  logo_uri?: string;
  tos_uri?: string;
  policy_uri?: string;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

export function getClientRedirectUris(client: McpOAuthClient): string[] {
  return stringArray(client.redirectUris);
}

export async function registerClient(
  db: Database,
  payload: unknown
): Promise<McpOAuthClientRegistration> {
  const parsed = ClientRegistrationSchema.safeParse(payload);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join('.') || 'body';
    throw new OAuthError(
      'invalid_client_metadata',
      `Invalid client metadata (${field}): ${issue?.message ?? 'invalid'}`
    );
  }
  const input = parsed.data;

  const clientName = sanitizeClientName(input.client_name);
  const redirectUris = validateRedirectUris(input.redirect_uris);

  if ((input.token_endpoint_auth_method || 'none') !== 'none') {
    throw new OAuthError(
      'invalid_client_metadata',
      'Only token_endpoint_auth_method=none is supported'
    );
  }

  if (input.grant_types && !isSubset(input.grant_types, ['authorization_code', 'refresh_token'])) {
    throw new OAuthError('invalid_client_metadata', 'Unsupported grant_types requested');
  }

  if (input.response_types && !isSubset(input.response_types, ['code'])) {
    throw new OAuthError('invalid_client_metadata', 'Unsupported response_types requested');
  }

  const now = new Date();
  const insertData: NewMcpOAuthClient = {
    clientId: randomClientId(),
    clientName,
    redirectUris,
    grantTypes: input.grant_types || ['authorization_code', 'refresh_token'],
    responseTypes: input.response_types || ['code'],
    tokenEndpointAuthMethod: 'none',
    scope: input.scope,
    clientUri: validateOptionalMetadataUrl('client_uri', input.client_uri),
    logoUri: validateOptionalMetadataUrl('logo_uri', input.logo_uri),
    tosUri: validateOptionalMetadataUrl('tos_uri', input.tos_uri),
    policyUri: validateOptionalMetadataUrl('policy_uri', input.policy_uri),
    createdAt: now,
    updatedAt: now,
  };

  const [client] = await db.insert(mcpOAuthClients).values(insertData).returning();
  if (!client) {
    throw new OAuthError('server_error', 'Failed to persist OAuth client', 500);
  }

  return {
    client_id: client.clientId,
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    client_name: client.clientName,
    redirect_uris: getClientRedirectUris(client),
    grant_types: stringArray(client.grantTypes),
    response_types: stringArray(client.responseTypes),
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
    scope: client.scope || undefined,
    client_uri: client.clientUri || undefined,
    logo_uri: client.logoUri || undefined,
    tos_uri: client.tosUri || undefined,
    policy_uri: client.policyUri || undefined,
  };
}

export async function getClientByPublicId(
  db: Database,
  clientId: string
): Promise<McpOAuthClient | null> {
  const [client] = await db
    .select()
    .from(mcpOAuthClients)
    .where(eq(mcpOAuthClients.clientId, clientId));
  return client || null;
}

/**
 * Resolves the client and checks the redirect URI is an exact registered
 * match. Until this succeeds the redirect URI is untrusted and must never be
 * redirected to.
 */
export async function validateClientRedirect(
  db: Database,
  clientId: string | undefined,
  redirectUri: string | undefined
): Promise<{ client: McpOAuthClient; redirectUri: string }> {
  if (!clientId) {
    throw new OAuthError('invalid_request', 'client_id is required');
  }
  if (!redirectUri) {
    throw new OAuthError('invalid_request', 'redirect_uri is required');
  }

  const client = await getClientByPublicId(db, clientId);
  if (!client) {
    throw new OAuthError('invalid_client', 'Unknown client_id', 401);
  }

  if (!getClientRedirectUris(client).includes(redirectUri)) {
    throw new OAuthError('invalid_request', 'redirect_uri is not registered for this client');
  }

  return { client, redirectUri };
}

export interface ParsedAuthorizeRequest {
  codeChallenge: string;
  scopes: string[];
  requestedWorkspaceId: string | null;
  requestedToolScopes: string[];
}

export function validateAuthorizeRequest(params: {
  responseType?: string;
  scope?: string;
  codeChallenge?: string;
  codeChallengeMethod?: string;
}): ParsedAuthorizeRequest {
  if (params.responseType !== 'code') {
    throw new OAuthError('unsupported_response_type', 'Only response_type=code is supported');
  }

  if (!params.codeChallenge) {
    throw new OAuthError('invalid_request', 'code_challenge is required');
  }

  if (params.codeChallengeMethod !== 'S256') {
    throw new OAuthError('invalid_request', 'Only code_challenge_method=S256 is supported');
  }

  const scopeString = (params.scope || '').trim();
  const scopes = scopeString ? splitScopeString(scopeString) : [];
  const workspaceScopes = scopes.filter((scope) => scope.startsWith(WORKSPACE_SCOPE_PREFIX));

  if (workspaceScopes.length > 1) {
    throw new OAuthError('invalid_scope', 'Only one workspace scope may be requested');
  }

  const toolValidation = validateToolScopes(scopes);
  if (!toolValidation.ok) {
    throw new OAuthError(
      'invalid_scope',
      `Unknown tool scopes: ${toolValidation.invalidTools.join(', ')}`
    );
  }

  const requestedWorkspaceIdRaw =
    workspaceScopes.length === 1
      ? workspaceScopes[0]?.slice(WORKSPACE_SCOPE_PREFIX.length) || null
      : null;

  // Some MCP clients (including ChatGPT) send template placeholder scopes like "{workspaceId}".
  // Treat those as "workspace to be selected at consent time" instead of a literal workspace id.
  const requestedWorkspaceId =
    requestedWorkspaceIdRaw && !/^\{.+\}$/.test(requestedWorkspaceIdRaw)
      ? requestedWorkspaceIdRaw
      : null;

  return {
    codeChallenge: params.codeChallenge,
    scopes,
    requestedWorkspaceId,
    requestedToolScopes: parseToolScopes(scopes),
  };
}
