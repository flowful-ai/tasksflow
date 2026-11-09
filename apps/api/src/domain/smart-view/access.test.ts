import { describe, expect, it } from 'bun:test';
import type { PublicShare } from '../../db/index.js';
import type { TaskWithRelations } from '../task/types.js';
import { canAccessSmartView, toPublicShareSummary } from './access.js';
import { parseHiddenFields, toPublicTask } from './public-dto.js';

const NO_PERMS = { update: false, delete: false, share: false };
const ADMIN_PERMS = { update: true, delete: true, share: true };

describe('canAccessSmartView', () => {
  const personal = { createdBy: 'owner', isPersonal: true, shares: [] };
  const team = { createdBy: 'owner', isPersonal: false, shares: [] };

  it('personal views are readable only by their creator', () => {
    expect(canAccessSmartView(personal, 'owner', NO_PERMS, 'read')).toBe(true);
    expect(canAccessSmartView(personal, 'someone', ADMIN_PERMS, 'read')).toBe(false);
    expect(canAccessSmartView(personal, 'someone', ADMIN_PERMS, 'delete')).toBe(false);
  });

  it('explicit shares grant read, and edit shares grant update', () => {
    const shared = { ...personal, shares: [{ sharedWithUserId: 'friend', permission: 'edit' }] };
    expect(canAccessSmartView(shared, 'friend', NO_PERMS, 'read')).toBe(true);
    expect(canAccessSmartView(shared, 'friend', NO_PERMS, 'update')).toBe(true);
    expect(canAccessSmartView(shared, 'friend', NO_PERMS, 'delete')).toBe(false);
  });

  it('team views: everyone reads, role permissions gate changes, creators manage their own', () => {
    expect(canAccessSmartView(team, 'member', NO_PERMS, 'read')).toBe(true);
    expect(canAccessSmartView(team, 'member', NO_PERMS, 'update')).toBe(false);
    expect(canAccessSmartView(team, 'admin', ADMIN_PERMS, 'update')).toBe(true);
    expect(canAccessSmartView(team, 'owner', NO_PERMS, 'delete')).toBe(true);
    expect(canAccessSmartView(team, 'owner', NO_PERMS, 'share')).toBe(false);
  });
});

describe('toPublicShareSummary', () => {
  it('never returns the password hash', () => {
    const share: PublicShare = {
      id: 's',
      smartViewId: 'v',
      token: 't',
      displayTypeOverride: null,
      hideFields: null,
      passwordHash: '$2b$12$secret',
      expiresAt: null,
      maxAccessCount: null,
      accessCount: 0,
      lastAccessedAt: null,
      isActive: true,
      showExternalLinks: false,
      createdBy: 'u',
      createdAt: new Date(),
    };
    const summary = toPublicShareSummary(share);
    expect(JSON.stringify(summary)).not.toContain('$2b$');
    expect(summary.hasPassword).toBe(true);
  });
});

function sampleTask(): TaskWithRelations {
  const now = new Date('2026-01-01T00:00:00Z');
  return {
    id: 'task-1',
    projectId: 'project-1',
    stateId: 'state-1',
    sequenceNumber: 7,
    title: 'Ship it',
    description: 'secret plan',
    priority: 'high',
    position: 'a0',
    dueDate: now,
    startDate: null,
    createdBy: 'user-1',
    agentId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    completedAt: null,
    state: {
      id: 'state-1',
      projectId: 'project-1',
      name: 'Todo',
      category: 'backlog',
      position: 'a0',
      color: '#fff',
    },
    assignees: [
      {
        id: 'user-1',
        email: 'alice@example.com',
        emailVerified: true,
        name: 'Alice',
        avatarUrl: 'https://img/alice',
        appRole: 'app_manager',
        createdAt: now,
        updatedAt: now,
      },
    ],
    labels: [{ id: 'label-1', projectId: 'project-1', name: 'bug', color: null }],
    project: { id: 'project-1', identifier: 'FLOW', name: 'Flow' },
    agent: null,
    externalLinks: [
      {
        id: 'l1',
        externalType: 'github_issue',
        externalId: '12',
        externalUrl: 'https://github.com/acme/private/issues/12',
      },
    ],
  };
}

describe('toPublicTask', () => {
  it('exposes assignee name and avatar only, and no external links by default', () => {
    const dto = toPublicTask(sampleTask(), { hiddenFields: new Set(), showExternalLinks: false });
    const json = JSON.stringify(dto);
    expect(dto.assignees).toEqual([
      { id: 'user-1', name: 'Alice', avatarUrl: 'https://img/alice' },
    ]);
    expect(json).not.toContain('alice@example.com');
    expect(json).not.toContain('app_manager');
    expect(json).not.toContain('github.com');
    expect(dto).not.toHaveProperty('createdBy');
  });

  it('includes external links only when the share enables them', () => {
    const dto = toPublicTask(sampleTask(), { hiddenFields: new Set(), showExternalLinks: true });
    expect(dto.externalLinks?.[0]?.externalUrl).toContain('github.com');
  });

  it('hides fields including their nested objects', () => {
    const hidden = parseHiddenFields([
      'assignee',
      'description',
      'state',
      'due_date',
      'labels',
      'project',
      'nope',
      3,
    ]);
    const dto = toPublicTask(sampleTask(), { hiddenFields: hidden, showExternalLinks: false });
    expect(dto).not.toHaveProperty('assignees');
    expect(dto).not.toHaveProperty('description');
    expect(dto).not.toHaveProperty('state');
    expect(dto).not.toHaveProperty('stateId');
    expect(dto).not.toHaveProperty('dueDate');
    expect(dto).not.toHaveProperty('labels');
    expect(dto).not.toHaveProperty('project');
    expect(dto.title).toBe('Ship it');
  });
});
