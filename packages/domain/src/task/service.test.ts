import { describe, expect, it } from 'bun:test';
import { buildTaskAssigneeConditions, taskListNeedsAssigneeJoin } from './service.js';

describe('task list assignee filtering helpers', () => {
  it('requires assignee join when assigneeId is provided', () => {
    const needsJoin = taskListNeedsAssigneeJoin(
      { assigneeId: 'user-1' },
      new Set<'task_states' | 'task_assignees' | 'task_labels'>()
    );
    expect(needsJoin).toBe(true);
  });

  it('requires assignee join when assigneeIds is provided', () => {
    const needsJoin = taskListNeedsAssigneeJoin(
      { assigneeIds: ['user-1', 'user-2'] },
      new Set<'task_states' | 'task_assignees' | 'task_labels'>()
    );
    expect(needsJoin).toBe(true);
  });

  it('does not require assignee join when assignee filters are absent', () => {
    const needsJoin = taskListNeedsAssigneeJoin(
      {},
      new Set<'task_states' | 'task_assignees' | 'task_labels'>()
    );
    expect(needsJoin).toBe(false);
  });

  it('builds assignee conditions from assigneeId and assigneeIds', () => {
    const conditions = buildTaskAssigneeConditions({
      assigneeId: 'user-1',
      assigneeIds: ['user-2', 'user-3'],
    });
    expect(conditions.length).toBe(2);
  });
});
