import { describe, expect, test } from 'bun:test';
import type { QueryKey } from '@tanstack/react-query';
import { REALTIME_EVENTS } from '@flowtask/shared/constants';
import type { JsonObject } from '@flowtask/shared/json';
import {
  actionsForEvent,
  createInvalidationBatcher,
  dedupeKeys,
  isCompleteTaskPayload,
  isKeyPrefix,
  parseEventData,
  reconnectDelay,
  statusAfterError,
  type Scheduler,
} from './realtime';

const fullTask: JsonObject = {
  id: 't1',
  projectId: 'p1',
  title: 'Fix it',
  position: 'a0',
  stateId: 's1',
  state: {
    id: 's1',
    name: 'Todo',
    category: 'backlog',
    color: null,
    position: 'a0',
    projectId: 'p1',
  },
  assignees: [],
  labels: [],
  project: { id: 'p1', identifier: 'TF', name: 'Web' },
};

/** Manual scheduler: timers fire only when `tick` is called. */
function fakeScheduler() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const scheduler: Scheduler = {
    setTimeout: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout: (id) => {
      timers.delete(id);
    },
  };
  return {
    scheduler,
    tick(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

describe('parseEventData', () => {
  test('parses objects and rejects the rest', () => {
    expect(parseEventData('{"id":"x"}')).toEqual({ id: 'x' });
    expect(parseEventData('[1]')).toBeNull();
    expect(parseEventData('not json')).toBeNull();
  });
});

describe('isCompleteTaskPayload', () => {
  test('accepts a full task', () => {
    expect(isCompleteTaskPayload(fullTask)).toBe(true);
  });
  test('rejects ids-only (truncated) payloads', () => {
    expect(isCompleteTaskPayload({ id: 't1', projectId: 'p1', truncated: true })).toBe(false);
    expect(isCompleteTaskPayload({ ...fullTask, truncated: true })).toBe(false);
  });
});

describe('actionsForEvent', () => {
  test('complete task:updated → upsert, plus smart views/activity/history invalidations', () => {
    const actions = actionsForEvent(REALTIME_EVENTS.TASK_UPDATED, fullTask);
    expect(actions[0]).toMatchObject({ type: 'upsertTask', created: false });
    const keys = actions.flatMap((a) => (a.type === 'invalidate' ? [a.queryKey] : []));
    expect(keys).toContainEqual(['smart-views', 'execute']);
    expect(keys).toContainEqual(['tasks', 'history', 't1']);
    expect(keys).not.toContainEqual(['tasks', 'list', 'p1']);
  });

  test('ids-only task:moved → invalidate the project lists and the detail', () => {
    const actions = actionsForEvent(REALTIME_EVENTS.TASK_MOVED, {
      id: 't1',
      projectId: 'p1',
      truncated: true,
    });
    expect(actions.some((a) => a.type === 'upsertTask')).toBe(false);
    expect(actions).toContainEqual({ type: 'invalidate', queryKey: ['tasks', 'list', 'p1'] });
    expect(actions).toContainEqual({ type: 'invalidate', queryKey: ['tasks', 'detail', 't1'] });
  });

  test('task:created is an upsert flagged as created', () => {
    expect(actionsForEvent(REALTIME_EVENTS.TASK_CREATED, fullTask)[0]).toMatchObject({
      type: 'upsertTask',
      created: true,
    });
  });

  test('task:deleted removes the task', () => {
    const actions = actionsForEvent(REALTIME_EVENTS.TASK_DELETED, { id: 't1', projectId: 'p1' });
    expect(actions[0]).toEqual({ type: 'removeTask', taskId: 't1', projectId: 'p1' });
    expect(actions).toContainEqual({ type: 'invalidate', queryKey: ['projects', 'trash', 'p1'] });
  });

  test('notification:* invalidates every notification query', () => {
    expect(actionsForEvent(REALTIME_EVENTS.NOTIFICATION_CREATED, { id: 'n1' })).toEqual([
      { type: 'invalidate', queryKey: ['notifications'] },
    ]);
    expect(actionsForEvent('notification:read', {})).toEqual([
      { type: 'invalidate', queryKey: ['notifications'] },
    ]);
  });

  test('comment events target the task comments and history', () => {
    const keys = actionsForEvent(REALTIME_EVENTS.COMMENT_CREATED, {
      taskId: 't1',
      commentId: 'c1',
    }).map((a) => (a.type === 'invalidate' ? a.queryKey : null));
    expect(keys).toContainEqual(['tasks', 'comments', 't1']);
    expect(keys).toContainEqual(['tasks', 'history', 't1']);
  });

  test('member events invalidate the workspace members', () => {
    expect(
      actionsForEvent(REALTIME_EVENTS.MEMBER_JOINED, { workspaceId: 'w1', userId: 'u1' })
    ).toContainEqual({
      type: 'invalidate',
      queryKey: ['workspaces', 'members', 'w1'],
    });
  });

  test('unknown events do nothing', () => {
    expect(actionsForEvent('connected', {})).toEqual([]);
  });
});

describe('dedupeKeys / isKeyPrefix', () => {
  test('a shorter key covers longer ones', () => {
    expect(isKeyPrefix(['tasks'], ['tasks', 'list', 'p1'])).toBe(true);
    expect(isKeyPrefix(['tasks', 'list', 'p2'], ['tasks', 'list', 'p1'])).toBe(false);
    const keys: QueryKey[] = [
      ['tasks', 'list', 'p1'],
      ['tasks'],
      ['tasks', 'list', 'p1'],
      ['notifications'],
    ];
    expect(dedupeKeys(keys)).toEqual([['tasks'], ['notifications']]);
  });

  test('object parts compare by value', () => {
    expect(
      dedupeKeys([
        ['tasks', 'list', 'p1', { a: '1' }],
        ['tasks', 'list', 'p1', { a: '1' }],
      ])
    ).toHaveLength(1);
  });
});

describe('createInvalidationBatcher', () => {
  test('debounces bursts into one deduplicated flush', () => {
    const { scheduler, tick } = fakeScheduler();
    const flushed: QueryKey[][] = [];
    const batcher = createInvalidationBatcher((keys) => flushed.push(keys), {
      delayMs: 150,
      scheduler,
    });

    batcher.add(['tasks', 'list', 'p1']);
    tick(100);
    batcher.add(['tasks', 'list', 'p1']);
    batcher.add(['notifications']);
    tick(100);
    expect(flushed).toHaveLength(0);
    expect(batcher.pending).toBe(3);
    tick(60);
    expect(flushed).toEqual([[['notifications'], ['tasks', 'list', 'p1']]]);
    expect(batcher.pending).toBe(0);
  });

  test('flush() and cancel()', () => {
    const { scheduler, tick } = fakeScheduler();
    const flushed: QueryKey[][] = [];
    const batcher = createInvalidationBatcher((keys) => flushed.push(keys), { scheduler });
    batcher.add(['a']);
    batcher.flush();
    expect(flushed).toEqual([[['a']]]);
    batcher.add(['b']);
    batcher.cancel();
    tick(1000);
    expect(flushed).toHaveLength(1);
  });
});

describe('connection helpers', () => {
  test('statusAfterError', () => {
    expect(statusAfterError(0, false)).toBe('connecting');
    expect(statusAfterError(0, true)).toBe('reconnecting');
    expect(statusAfterError(2, true)).toBe('reconnecting');
  });

  test('reconnectDelay grows exponentially and is capped', () => {
    expect(reconnectDelay(0, () => 1)).toBe(1000);
    expect(reconnectDelay(3, () => 1)).toBe(8000);
    expect(reconnectDelay(20, () => 1)).toBe(30000);
    expect(reconnectDelay(0, () => 0)).toBe(500);
  });
});
