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

/**
 * Check if a role has a specific permission.
 */
export function hasPermission(role: WorkspaceRole, permission: WorkspacePermission): boolean {
  return ROLE_PERMISSIONS[role]?.has(permission) ?? false;
}

/**
 * Get all permissions for a role.
 */
export function getPermissions(role: WorkspaceRole): WorkspacePermission[] {
  return Array.from(ROLE_PERMISSIONS[role] || []);
}

/**
 * Check if a role can perform an action on a resource.
 */
export function canAccess(
  role: WorkspaceRole,
  resource: 'workspace' | 'project' | 'task' | 'comment' | 'smart_view' | 'agent',
  action: 'create' | 'read' | 'update' | 'delete' | 'manage_members' | 'manage_settings' | 'manage_integrations' | 'assign' | 'share' | 'execute'
): boolean {
  const permission = `${resource}:${action}` as WorkspacePermission;
  return hasPermission(role, permission);
}

/**
 * Helper to check if a user is at least an admin.
 */
export function isAdmin(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin';
}

/**
 * Helper to check if a user is the owner.
 */
export function isOwner(role: WorkspaceRole): boolean {
  return role === 'owner';
}

/**
 * Get the highest role from a list of roles.
 */
export function getHighestRole(roles: WorkspaceRole[]): WorkspaceRole {
  if (roles.includes('owner')) return 'owner';
  if (roles.includes('admin')) return 'admin';
  return 'member';
}
