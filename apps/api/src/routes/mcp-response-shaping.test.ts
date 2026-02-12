import { describe, expect, it } from 'bun:test';
import type { TaskWithRelations } from '@flowtask/domain';
import {
  projectTask,
  projectTaskList,
  resolveTaskProjectionArgs,
} from './mcp-response-shaping.js';

function createTaskFixture(): TaskWithRelations {
  return {
    id: 'task-1',
    projectId: 'project-1',
    stateId: 'state-1',
    sequenceNumber: 12,
    title: 'Ship MCP optimization',
    description: 'desc',
    priority: 'high',
    position: 'a1',
    dueDate: null,
    startDate: null,
    createdBy: 'user-1',
    agentId: null,
    createdAt: new Date('2026-02-12T00:00:00.000Z'),
    updatedAt: new Date('2026-02-12T01:00:00.000Z'),
    deletedAt: null,
    state: {
      id: 'state-1',
      projectId: 'project-1',
      name: 'Todo',
      category: 'backlog',
      position: 'a1',
      color: '#fff',
    },
    project: {
      id: 'project-1',
      identifier: 'TASK',
      name: 'tasksflow',
    },
    assignees: [{ id: 'u1' }] as any[],
    labels: [{ id: 'l1' }] as any[],
    agent: null,
    externalLinks: [{ id: 'e1', externalType: 'github_issue', externalId: '1', externalUrl: 'https://x' }],
  };
}

describe('resolveTaskProjectionArgs', () => {
  it('rejects unknown custom fields', () => {
    expect(() =>
      resolveTaskProjectionArgs({
        view: 'custom',
        fields: ['id', 'unknownField'],
      })
    ).toThrow('Unknown fields: unknownField');
  });

  it('requires include flag for heavy relation fields in custom view', () => {
    expect(() =>
      resolveTaskProjectionArgs({
        view: 'custom',
        fields: ['id', 'assignees'],
      })
    ).toThrow('assignees requires includeAssignees=true');
  });
});

describe('projectTask', () => {
  it('returns exact compact keys by default', () => {
    const task = createTaskFixture();
    const projection = resolveTaskProjectionArgs({});
    const output = projectTask(task, projection);

    expect(Object.keys(output).sort()).toEqual([
      'dueDate',
      'id',
      'priority',
      'projectId',
      'stateId',
      'title',
      'updatedAt',
    ]);
  });

  it('returns full projection without disabled relation fields', () => {
    const task = createTaskFixture();
    const projection = resolveTaskProjectionArgs({ view: 'full' });
    const output = projectTask(task, projection);

    expect(output.id).toBe('task-1');
    expect(output.assignees).toBeUndefined();
    expect(output.labels).toBeUndefined();
    expect(output.externalLinks).toBeUndefined();
  });

  it('returns custom projection with selected fields only', () => {
    const task = createTaskFixture();
    const projection = resolveTaskProjectionArgs({
      view: 'custom',
      fields: ['id', 'title', 'state'],
    });
    const output = projectTask(task, projection);

    expect(output).toEqual({
      id: 'task-1',
      title: 'Ship MCP optimization',
      state: task.state,
    });
  });
});

describe('projectTaskList', () => {
  it('projects list and preserves total', () => {
    const task = createTaskFixture();
    const projection = resolveTaskProjectionArgs({});
    const output = projectTaskList([task], 99, projection);

    expect(output.total).toBe(99);
    expect(output.tasks).toHaveLength(1);
    expect(output.tasks[0]?.id).toBe('task-1');
  });
});
