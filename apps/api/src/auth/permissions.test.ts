import { describe, expect, it } from 'bun:test';
import { canAccess, getPermissions, hasPermission, isWorkspacePermission, type WorkspacePermission } from './permissions.js';

const OWNER_ONLY: WorkspacePermission[] = ['workspace:delete'];
const ADMIN_AND_UP: WorkspacePermission[] = [
  'workspace:update',
  'workspace:manage_members',
  'workspace:manage_settings',
  'project:create',
  'project:update',
  'project:delete',
  'project:manage_integrations',
  'task:delete',
  'task:assign',
  'comment:delete',
  'smart_view:update',
  'smart_view:delete',
  'smart_view:share',
  'agent:create',
  'agent:update',
  'agent:delete',
];
const EVERYONE: WorkspacePermission[] = [
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
];

describe('hasPermission matrix', () => {
  it('owner has every permission', () => {
    for (const permission of [...OWNER_ONLY, ...ADMIN_AND_UP, ...EVERYONE]) {
      expect(hasPermission('owner', permission)).toBe(true);
    }
  });

  it('admin has everything except owner-only permissions', () => {
    for (const permission of OWNER_ONLY) expect(hasPermission('admin', permission)).toBe(false);
    for (const permission of [...ADMIN_AND_UP, ...EVERYONE]) expect(hasPermission('admin', permission)).toBe(true);
  });

  it('member has only the baseline permissions', () => {
    for (const permission of [...OWNER_ONLY, ...ADMIN_AND_UP]) expect(hasPermission('member', permission)).toBe(false);
    for (const permission of EVERYONE) expect(hasPermission('member', permission)).toBe(true);
  });

  it('covers every permission exactly once in the fixture lists', () => {
    const listed = new Set([...OWNER_ONLY, ...ADMIN_AND_UP, ...EVERYONE]);
    expect(new Set(getPermissions('owner'))).toEqual(listed);
  });
});

describe('canAccess / isWorkspacePermission', () => {
  it('maps resource and action to a permission', () => {
    expect(canAccess('member', 'task', 'read')).toBe(true);
    expect(canAccess('member', 'task', 'delete')).toBe(false);
    expect(canAccess('admin', 'workspace', 'manage_members')).toBe(true);
  });

  it('rejects unknown resource/action combinations instead of casting', () => {
    expect(isWorkspacePermission('task:share')).toBe(false);
    expect(canAccess('owner', 'task', 'share')).toBe(false);
  });
});
