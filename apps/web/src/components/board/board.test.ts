import { describe, expect, test } from 'bun:test';
import { compareByPosition, moveItem, neighboursAt, sortColumnTasks } from './ordering';
import {
  EMPTY_FILTERS,
  applyBoardFilters,
  describeFilters,
  isOverdue,
  toApiFilters,
  type BoardFilters,
  type FilterableTask,
} from './filters';

describe('ordering', () => {
  test('sorts by code units, not locale (uppercase before lowercase), ties by id', () => {
    const tasks = [
      { id: 'c', position: 'a0' },
      { id: 'b', position: 'aV' },
      { id: 'a', position: 'a0' },
      { id: 'd', position: 'Zz' },
    ];
    expect(sortColumnTasks(tasks).map((t) => t.id)).toEqual(['d', 'a', 'c', 'b']);
    expect(compareByPosition({ id: 'x', position: 'a0' }, { id: 'x', position: 'a0' })).toBe(0);
  });

  test('done columns put the most recently updated first', () => {
    const tasks = [
      { id: 'old', position: 'a0', updatedAt: '2026-11-01T00:00:00Z' },
      { id: 'new', position: 'a1', updatedAt: '2026-11-08T00:00:00Z' },
      { id: 'none', position: 'a2', updatedAt: null },
    ];
    expect(sortColumnTasks(tasks, 'done').map((t) => t.id)).toEqual(['new', 'old', 'none']);
  });

  test('done columns prefer completedAt, so editing an old done task does not reorder it', () => {
    const tasks = [
      { id: 'edited', position: 'a0', updatedAt: '2026-11-09T00:00:00Z', completedAt: '2026-10-01T00:00:00Z' },
      { id: 'recent', position: 'a1', updatedAt: '2026-11-05T00:00:00Z', completedAt: '2026-11-05T00:00:00Z' },
      { id: 'legacy', position: 'a2', updatedAt: '2026-10-15T00:00:00Z', completedAt: null },
    ];
    expect(sortColumnTasks(tasks, 'done').map((t) => t.id)).toEqual(['recent', 'legacy', 'edited']);
  });

  test('neighbours exclude the dragged card and skip other server columns', () => {
    expect(neighboursAt(['a', 'x', 'b'], 'x')).toEqual({ afterTaskId: 'a', beforeTaskId: 'b', index: 1, count: 3 });
    expect(neighboursAt(['x', 'a'], 'x')).toEqual({ afterTaskId: null, beforeTaskId: 'a', index: 0, count: 2 });
    expect(neighboursAt(['a', 'x'], 'x')).toEqual({ afterTaskId: 'a', beforeTaskId: null, index: 1, count: 2 });
    expect(neighboursAt(['a', 'other', 'x', 'other2', 'b'], 'x', (id) => !id.startsWith('other'))).toMatchObject({
      afterTaskId: 'a',
      beforeTaskId: 'b',
    });
  });

  test('moveItem', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
    expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
  });
});

function task(overrides: Partial<FilterableTask>): FilterableTask {
  return { priority: null, dueDate: null, state: { category: 'backlog' }, assignees: [], labels: [], ...overrides };
}

describe('filters', () => {
  const now = new Date('2026-11-09T12:00:00');
  const filters = (patch: Partial<BoardFilters>): BoardFilters => ({ ...EMPTY_FILTERS, ...patch });

  test('sub-tasks never reach the board', () => {
    const task = { priority: null, dueDate: null, state: null, assignees: [], labels: [] };
    expect(applyBoardFilters([task, { ...task, parentId: 'p1' }], EMPTY_FILTERS, now)).toEqual([task]);
  });

  test('only single values go to the API', () => {
    expect(toApiFilters(filters({ assigneeIds: ['u1'], priorities: ['high'], labelIds: ['l1', 'l2'] }))).toEqual({
      parentId: 'none',
      assigneeId: 'u1',
      priority: 'high',
    });
    expect(toApiFilters(filters({ priorities: ['none'] }))).toEqual({ parentId: 'none' });
  });

  test('values of one dimension are ORed, dimensions are ANDed', () => {
    const tasks = [
      task({ priority: 'high', labels: [{ id: 'l1' }] }),
      task({ priority: 'low', labels: [{ id: 'l1' }] }),
      task({ priority: null, labels: [{ id: 'l2' }] }),
    ];
    expect(applyBoardFilters(tasks, filters({ priorities: ['high', 'none'] }), now)).toHaveLength(2);
    expect(applyBoardFilters(tasks, filters({ priorities: ['high', 'low'], labelIds: ['l1'] }), now)).toHaveLength(2);
    expect(applyBoardFilters(tasks, filters({ labelIds: ['l2'] }), now)).toHaveLength(1);
  });

  test('due filters', () => {
    const late = task({ dueDate: '2026-11-07T00:00:00' });
    const lateDone = task({ dueDate: '2026-11-07T00:00:00', state: { category: 'done' } });
    const soon = task({ dueDate: '2026-11-12T00:00:00' });
    const later = task({ dueDate: '2026-12-12T00:00:00' });
    const none = task({});
    expect(isOverdue(late, now)).toBe(true);
    expect(isOverdue(lateDone, now)).toBe(false);
    const all = [late, lateDone, soon, later, none];
    expect(applyBoardFilters(all, filters({ due: ['overdue'] }), now)).toEqual([late]);
    expect(applyBoardFilters(all, filters({ due: ['week'] }), now)).toEqual([soon]);
    expect(applyBoardFilters(all, filters({ due: ['none'] }), now)).toEqual([none]);
  });

  test('chips name the current user "me"', () => {
    const chips = describeFilters(filters({ assigneeIds: ['me-id'], due: ['overdue'] }), {
      currentUserId: 'me-id',
      members: new Map(),
      labels: new Map(),
    });
    expect(chips.map((c) => c.label)).toEqual(['Assignee: me', 'Due: Overdue']);
  });
});
