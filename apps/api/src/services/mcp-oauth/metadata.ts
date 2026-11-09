import { supportedScopes } from './scopes.js';
import { MCP_CANONICAL_PATH, mcpResourceForPath, type McpResourcePath } from './resource.js';

export function getAuthorizationServerMetadata(baseUrl: string) {
  return {
    issuer: baseUrl,
    authorization_endpoint: `${baseUrl}/api/mcp/oauth/authorize`,
    token_endpoint: `${baseUrl}/api/mcp/oauth/token`,
    registration_endpoint: `${baseUrl}/api/mcp/oauth/register`,
    revocation_endpoint: `${baseUrl}/api/mcp/oauth/revoke`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    revocation_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    scopes_supported: supportedScopes(),
  };
}

export function protectedResourceMetadataUrl(
  baseUrl: string,
  resourcePath: McpResourcePath
): string {
  return `${baseUrl}/.well-known/oauth-protected-resource${resourcePath}`;
}

/** RFC 9728 metadata. `resource` must equal the URL the client derived the metadata URL from. */
export function getProtectedResourceMetadata(
  baseUrl: string,
  resourcePath: McpResourcePath = MCP_CANONICAL_PATH
) {
  return {
    resource: mcpResourceForPath(baseUrl, resourcePath),
    resource_name: 'FlowTask MCP',
    authorization_servers: [baseUrl],
    scopes_supported: supportedScopes(),
    bearer_methods_supported: ['header'],
  };
}

function quoteHeaderValue(value: string): string {
  return value.replace(/["\\\r\n]/g, '');
}

export function buildWwwAuthenticateHeader(
  baseUrl: string,
  resourcePath: McpResourcePath,
  error?: { code: 'invalid_token' | 'insufficient_scope' | 'invalid_request'; description: string }
): string {
  const parts = [
    'realm="flowtask-mcp"',
    `resource_metadata="${protectedResourceMetadataUrl(baseUrl, resourcePath)}"`,
  ];
  if (error) {
    parts.push(
      `error="${error.code}"`,
      `error_description="${quoteHeaderValue(error.description)}"`
    );
  }
  return `Bearer ${parts.join(', ')}`;
}
