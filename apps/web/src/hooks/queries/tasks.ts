import { useEffect, useMemo } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import type { BulkTaskItemResult, BulkTaskOperation } from '@flowtask/shared';
import { queryKeys, hasActiveFilters } from '../../api/queryKeys';
import { commentsApi, TASK_PAGE_SIZE, tasksApi, trashApi } from '../../api/tasks';
import type {
  BulkTaskResponseDto,
  CreateTaskInput,
  MoveTaskInput,
  TaskDetailDto,
  TaskDto,
  TaskListFilters,
  UpdateTaskInput,
} from '../../api/types';
import { toastUndo } from '../../components/ui/Toast';
import {
  applyMoveEverywhere,
  cancelTaskQueries,
  findCachedTask,
  removeTaskEverywhere,
  restoreTaskCaches,
  snapshotTaskCaches,
  upsertTaskEverywhere,
  type TaskCacheSnapshot,
} from './cacheUpdates';
import { flattenPages, taskListAdapter, type TaskListPage } from './taskCache';

// ============ Queries ============

export interface UseProjectTasksOptions {
  enabled?: boolean;
}

/**
 * Every task of a project (optionally filtered), sorted by position.
 *
 * Loads ALL pages (100 per request) one after another, so boards never stop
 * at 50 tasks. `tasks` grows as pages arrive; `isComplete` is true once the
 * last page is in; `total` is the server count. Toggling a filter keeps the
 * previous result on screen until the new one arrives (keepPreviousData).
 */
export function useProjectTasks(
  projectId: string | null | undefined,
  filters: TaskListFilters = {},
  options: UseProjectTasksOptions = {}
) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.tasks.list(projectId ?? '', filters),
    queryFn: ({ pageParam, signal }) =>
      tasksApi.listPage(projectId ?? '', pageParam, filters, TASK_PAGE_SIZE, signal),
    initialPageParam: 1,
    getNextPageParam: (lastPage: TaskListPage, pages: TaskListPage[]) => {
      const loaded = pages.reduce((sum, page) => sum + page.data.length, 0);
      const total = lastPage.meta?.total ?? 0;
      return lastPage.data.length > 0 && loaded < total ? pages.length + 1 : undefined;
    },
    enabled: Boolean(projectId) && (options.enabled ?? true),
    placeholderData: keepPreviousData,
  });

  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage, isPlaceholderData } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError && !isPlaceholderData) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, isPlaceholderData, fetchNextPage]);

  const tasks = useMemo(() => flattenPages(query.data, taskListAdapter), [query.data]);
  const total = query.data?.pages[0]?.meta?.total ?? tasks.length;

  return {
    ...query,
    tasks,
    total,
    /** All pages are loaded (the board shows every task). */
    isComplete: !hasNextPage && !query.isLoading,
    isFiltered: hasActiveFilters(filters),
  };
}

/** Task detail (parent, sub-tasks, blocking relations). Seeded from a cached list copy. */
export function useTask(
  taskId: string | null | undefined,
  options: { includeDeleted?: boolean; enabled?: boolean } = {}
) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.tasks.detail(taskId ?? ''),
    queryFn: () => tasksApi.get(taskId ?? '', { includeDeleted: options.includeDeleted }),
    enabled: Boolean(taskId) && (options.enabled ?? true),
    placeholderData: () => (taskId ? findCachedTask(queryClient, taskId) : undefined),
  });
}

export function useTaskComments(taskId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.tasks.comments(taskId ?? ''),
    queryFn: () => commentsApi.list(taskId ?? ''),
    enabled: Boolean(taskId),
  });
}

// ============ Mutations ============

/** Refresh what a task change can affect (counts, filtered lists, smart views, history). */
export function invalidateAfterTaskChange(
  queryClient: QueryClient,
  task: { id?: string; projectId?: string | null }
) {
  return Promise.all([
    task.projectId
      ? queryClient.invalidateQueries({ queryKey: queryKeys.tasks.project(task.projectId) })
      : queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.smartViews.executions() }),
    queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.activities() }),
    task.id
      ? queryClient.invalidateQueries({ queryKey: queryKeys.tasks.history(task.id) })
      : undefined,
  ]);
}

