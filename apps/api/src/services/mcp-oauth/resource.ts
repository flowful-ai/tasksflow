import { OAuthError } from './errors.js';

/**
 * RFC 8707 resource indicators. FlowTask runs one MCP resource server reachable
 * at two paths: the canonical `/api/mcp` and the legacy `/api/mcp/sse` that
 * existing clients were configured with. Both name the same resource.
 */

export const MCP_CANONICAL_PATH = '/api/mcp';
export const MCP_LEGACY_PATH = '/api/mcp/sse';
export const MCP_RESOURCE_PATHS = [MCP_CANONICAL_PATH, MCP_LEGACY_PATH] as const;
export type McpResourcePath = (typeof MCP_RESOURCE_PATHS)[number];

export function normalizeResource(value: string): string | null {
  try {
    const url = new URL(value.trim());
    if (url.hash || url.search) {
      return null;
    }
    const path = url.pathname.replace(/\/+$/, '');
    return `${url.protocol}//${url.host.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

export function canonicalMcpResource(baseUrl: string): string {
  return `${baseUrl}${MCP_CANONICAL_PATH}`;
}

export function mcpResourceForPath(baseUrl: string, path: McpResourcePath): string {
  return `${baseUrl}${path}`;
}

function aliasSet(baseUrl: string): Set<string> {
  const aliases = new Set<string>();
  for (const path of MCP_RESOURCE_PATHS) {
    const normalized = normalizeResource(`${baseUrl}${path}`);
    if (normalized) {
      aliases.add(normalized);
    }
  }
  return aliases;
}

/**
 * Validates a `resource` request parameter (authorize or token endpoint) and
 * returns the value to bind. Absent means the canonical MCP URL.
 */
export function resolveRequestedResource(rawValues: string[], baseUrl: string): string {
  const values = rawValues.map((value) => value.trim()).filter(Boolean);
  if (values.length === 0) {
    return canonicalMcpResource(baseUrl);
  }

  const normalized = new Set(values.map(normalizeResource));
  if (normalized.size !== 1) {
    throw new OAuthError('invalid_target', 'Only one resource may be requested');
  }

  const [resource] = normalized;
  if (!resource || !aliasSet(baseUrl).has(resource)) {
    throw new OAuthError('invalid_target', 'resource must identify this MCP server');
  }
  return resource;
}

/**
 * True when a token bound to `tokenResource` may be used at this server.
 * Legacy tokens (null resource) are treated as bound to the canonical URL.
 */
export function tokenResourceMatches(tokenResource: string | null, baseUrl: string): boolean {
  if (tokenResource === null) {
    return true;
  }
  const normalized = normalizeResource(tokenResource);
  return normalized !== null && aliasSet(baseUrl).has(normalized);
}
