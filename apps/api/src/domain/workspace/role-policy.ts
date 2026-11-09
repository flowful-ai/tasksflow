import type { WorkspaceRole } from '@flowtask/shared';

/**
 * Workspace role hierarchy and the rules for who may change whose role.
 *
 * - Only an owner may grant or revoke `owner`, or change or remove an owner.
 * - Everybody else may only assign roles at or below their own, and only to
 *   members whose current role is at or below their own.
 * - Anybody may leave a workspace (the last-owner guard is enforced separately).
 */

const ROLE_RANK: Record<WorkspaceRole, number> = {
  member: 1,
  admin: 2,
  owner: 3,
};

export const WORKSPACE_ROLES: readonly WorkspaceRole[] = ['owner', 'admin', 'member'];

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return value === 'owner' || value === 'admin' || value === 'member';
}

/** Owners and admins: they see every project and administer the workspace. */
export function isAdminRole(role: WorkspaceRole): boolean {
  return role === 'owner' || role === 'admin';
}

export function roleRank(role: WorkspaceRole): number {
  return ROLE_RANK[role];
}

export function isRoleAtOrBelow(role: WorkspaceRole, ceiling: WorkspaceRole): boolean {
  return ROLE_RANK[role] <= ROLE_RANK[ceiling];
}

export type RoleChangeDecision = { allowed: true } | { allowed: false; reason: string };

const ALLOWED: RoleChangeDecision = { allowed: true };

/** May `actorRole` add a new member with `newRole`? */
export function canGrantRole(actorRole: WorkspaceRole, newRole: WorkspaceRole): RoleChangeDecision {
  if (newRole === 'owner' && actorRole !== 'owner') {
    return { allowed: false, reason: 'Only an owner can grant the owner role' };
  }
  if (!isRoleAtOrBelow(newRole, actorRole)) {
    return { allowed: false, reason: 'You cannot assign a role above your own' };
  }
  return ALLOWED;
}

/** May `actorRole` change a member currently at `targetRole` to `newRole`? */
export function canChangeRole(
  actorRole: WorkspaceRole,
  targetRole: WorkspaceRole,
  newRole: WorkspaceRole
): RoleChangeDecision {
  if (actorRole !== 'owner' && (targetRole === 'owner' || newRole === 'owner')) {
    return { allowed: false, reason: 'Only an owner can change the owner role' };
  }
  if (!isRoleAtOrBelow(targetRole, actorRole)) {
    return { allowed: false, reason: 'You cannot change the role of a member above your own role' };
  }
  return canGrantRole(actorRole, newRole);
}

/**
 * May `actorRole` remove a member currently at `targetRole`?
 * Leaving the workspace yourself (`isSelf`) is always allowed here.
 */
export function canRemoveMember(
  actorRole: WorkspaceRole | null,
  targetRole: WorkspaceRole,
  isSelf: boolean
): RoleChangeDecision {
  if (isSelf) {
    return ALLOWED;
  }
  if (!actorRole) {
    return { allowed: false, reason: 'Not a workspace member' };
  }
  if (targetRole === 'owner' && actorRole !== 'owner') {
    return { allowed: false, reason: 'Only an owner can remove an owner' };
  }
  if (!isRoleAtOrBelow(targetRole, actorRole)) {
    return { allowed: false, reason: 'You cannot remove a member above your own role' };
  }
  return ALLOWED;
}
