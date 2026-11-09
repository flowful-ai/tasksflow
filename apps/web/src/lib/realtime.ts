/**
 * Pure realtime logic (no React, no EventSource), unit-tested in realtime.test.ts.
 *
 * - `actionsForEvent` maps an SSE event to cache actions: patch a task list
 *   when the payload is a complete task, otherwise invalidate the right keys.
 * - `createInvalidationBatcher` collects keys and flushes them once after a
 *   quiet period (150 ms), deduplicating keys covered by a shorter prefix.
 */
import type { QueryKey } from '@tanstack/react-query';
import { REALTIME_EVENTS } from '@flowtask/shared/constants';
import { isJsonObject, type JsonObject, type JsonValue } from '@flowtask/shared/json';
import { queryKeys } from '../api/queryKeys';
import type { TaskDto } from '../api/types';

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting';

export type CacheAction =
  | { type: 'invalidate'; queryKey: QueryKey }
  /** Merge the task into cached lists of its project (append when created). */
  | { type: 'upsertTask'; task: TaskDto; created: boolean }
  | { type: 'removeTask'; taskId: string; projectId: string | null };

/** Every named SSE event the client listens to. */
export const REALTIME_EVENT_NAMES: readonly string[] = Object.values(REALTIME_EVENTS);

export function parseEventData(raw: string): JsonObject | null {
  try {
    const parsed = JSON.parse(raw) as JsonValue;
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function str(data: JsonObject, key: string): string | null {
  const value = data[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * True when an event payload is a full task (TaskWithRelations), not the
 * ids-only form the server sends when the payload is too large (`truncated`).
 */
export function isCompleteTaskPayload(record: JsonObject): record is JsonObject & TaskDto {
  if (record.truncated === true) return false;
  return (
    typeof record.id === 'string' &&
    typeof record.projectId === 'string' &&
    typeof record.title === 'string' &&
    typeof record.position === 'string' &&
    'stateId' in record &&
    'state' in record &&
    Array.isArray(record.assignees) &&
    Array.isArray(record.labels) &&
    isJsonObject(record.project ?? null)
  );
}

export function actionsForEvent(event: string, data: JsonObject): CacheAction[] {
  if (event.startsWith('notification:')) {
    return [{ type: 'invalidate', queryKey: queryKeys.notifications.all }];
  }

  const taskId = str(data, 'id');
  const projectId = str(data, 'projectId');
  const taskListKey: QueryKey = projectId
    ? queryKeys.tasks.project(projectId)
    : queryKeys.tasks.lists();
  const smartViews: CacheAction = {
    type: 'invalidate',
    queryKey: queryKeys.smartViews.executions(),
  };
  const activity: CacheAction = { type: 'invalidate', queryKey: queryKeys.workspaces.activities() };

  switch (event) {
    case REALTIME_EVENTS.TASK_CREATED:
    case REALTIME_EVENTS.TASK_UPDATED:
    case REALTIME_EVENTS.TASK_MOVED: {
      const created = event === REALTIME_EVENTS.TASK_CREATED;
      const actions: CacheAction[] = [smartViews, activity];
      if (isCompleteTaskPayload(data)) {
        actions.unshift({ type: 'upsertTask', task: data, created });
      } else {
        actions.unshift({ type: 'invalidate', queryKey: taskListKey });
        if (taskId) actions.push({ type: 'invalidate', queryKey: queryKeys.tasks.detail(taskId) });
      }
      if (taskId && !created) {
        actions.push({ type: 'invalidate', queryKey: queryKeys.tasks.history(taskId) });
      }
      return actions;
    }

    case REALTIME_EVENTS.TASK_DELETED: {
      const actions: CacheAction[] = [smartViews, activity];
      if (taskId) {
        actions.unshift({ type: 'removeTask', taskId, projectId });
        actions.push({ type: 'invalidate', queryKey: queryKeys.tasks.detail(taskId) });
      } else {
        actions.unshift({ type: 'invalidate', queryKey: taskListKey });
      }
      if (projectId)
        actions.push({ type: 'invalidate', queryKey: queryKeys.projects.trashAll(projectId) });
      return actions;
    }

    case REALTIME_EVENTS.TASKS_REKEYED:
      return [{ type: 'invalidate', queryKey: taskListKey }, smartViews];

    case REALTIME_EVENTS.COMMENT_CREATED:
    case REALTIME_EVENTS.COMMENT_UPDATED:
    case REALTIME_EVENTS.COMMENT_DELETED: {
      const commentTaskId = str(data, 'taskId');
      if (!commentTaskId) return [activity];
      return [
        { type: 'invalidate', queryKey: queryKeys.tasks.comments(commentTaskId) },
        { type: 'invalidate', queryKey: queryKeys.tasks.history(commentTaskId) },
        activity,
      ];
    }

    case REALTIME_EVENTS.PROJECT_UPDATED: {
      const id = str(data, 'id') ?? projectId;
      const actions: CacheAction[] = [{ type: 'invalidate', queryKey: queryKeys.projects.lists() }];
      if (id) actions.push({ type: 'invalidate', queryKey: queryKeys.projects.detail(id) });
      return actions;
    }

    case REALTIME_EVENTS.MEMBER_JOINED:
    case REALTIME_EVENTS.MEMBER_LEFT: {
      const workspaceId = str(data, 'workspaceId');
      if (!workspaceId) return [{ type: 'invalidate', queryKey: queryKeys.workspaces.all }];
      return [
        { type: 'invalidate', queryKey: queryKeys.workspaces.detail(workspaceId) },
        { type: 'invalidate', queryKey: queryKeys.workspaces.members(workspaceId) },
      ];
    }

    default:
      return [];
  }
}

function keyHash(key: QueryKey): string {
  return JSON.stringify(key);
}

/** True when `prefix` is a prefix of `key` (element-wise, by JSON equality). */
export function isKeyPrefix(prefix: QueryKey, key: QueryKey): boolean {
  if (prefix.length > key.length) return false;
  return prefix.every((part, i) => keyHash([part]) === keyHash([key[i]]));
}

/** Remove duplicates and keys already covered by a shorter key in the set. */
export function dedupeKeys(keys: readonly QueryKey[]): QueryKey[] {
  const unique = new Map<string, QueryKey>();
  for (const key of keys) unique.set(keyHash(key), key);
  const list = [...unique.values()].sort((a, b) => a.length - b.length);
  const result: QueryKey[] = [];
  for (const key of list) {
    if (!result.some((kept) => isKeyPrefix(kept, key))) result.push(key);
  }
  return result;
}

export interface Scheduler {
  setTimeout: (fn: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
}

const browserScheduler: Scheduler = {
  setTimeout: (fn, ms) => window.setTimeout(fn, ms),
  clearTimeout: (id) => window.clearTimeout(id),
};

export interface InvalidationBatcher {
  add: (key: QueryKey) => void;
  /** Flush now (e.g. before the page hides). */
  flush: () => void;
  /** Drop pending keys without flushing. */
  cancel: () => void;
  readonly pending: number;
}

/**
 * Trailing debounce: every `add` restarts the timer; after `delayMs` of quiet
 * the deduplicated keys are flushed in one call. `maxWaitMs` caps the delay
 * during a continuous burst.
 */
export function createInvalidationBatcher(
  onFlush: (keys: QueryKey[]) => void,
  options: { delayMs?: number; maxWaitMs?: number; scheduler?: Scheduler } = {}
): InvalidationBatcher {
  const { delayMs = 150, maxWaitMs = 1000, scheduler = browserScheduler } = options;
  let keys: QueryKey[] = [];
  let timer: number | null = null;
  let firstAddAt: number | null = null;

  const flush = () => {
    if (timer !== null) scheduler.clearTimeout(timer);
    timer = null;
    firstAddAt = null;
    if (keys.length === 0) return;
    const batch = dedupeKeys(keys);
    keys = [];
    onFlush(batch);
  };

  return {
    add(key) {
      keys.push(key);
      const now = Date.now();
      firstAddAt ??= now;
      if (timer !== null) scheduler.clearTimeout(timer);
      const wait = Math.max(0, Math.min(delayMs, firstAddAt + maxWaitMs - now));
      timer = scheduler.setTimeout(flush, wait);
    },
    flush,
    cancel() {
      if (timer !== null) scheduler.clearTimeout(timer);
      timer = null;
      firstAddAt = null;
      keys = [];
    },
    get pending() {
      return keys.length;
    },
  };
}

/** Next status after an EventSource error, given whether it was ever open. */
export function statusAfterError(readyState: number, everOpened: boolean): ConnectionStatus {
  // 0 = CONNECTING (the browser is retrying), 2 = CLOSED (we re-create it).
  if (readyState === 1) return 'live';
  return everOpened ? 'reconnecting' : 'connecting';
}

/** Backoff for re-creating a CLOSED EventSource (the browser only retries while CONNECTING). */
export function reconnectDelay(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1000 * 2 ** attempt);
  return Math.round(base * (0.5 + random() / 2));
}
