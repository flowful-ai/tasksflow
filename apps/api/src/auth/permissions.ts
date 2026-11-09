import type { WorkspaceRole } from '@flowtask/shared';

/**
 * Permission types for workspace operations.
 */
export type WorkspacePermission =
  | 'workspace:read'
  | 'workspace:update'
  | 'workspace:delete'
  | 'workspace:manage_members'
  | 'workspace:manage_settings'
  | 'project:create'
  | 'project:read'
  | 'project:update'
  | 'project:delete'
  | 'project:manage_integrations'
  | 'task:create'
  | 'task:read'
  | 'task:update'
  | 'task:delete'
  | 'task:assign'
  | 'comment:create'
  | 'comment:read'
  | 'comment:update'
  | 'comment:delete'
  | 'smart_view:create'
  | 'smart_view:read'
  | 'smart_view:update'
  | 'smart_view:delete'
  | 'smart_view:share'
  | 'agent:create'
  | 'agent:read'
  | 'agent:update'
  | 'agent:delete'
  | 'agent:execute';

/**
 * Permission matrix for workspace roles.
 */
const ROLE_PERMISSIONS: Record<WorkspaceRole, Set<WorkspacePermission>> = {
  owner: new Set([
    'workspace:read',
    'workspace:update',
    'workspace:delete',
    'workspace:manage_members',
    'workspace:manage_settings',
    'project:create',
    'project:read',
    'project:update',
    'project:delete',
    'project:manage_integrations',
    'task:create',
    'task:read',
    'task:update',
    'task:delete',
    'task:assign',
    'comment:create',
    'comment:read',
    'comment:update',
    'comment:delete',
    'smart_view:create',
    'smart_view:read',
    'smart_view:update',
    'smart_view:delete',
    'smart_view:share',
    'agent:create',
    'agent:read',
    'agent:update',
    'agent:delete',
    'agent:execute',
  ]),
  admin: new Set([
    'workspace:read',
    'workspace:update',
    'workspace:manage_members',
    'workspace:manage_settings',
    'project:create',
    'project:read',
    'project:update',
    'project:delete',
    'project:manage_integrations',
    'task:create',
    'task:read',
    'task:update',
    'task:delete',
    'task:assign',
    'comment:create',
    'comment:read',
    'comment:update',
    'comment:delete',
    'smart_view:create',
    'smart_view:read',
    'smart_view:update',
    'smart_view:delete',
    'smart_view:share',
    'agent:create',
    'agent:read',
    'agent:update',
    'agent:delete',
    'agent:execute',
  ]),
  member: new Set([
    'workspace:read',
    'project:read',
    'task:create',
    'task:read',
    'task:update',
    'comment:create',
    'comment:read',
    'comment:update',
    'smart_view:create',
    'smart_view:read',
    'agent:read',
    'agent:execute',
  ]),
};

const ALL_PERMISSIONS: ReadonlySet<string> = ROLE_PERMISSIONS.owner;

export function isWorkspacePermission(value: string): value is WorkspacePermission {
  return ALL_PERMISSIONS.has(value);
}

/**
 * Check if a role has a specific permission. Unknown roles have none.
 */
export function hasPermission(role: WorkspaceRole, permission: WorkspacePermission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}
