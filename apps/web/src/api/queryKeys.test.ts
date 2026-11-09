import { describe, expect, test } from 'bun:test';
import { hasActiveFilters, normalizeFilters, queryKeys } from './queryKeys';
import { isKeyPrefix } from '../lib/realtime';
import { migrateWorkspaceState } from '../stores/workspace';

describe('queryKeys', () => {
  test('task list keys are nested under the project and the lists prefix', () => {
    const key = queryKeys.tasks.list('p1', { assigneeId: 'u1' });
    expect(isKeyPrefix(queryKeys.tasks.project('p1'), key)).toBe(true);
    expect(isKeyPrefix(queryKeys.tasks.lists(), key)).toBe(true);
    expect(isKeyPrefix(queryKeys.tasks.all, queryKeys.tasks.detail('t1'))).toBe(true);
    expect(isKeyPrefix(queryKeys.tasks.project('p2'), key)).toBe(false);
  });

  test('empty filters share one cache entry', () => {
    expect(queryKeys.tasks.list('p1')).toEqual(queryKeys.tasks.list('p1', { assigneeId: undefined, search: '  ' }));
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ labelId: 'l1' })).toBe(true);
    expect(normalizeFilters({ search: ' bug ' })).toEqual({ search: 'bug' });
  });

  test('project states and labels share the project detail key (no projects-states/project-states duplicates)', () => {
    expect(queryKeys.projects.detail('p1')).toEqual(['projects', 'detail', 'p1']);
    expect(isKeyPrefix(queryKeys.projects.all, queryKeys.projects.github('p1'))).toBe(true);
  });

  test('every factory returns a fresh array rooted in its domain', () => {
    expect(queryKeys.notifications.list('w1')).toEqual(['notifications', 'list', 'w1', 'inbox']);
    expect(isKeyPrefix(queryKeys.notifications.all, queryKeys.notifications.unreadCount('w1'))).toBe(true);
    expect(isKeyPrefix(queryKeys.smartViews.executions(), queryKeys.smartViews.execute('v1'))).toBe(true);
    expect(queryKeys.search.query('w1', ' TF-12 ')).toEqual(['search', 'w1', 'tf-12']);
    expect(queryKeys.workspaces.taskStats('w1', ['b', 'a'])).toEqual(['workspaces', 'task-stats', 'w1', ['a', 'b']]);
  });
});

describe('workspace store migration', () => {
  test('v0 objects are reduced to ids', () => {
    expect(migrateWorkspaceState({ currentWorkspace: { id: 'w1' }, currentProject: { id: 'p1' } })).toEqual({
      currentWorkspaceId: 'w1',
      currentProjectId: 'p1',
    });
    expect(migrateWorkspaceState({ currentWorkspace: null })).toEqual({ currentWorkspaceId: null, currentProjectId: null });
    expect(migrateWorkspaceState(undefined)).toEqual({ currentWorkspaceId: null, currentProjectId: null });
  });
});
