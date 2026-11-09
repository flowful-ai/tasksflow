import { AgentToolSchema, type AgentTool } from '@flowtask/shared';
import { OAuthError } from './errors.js';

export const TOOL_SCOPE_PREFIX = 'mcp:tool:';
export const WORKSPACE_SCOPE_PREFIX = 'mcp:workspace:';

export const McpScope = {
  toolPrefix: TOOL_SCOPE_PREFIX,
  workspacePrefix: WORKSPACE_SCOPE_PREFIX,
};

const ALLOWED_ADMIN_ROLES = new Set(['owner', 'admin']);

/** A granted tool implies these companions (same permission, batched form). */
const IMPLIED_TOOL_PERMISSIONS: Partial<Record<AgentTool, AgentTool[]>> = {
  create_task: ['bulk_create_tasks'],
  update_task: ['bulk_update_tasks'],
};

const agentTools: readonly AgentTool[] = AgentToolSchema.options;

export function isAgentTool(value: string): value is AgentTool {
  return (agentTools as readonly string[]).includes(value);
}

export function normalizeScopes(scopes: string[]): string[] {
  return Array.from(new Set(scopes.filter(Boolean)));
}

export function normalizeScopeString(scope: string): string {
  return Array.from(new Set(scope.split(/\s+/).filter(Boolean))).join(' ');
}

export function splitScopeString(scope: string): string[] {
  return normalizeScopeString(scope).split(' ').filter(Boolean);
}

export function isSubset(subset: string[], superset: string[]): boolean {
  const supersetSet = new Set(superset);
  return subset.every((item) => supersetSet.has(item));
}

export function hasExactlyOneWorkspaceScope(scopes: string[]): boolean {
  return scopes.filter((scope) => scope.startsWith(WORKSPACE_SCOPE_PREFIX)).length === 1;
}

export function parseWorkspaceScope(scopes: string[]): string | null {
  const workspaceScopes = scopes.filter((scope) => scope.startsWith(WORKSPACE_SCOPE_PREFIX));
  if (workspaceScopes.length !== 1) {
    return null;
  }
  const workspaceId = workspaceScopes[0]?.slice(WORKSPACE_SCOPE_PREFIX.length);
  return workspaceId || null;
}

export function parseToolScopes(scopes: string[]): string[] {
  return scopes
    .filter((scope) => scope.startsWith(TOOL_SCOPE_PREFIX))
    .map((scope) => scope.slice(TOOL_SCOPE_PREFIX.length));
}

export function parseStoredScopes(rawScopes: unknown): string[] {
  if (!Array.isArray(rawScopes)) {
    return [];
  }
  return rawScopes.filter((scope): scope is string => typeof scope === 'string');
}

export function expandToolPermissions(toolScopes: string[]): AgentTool[] {
  const expanded = new Set<AgentTool>();
  for (const scope of toolScopes) {
    if (!isAgentTool(scope)) {
      continue;
    }
    expanded.add(scope);
    for (const implied of IMPLIED_TOOL_PERMISSIONS[scope] ?? []) {
      expanded.add(implied);
    }
  }
  return Array.from(expanded);
}

export function validateToolScopePresence(
  scopes: string[],
  oauthError: 'invalid_scope' | 'invalid_token' = 'invalid_scope'
): string[] {
  const toolScopes = parseToolScopes(scopes);
  if (toolScopes.length === 0) {
    const statusCode = oauthError === 'invalid_token' ? 401 : 400;
    throw new OAuthError(oauthError, 'At least one tool scope is required', statusCode);
  }
  return toolScopes;
}

export function validateToolScopes(scopes: string[]): { ok: boolean; invalidTools: string[] } {
  const invalidTools = parseToolScopes(scopes).filter((tool) => !isAgentTool(tool));
  return { ok: invalidTools.length === 0, invalidTools };
}

export function validateRequestedMcpScopes(scope: string): {
  scopes: string[];
  workspaceId: string;
  toolScopes: string[];
} {
  const scopes = splitScopeString(scope);

  if (!hasExactlyOneWorkspaceScope(scopes)) {
    throw new OAuthError('invalid_scope', 'Exactly one workspace scope is required');
  }

  const toolScopes = validateToolScopePresence(scopes, 'invalid_scope');

  const validation = validateToolScopes(scopes);
  if (!validation.ok) {
    throw new OAuthError(
      'invalid_scope',
      `Unknown tool scopes: ${validation.invalidTools.join(', ')}`
    );
  }

  const workspaceId = parseWorkspaceScope(scopes);
  if (!workspaceId) {
    throw new OAuthError('invalid_scope', 'Invalid workspace scope');
  }

  return { scopes, workspaceId, toolScopes };
}

export function toToolScope(tool: string): string {
  return `${TOOL_SCOPE_PREFIX}${tool}`;
}

export function isAuthorizingRole(role: string | null): boolean {
  return Boolean(role && ALLOWED_ADMIN_ROLES.has(role));
}

export function getAllMcpToolNames(): AgentTool[] {
  return [...agentTools];
}

export function supportedScopes(): string[] {
  return [`${WORKSPACE_SCOPE_PREFIX}{workspaceId}`, ...agentTools.map(toToolScope)];
}
