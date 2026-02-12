import { describe, expect, it } from 'bun:test';
import type { TaskWithRelations } from '@flowtask/domain';
import {
  formatBulkCreateResult,
  formatWriteCommentResult,
  formatWriteTaskResult,
  projectTaskList,
  resolveListLimit,
  resolveTaskProjectionArgs,
} from './mcp-response-shaping.js';

function createTask(id: string): TaskWithRelations {
  return {
    id,
    projectId: 'project-1',
    stateId: 'state-1',
    sequenceNumber: 1,
    title: `Task ${id}`,
    description: null,
    priority: null,
    position: 'a1',
    dueDate: null,
    startDate: null,
    createdBy: 'user-1',
    agentId: null,
    createdAt: new Date('2026-02-12T00:00:00.000Z'),
    updatedAt: new Date('2026-02-12T00:00:00.000Z'),
    deletedAt: null,
    state: null,
    project: {
      id: 'project-1',
      identifier: 'TASK',
      name: 'tasksflow',
    },
    assignees: [],
    labels: [],
    agent: null,
    externalLinks: [],
  };
}

describe('list shaping defaults', () => {
  it('uses compact view by default', () => {
    const projection = resolveTaskProjectionArgs({});
    const result = projectTaskList([createTask('t1')], 1, projection);
    expect(result.tasks[0]).toEqual({
      id: 't1',
      projectId: 'project-1',
      title: 'Task t1',
      stateId: 'state-1',
      priority: null,
      updatedAt: new Date('2026-02-12T00:00:00.000Z'),
      dueDate: null,
    });
  });

  it('supports custom projection', () => {
    const projection = resolveTaskProjectionArgs({
      view: 'custom',
      fields: ['id', 'title'],
    });
    const result = projectTaskList([createTask('t1')], 1, projection);
    expect(result.tasks[0]).toEqual({ id: 't1', title: 'Task t1' });
  });
});

describe('write result shaping', () => {
  it('returns ack by default for task writes', () => {
    const result = formatWriteTaskResult(
      'create_task',
      createTask('t1'),
      'ack',
      resolveTaskProjectionArgs({})
    );
    expect(result).toEqual({ ok: true, tool: 'create_task', id: 't1' });
  });

  it('returns compact task payload when requested', () => {
    const result = formatWriteTaskResult(
      'update_task',
      createTask('t1'),
      'compact',
      resolveTaskProjectionArgs({})
    ) as { task: Record<string, unknown> };
    expect(result.task.id).toBe('t1');
    expect(result.task.description).toBeUndefined();
  });

  it('returns comment ack by default', () => {
    const result = formatWriteCommentResult('add_comment', 'comment-1', { id: 'comment-1' }, 'ack');
    expect(result).toEqual({ ok: true, tool: 'add_comment', id: 'comment-1' });
  });

  it('returns bulk ack payload by default', () => {
    const result = formatBulkCreateResult(
      'bulk_create_tasks',
      [createTask('t1'), createTask('t2')],
      [{ index: 3, error: 'failure' }],
      'ack',
      resolveTaskProjectionArgs({})
    );
    expect(result).toEqual({
      ok: true,
      tool: 'bulk_create_tasks',
      createdIds: ['t1', 't2'],
      failed: [{ index: 3, error: 'failure' }],
    });
  });
});

describe('resolveListLimit', () => {
  it('defaults to 10 and clamps to 50', () => {
    expect(resolveListLimit({})).toBe(10);
    expect(resolveListLimit({ limit: '250' })).toBe(50);
  });
});
