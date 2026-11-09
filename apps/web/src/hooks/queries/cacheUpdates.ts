/**
 * Cache patching across every cached task list (project lists and smart
 * views). Used by the optimistic mutations and the realtime hook.
 */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import type {
  MoveTaskInput,
  ProjectDetailDto,
  TaskDetailDto,
  TaskDto,
  TaskStateDto,
} from '../../api/types';
import {
  findStateInTasks,
  flattenPages,
  moveTaskInPages,
  removeTask,
  smartViewAdapter,
  taskListAdapter,
  upsertTask,
  type SmartViewPages,
  type TaskPages,
} from './taskCache';

/** A project list key is ['tasks','list',projectId,filters]; filtered lists may not contain every task. */
/**
 * Whether a list key narrows the project's tasks in a way the cache can't
 * replay. `parentId: 'none'` (top-level only, every board) is replayable: a
 * top-level task belongs in it, a sub-task doesn't.
 */
export function isFilteredListKey(key: QueryKey, task?: { parentId?: string | null }): boolean {
  const filters = key[3];
  if (typeof filters !== 'object' || filters === null) return false;
  const entries = Object.entries(filters);
  return entries.some(
    ([name, value]) => !(name === 'parentId' && value === 'none' && task?.parentId == null)
  );
}

export interface TaskCacheSnapshot {
  lists: Array<[QueryKey, TaskPages | undefined]>;
  views: Array<[QueryKey, SmartViewPages | undefined]>;
  details: Array<[QueryKey, TaskDetailDto | undefined]>;
}

/** Cancel in-flight list fetches so they can't overwrite an optimistic update. */
export async function cancelTaskQueries(queryClient: QueryClient, taskId?: string): Promise<void> {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: queryKeys.tasks.lists() }),
    queryClient.cancelQueries({ queryKey: queryKeys.smartViews.executions() }),
    taskId ? queryClient.cancelQueries({ queryKey: queryKeys.tasks.detail(taskId) }) : undefined,
  ]);
}

export function snapshotTaskCaches(queryClient: QueryClient, taskId?: string): TaskCacheSnapshot {
  return {
    lists: queryClient.getQueriesData<TaskPages>({ queryKey: queryKeys.tasks.lists() }),
    views: queryClient.getQueriesData<SmartViewPages>({
      queryKey: queryKeys.smartViews.executions(),
    }),
    details: taskId
      ? queryClient.getQueriesData<TaskDetailDto>({ queryKey: queryKeys.tasks.detail(taskId) })
      : [],
  };
}

export function restoreTaskCaches(
  queryClient: QueryClient,
  snapshot: TaskCacheSnapshot | undefined
): void {
  if (!snapshot) return;
  for (const [key, data] of snapshot.lists) queryClient.setQueryData(key, data);
  for (const [key, data] of snapshot.views) queryClient.setQueryData(key, data);
  for (const [key, data] of snapshot.details) queryClient.setQueryData(key, data);
}

/** Merge a task into every cache holding it; append to its project's unfiltered list when `created`. */
export function upsertTaskEverywhere(
  queryClient: QueryClient,
  task: TaskDto,
  options: { created?: boolean } = {}
): void {
  for (const [key] of queryClient.getQueriesData<TaskPages>({
    queryKey: queryKeys.tasks.project(task.projectId),
  })) {
    const appendIfMissing = Boolean(options.created) && !isFilteredListKey(key, task);
    queryClient.setQueryData<TaskPages>(key, (data) =>
      upsertTask(data, taskListAdapter, task, { appendIfMissing })
    );
  }
  queryClient.setQueriesData<SmartViewPages>(
    { queryKey: queryKeys.smartViews.executions() },
    (data) => upsertTask(data, smartViewAdapter, task)
  );
  queryClient.setQueryData<TaskDetailDto>(queryKeys.tasks.detail(task.id), (detail) =>
    detail ? { ...detail, ...task } : detail
  );
}

export function removeTaskEverywhere(queryClient: QueryClient, taskId: string): void {
  queryClient.setQueriesData<TaskPages>({ queryKey: queryKeys.tasks.lists() }, (data) =>
    removeTask(data, taskListAdapter, taskId)
  );
  queryClient.setQueriesData<SmartViewPages>(
    { queryKey: queryKeys.smartViews.executions() },
    (data) => removeTask(data, smartViewAdapter, taskId)
  );
}

/** The cached state object for a state id (from the project, else from any cached task). */
export function resolveCachedState(
  queryClient: QueryClient,
  stateId: string,
  projectId?: string
): TaskStateDto | null {
  if (projectId) {
    const project = queryClient.getQueryData<ProjectDetailDto>(
      queryKeys.projects.detail(projectId)
    );
    const state = project?.taskStates.find((s) => s.id === stateId);
    if (state) return state;
  }
  for (const [, data] of queryClient.getQueriesData<TaskPages>({
    queryKey: queryKeys.tasks.lists(),
  })) {
    const state = findStateInTasks(flattenPages(data, taskListAdapter), stateId);
    if (state) return state;
  }
  return null;
}

/** Find a cached copy of a task (lists, then smart views). */
export function findCachedTask(queryClient: QueryClient, taskId: string): TaskDto | undefined {
  for (const [, data] of queryClient.getQueriesData<TaskPages>({
    queryKey: queryKeys.tasks.lists(),
  })) {
    const task = flattenPages(data, taskListAdapter).find((t) => t.id === taskId);
    if (task) return task;
  }
  for (const [, data] of queryClient.getQueriesData<SmartViewPages>({
    queryKey: queryKeys.smartViews.executions(),
  })) {
    const task = flattenPages(data, smartViewAdapter).find((t) => t.id === taskId);
    if (task) return task;
  }
  return queryClient.getQueryData<TaskDetailDto>(queryKeys.tasks.detail(taskId));
}

/** Optimistically apply a move in every cached list holding the task. */
export function applyMoveEverywhere(queryClient: QueryClient, input: MoveTaskInput): void {
  const task = findCachedTask(queryClient, input.taskId);
  const state = resolveCachedState(queryClient, input.stateId, task?.projectId);
  queryClient.setQueriesData<TaskPages>({ queryKey: queryKeys.tasks.lists() }, (data) =>
    moveTaskInPages(data, taskListAdapter, input, state)
  );
  queryClient.setQueriesData<SmartViewPages>(
    { queryKey: queryKeys.smartViews.executions() },
    (data) => moveTaskInPages(data, smartViewAdapter, input, state)
  );
  queryClient.setQueryData<TaskDetailDto>(queryKeys.tasks.detail(input.taskId), (detail) =>
    detail ? { ...detail, stateId: input.stateId, state: state ?? detail.state } : detail
  );
}
