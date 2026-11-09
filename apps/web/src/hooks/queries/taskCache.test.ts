import { describe, expect, test } from 'bun:test';
import type { TaskDto, TaskStateDto } from '../../api/types';
import {
  flattenPages,
  moveTaskInList,
  moveTaskInPages,
  removeTask,
  taskListAdapter,
  upsertTask,
  type TaskPages,
} from './taskCache';

const todo: TaskStateDto = { id: 's-todo', projectId: 'p1', name: 'Todo', category: 'backlog', position: 'a0', color: null };
const doing: TaskStateDto = { id: 's-doing', projectId: 'p1', name: 'Doing', category: 'in_progress', position: 'a1', color: null };

function task(id: string, state: TaskStateDto, position: string): TaskDto {
  return {
    id,
    projectId: 'p1',
    stateId: state.id,
    state,
    sequenceNumber: 1,
    title: id,
    description: null,
    priority: null,
    position,
    dueDate: null,
    startDate: null,
    createdBy: null,
    deletedAt: null,
    createdAt: '2026-11-01T00:00:00.000Z',
    assignees: [],
    labels: [],
    project: { id: 'p1', identifier: 'TF', name: 'Web' },
    agent: null,
    externalLinks: [],
  };
}

function pages(...chunks: TaskDto[][]): TaskPages {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  return {
    pageParams: chunks.map((_, i) => i + 1),
    pages: chunks.map((data, i) => ({ success: true, data, meta: { total, page: i + 1, limit: 2 } })),
  };
}

const a = task('a', todo, 'a0');
const b = task('b', todo, 'a1');
const c = task('c', doing, 'a0');
const d = task('d', doing, 'a1');

describe('moveTaskInList', () => {
  test('moves between neighbours in another column and computes a position between them', () => {
    const result = moveTaskInList([a, b, c, d], { taskId: 'a', stateId: doing.id, afterTaskId: 'c', beforeTaskId: 'd' }, doing);
    expect(result.map((t) => t.id)).toEqual(['b', 'c', 'a', 'd']);
    const moved = result[2];
    expect(moved.stateId).toBe(doing.id);
    expect(moved.state).toEqual(doing);
    expect(moved.position > 'a0' && moved.position < 'a1').toBe(true);
  });

  test('beforeTaskId alone inserts at the top of a column', () => {
    const result = moveTaskInList([a, b, c, d], { taskId: 'b', stateId: doing.id, beforeTaskId: 'c' }, doing);
    expect(result.map((t) => t.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result[1].position < 'a0').toBe(true);
  });

  test('no neighbours appends to the end of the target column', () => {
    const result = moveTaskInList([a, b, c, d], { taskId: 'a', stateId: doing.id }, doing);
    expect(result.map((t) => t.id)).toEqual(['b', 'c', 'd', 'a']);
    expect(result[3].position > 'a1').toBe(true);
  });

  test('the key goes between the named neighbours even when the cached order differs', () => {
    const x = task('x', todo, 'a2');
    // Cached order is not key order (e.g. after realtime appends).
    const result = moveTaskInList([b, a, x], { taskId: 'x', stateId: todo.id, afterTaskId: 'a', beforeTaskId: 'b' }, todo);
    const moved = result.find((t) => t.id === 'x')!;
    expect(moved.position > 'a0' && moved.position < 'a1').toBe(true);
  });

  test('a state change bumps updatedAt (Done columns sort by it); a reorder does not', () => {
    const moved = moveTaskInList([a, b, c], { taskId: 'a', stateId: doing.id, afterTaskId: null, beforeTaskId: 'c' }, doing);
    expect(moved.find((t) => t.id === 'a')!.updatedAt).toBeDefined();
    const reordered = moveTaskInList([a, b], { taskId: 'a', stateId: todo.id, afterTaskId: 'b', beforeTaskId: null }, todo);
    expect(reordered.find((t) => t.id === 'a')!.updatedAt).toBeUndefined();
    expect(reordered.find((t) => t.id === 'a')!.position > 'a1').toBe(true);
  });

  test('unknown task is a no-op', () => {
    const list = [a, b];
    expect(moveTaskInList(list, { taskId: 'zz', stateId: todo.id }, todo)).toBe(list);
  });
});

describe('page helpers', () => {
  test('moveTaskInPages keeps page sizes and totals', () => {
    const data = pages([a, b], [c, d]);
    const next = moveTaskInPages(data, taskListAdapter, { taskId: 'd', stateId: todo.id, afterTaskId: 'a' }, todo)!;
    expect(next.pages.map((p) => p.data.length)).toEqual([2, 2]);
    expect(flattenPages(next, taskListAdapter).map((t) => t.id)).toEqual(['a', 'd', 'b', 'c']);
    expect(next.pages[0].meta!.total).toBe(4);
  });

  test('upsertTask merges an existing task in place', () => {
    const data = pages([a, b]);
    const next = upsertTask(data, taskListAdapter, { ...b, title: 'renamed' })!;
    expect(next.pages[0].data[1].title).toBe('renamed');
    expect(next.pages[0].meta!.total).toBe(2);
  });

  test('upsertTask appends only when asked', () => {
    const data = pages([a]);
    expect(upsertTask(data, taskListAdapter, c)).toBe(data);
    const next = upsertTask(data, taskListAdapter, c, { appendIfMissing: true })!;
    expect(flattenPages(next, taskListAdapter).map((t) => t.id)).toEqual(['a', 'c']);
    expect(next.pages[0].meta!.total).toBe(2);
  });

  test('removeTask drops the task and decrements the total', () => {
    const data = pages([a, b], [c]);
    const next = removeTask(data, taskListAdapter, 'b')!;
    expect(flattenPages(next, taskListAdapter).map((t) => t.id)).toEqual(['a', 'c']);
    expect(next.pages.every((p) => p.meta!.total === 2)).toBe(true);
    expect(removeTask(next, taskListAdapter, 'nope')).toBe(next);
  });

  test('flattenPages removes duplicates across pages', () => {
    expect(flattenPages(pages([a, b], [b, c]), taskListAdapter).map((t) => t.id)).toEqual(['a', 'b', 'c']);
  });
});