export function useCreateTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateTaskInput) => tasksApi.create(input),
    onSuccess: (task) => {
      upsertTaskEverywhere(queryClient, task, { created: true });
      return Promise.all([
        invalidateAfterTaskChange(queryClient, task),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() }),
      ]);
    },
    meta: { errorMessage: 'Could not create the task' },
  });
}

export interface UpdateTaskVariables extends UpdateTaskInput {
  taskId: string;
}

/** Update fields; the cached task is patched optimistically and rolled back on error. */
export function useUpdateTask() {
  const queryClient = useQueryClient();
  return useMutation<TaskDetailDto, Error, UpdateTaskVariables, TaskCacheSnapshot>({
    mutationFn: ({ taskId, ...input }) => tasksApi.update(taskId, input),
    onMutate: async ({ taskId, ...input }) => {
      await cancelTaskQueries(queryClient, taskId);
      const snapshot = snapshotTaskCaches(queryClient, taskId);
      const cached = findCachedTask(queryClient, taskId);
      // Only scalar fields can be applied locally; id lists need server data.
      const { assigneeIds: _a, labelIds: _l, ...scalars } = input;
      if (cached) upsertTaskEverywhere(queryClient, { ...cached, ...scalars });
      return snapshot;
    },
    onError: (_error, _variables, snapshot) => restoreTaskCaches(queryClient, snapshot),
    onSuccess: (task) => {
      upsertTaskEverywhere(queryClient, task);
      queryClient.setQueryData(queryKeys.tasks.detail(task.id), task);
    },
    onSettled: (task, _error, variables) =>
      invalidateAfterTaskChange(queryClient, { id: variables.taskId, projectId: task?.projectId }),
    meta: { errorMessage: 'Could not update the task' },
  });
}

/**
 * Move a task to a column and/or between two neighbours.
 *
 *   move.mutate({ taskId, stateId, afterTaskId, beforeTaskId })
 *
 * onMutate cancels list fetches, snapshots every cache, then reorders the task
 * locally; onError rolls back (and the global handler toasts); onSettled
 * refetches so the server's position wins.
 */
export function useMoveTask() {
  const queryClient = useQueryClient();
  return useMutation<TaskDetailDto, Error, MoveTaskInput, TaskCacheSnapshot>({
    mutationFn: (input) => tasksApi.move(input),
    onMutate: async (input) => {
      await cancelTaskQueries(queryClient, input.taskId);
      const snapshot = snapshotTaskCaches(queryClient, input.taskId);
      applyMoveEverywhere(queryClient, input);
      return snapshot;
    },
    onError: (_error, _input, snapshot) => restoreTaskCaches(queryClient, snapshot),
    onSuccess: (task) => upsertTaskEverywhere(queryClient, task),
    onSettled: (task, _error, input) =>
      invalidateAfterTaskChange(queryClient, {
        id: input.taskId,
        projectId: task?.projectId ?? findCachedTask(queryClient, input.taskId)?.projectId,
      }),
    meta: { errorMessage: 'Could not move the task' },
  });
}

export interface DeleteTaskVariables {
  taskId: string;
  projectId: string;
  /** Shown in the toast, e.g. "TF-12". */
  label?: string;
}

/**
 * Soft-delete with an undo toast (no confirm dialog). The task disappears
 * immediately; Undo restores it from the trash.
 */
