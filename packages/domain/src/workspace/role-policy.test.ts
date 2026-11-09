import { describe, expect, it } from 'bun:test';
import type { WorkspaceRole } from '@flowtask/shared';
import { canChangeRole, canGrantRole, canRemoveMember, isWorkspaceRole } from './role-policy.js';
import { projectAclAllows } from './authorization.js';

const ROLES: WorkspaceRole[] = ['owner', 'admin', 'member'];

describe('canGrantRole', () => {
  it('only an owner can grant owner', () => {
    expect(canGrantRole('owner', 'owner').allowed).toBe(true);
    expect(canGrantRole('admin', 'owner').allowed).toBe(false);
    expect(canGrantRole('member', 'owner').allowed).toBe(false);
  });

  it('non-owners can grant roles at or below their own', () => {
    expect(canGrantRole('admin', 'admin').allowed).toBe(true);
    expect(canGrantRole('admin', 'member').allowed).toBe(true);
    expect(canGrantRole('member', 'admin').allowed).toBe(false);
  });
});

describe('canChangeRole', () => {
  it('denies admin -> owner self-promotion', () => {
    expect(canChangeRole('admin', 'admin', 'owner').allowed).toBe(false);
  });

  it('denies an admin changing or demoting an owner', () => {
    expect(canChangeRole('admin', 'owner', 'admin').allowed).toBe(false);
    expect(canChangeRole('admin', 'owner', 'member').allowed).toBe(false);
  });

  it('allows an owner every change', () => {
    for (const target of ROLES) {
      for (const next of ROLES) {
        expect(canChangeRole('owner', target, next).allowed).toBe(true);
      }
    }
  });

  it('allows admins to move members between admin and member', () => {
    expect(canChangeRole('admin', 'member', 'admin').allowed).toBe(true);
    expect(canChangeRole('admin', 'admin', 'member').allowed).toBe(true);
  });

  it('never lets a member change roles upward', () => {
    expect(canChangeRole('member', 'member', 'admin').allowed).toBe(false);
  });
});

describe('canRemoveMember', () => {
  it('anyone may leave', () => {
    for (const role of ROLES) expect(canRemoveMember(role, role, true).allowed).toBe(true);
  });

  it('only an owner may remove an owner', () => {
    expect(canRemoveMember('admin', 'owner', false).allowed).toBe(false);
    expect(canRemoveMember('owner', 'owner', false).allowed).toBe(true);
  });

  it('non-members cannot remove anyone', () => {
    expect(canRemoveMember(null, 'member', false).allowed).toBe(false);
  });
});

describe('isWorkspaceRole', () => {
  it('accepts only known roles', () => {
    expect(isWorkspaceRole('owner')).toBe(true);
    expect(isWorkspaceRole('superuser')).toBe(false);
    expect(isWorkspaceRole(undefined)).toBe(false);
  });
});

describe('projectAclAllows', () => {
  it('owners and admins see every project', () => {
    for (const access of ['all', 'admin', 'members', 'unknown']) {
      expect(projectAclAllows(access, 'owner', false)).toBe(true);
      expect(projectAclAllows(access, 'admin', false)).toBe(true);
    }
  });

  it('members see open projects and restricted ones they belong to', () => {
    expect(projectAclAllows('all', 'member', false)).toBe(true);
    expect(projectAclAllows('members', 'member', true)).toBe(true);
    expect(projectAclAllows('members', 'member', false)).toBe(false);
    expect(projectAclAllows('admin', 'member', true)).toBe(false);
    expect(projectAclAllows('unknown', 'member', true)).toBe(false);
  });
});