export function useDeleteTask() {
  const queryClient = useQueryClient();
  return useMutation<null, Error, DeleteTaskVariables, TaskCacheSnapshot>({
    mutationFn: ({ taskId }) => tasksApi.delete(taskId),
    onMutate: async ({ taskId }) => {
      await cancelTaskQueries(queryClient, taskId);
      const snapshot = snapshotTaskCaches(queryClient, taskId);
      removeTaskEverywhere(queryClient, taskId);
      return snapshot;
    },
    onError: (_error, _variables, snapshot) => restoreTaskCaches(queryClient, snapshot),
    onSuccess: (_data, { taskId, projectId, label }) => {
      queryClient.removeQueries({ queryKey: queryKeys.tasks.detail(taskId), exact: true });
      toastUndo(label ? `Deleted ${label}` : 'Task deleted', async () => {
        const restored = await trashApi.restore(projectId, taskId);
        upsertTaskEverywhere(queryClient, restored, { created: true });
        await invalidateAfterTaskChange(queryClient, { id: taskId, projectId });
      });
    },
    onSettled: (_data, _error, { taskId, projectId }) =>
      Promise.all([
        invalidateAfterTaskChange(queryClient, { id: taskId, projectId }),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.trashAll(projectId) }),
      ]),
    meta: { errorMessage: 'Could not delete the task' },
  });
}

export interface BulkTaskVariables {
  taskIds: string[];
  op: BulkTaskOperation;
}

export interface BulkSummary {
  updated: number;
  unchanged: number;
  failed: number;
  results: BulkTaskItemResult[];
}

export function summarizeBulk(response: BulkTaskResponseDto): BulkSummary {
  let updated = 0;
  let unchanged = 0;
  let failed = 0;
  for (const result of response.results) {
    if (result.status === 'updated') updated += 1;
    else if (result.status === 'unchanged') unchanged += 1;
    else failed += 1;
  }
  return { updated, unchanged, failed, results: response.results };
}

/**
 * One POST /api/tasks/bulk for up to 200 tasks. Returned tasks are written to
 * the caches; deleted ones are removed. Use `summarizeBulk` for the toast.
 */
export function useBulkTasks() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ taskIds, op }: BulkTaskVariables) => tasksApi.bulk(taskIds, op),
    onSuccess: (response, { op }) => {
      const touched = new Set(
        response.results.filter((r) => r.status === 'updated').map((r) => r.taskId)
      );
      if (op.delete) {
        for (const taskId of touched) removeTaskEverywhere(queryClient, taskId);
      } else {
        for (const task of response.tasks)
          upsertTaskEverywhere(queryClient, task, { created: Boolean(op.restore) });
      }
    },
    onSettled: (response) => {
      const projectIds = new Set((response?.tasks ?? []).map((t: TaskDto) => t.projectId));
      return Promise.all([
        projectIds.size > 0
          ? Promise.all(
              [...projectIds].map((id) =>
                queryClient.invalidateQueries({ queryKey: queryKeys.tasks.project(id) })
              )
            )
          : queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.smartViews.executions() }),
        queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.activities() }),
      ]);
    },
    meta: { errorMessage: 'Bulk action failed' },
  });
}

/** Add/remove one assignee or label (task detail pickers). */
export function useTaskRelationsMutations(taskId: string, projectId?: string) {
  const queryClient = useQueryClient();
  const onSettled = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) }),
      invalidateAfterTaskChange(queryClient, { id: taskId, projectId }),
    ]);
  return {
    addAssignee: useMutation({
      mutationFn: (userId: string) => tasksApi.addAssignee(taskId, userId),
      onSettled,
      meta: { errorMessage: 'Could not assign' },
    }),
    removeAssignee: useMutation({
      mutationFn: (userId: string) => tasksApi.removeAssignee(taskId, userId),
      onSettled,
      meta: { errorMessage: 'Could not unassign' },
    }),
    addLabel: useMutation({
      mutationFn: (labelId: string) => tasksApi.addLabel(taskId, labelId),
      onSettled,
      meta: { errorMessage: 'Could not add the label' },
    }),
    removeLabel: useMutation({
      mutationFn: (labelId: string) => tasksApi.removeLabel(taskId, labelId),
      onSettled,
      meta: { errorMessage: 'Could not remove the label' },
    }),
  };
}

export function useAddComment(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (content: string) => commentsApi.create(taskId, content),
    onSettled: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.tasks.history(taskId) }),
      ]),
    meta: { errorMessage: 'Could not post the comment' },
  });
}

export function useDeleteComment(taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (commentId: string) => commentsApi.delete(taskId, commentId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId) }),
    meta: { errorMessage: 'Could not delete the comment' },
  });
}
