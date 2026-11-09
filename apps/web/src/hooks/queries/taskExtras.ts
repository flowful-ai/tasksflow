/** Task history, relations and the project trash. */
import { useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { tasksApi, trashApi } from '../../api/tasks';
import type { AddTaskRelationInput, TaskHistoryItemDto } from '../../api/types';
import { upsertTaskEverywhere } from './cacheUpdates';
import { invalidateAfterTaskChange } from './tasks';
import { FIRST_CURSOR } from './workspaces';

/**
 * Activity timeline of a task, newest first. `items` is flattened; call
 * `fetchNextPage()` while `hasNextPage` for older entries.
 */
export function useTaskHistory(taskId: string | null | undefined, limit = 50) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.tasks.history(taskId ?? ''),
    queryFn: ({ pageParam }) => tasksApi.history(taskId ?? '', { cursor: pageParam, limit }),
    initialPageParam: FIRST_CURSOR,
    getNextPageParam: (last) => last.meta?.nextCursor ?? null,
    enabled: Boolean(taskId),
  });
  const items = useMemo<TaskHistoryItemDto[]>(() => query.data?.pages.flatMap((p) => p.data) ?? [], [query.data]);
  return { ...query, items };
}

/** Blocks / relates / duplicates relations of a task. */
export function useTaskRelations(taskId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.tasks.relations(taskId ?? ''),
    queryFn: () => tasksApi.listRelations(taskId ?? ''),
    enabled: Boolean(taskId),
  });
}

export function useTaskRelationMutations(taskId: string) {
  const queryClient = useQueryClient();
  const onSettled = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.relations(taskId) }),
      // blocks/blockedBy live on the detail; the other side's detail changes too.
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.details() }),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.history(taskId) }),
    ]);
  return {
    add: useMutation({
      mutationFn: (input: AddTaskRelationInput) => tasksApi.addRelation(taskId, input),
      onSettled,
      meta: { errorMessage: 'Could not add the relation' },
    }),
    remove: useMutation({
      mutationFn: (relationId: string) => tasksApi.removeRelation(taskId, relationId),
      onSettled,
      meta: { errorMessage: 'Could not remove the relation' },
    }),
  };
}

/** One page of a project's trash (newest deletion first); `meta.retentionDays` says how long items stay. */
export function useTrash(projectId: string | null | undefined, page = 1, limit = 50) {
  return useQuery({
    queryKey: queryKeys.projects.trash(projectId ?? '', page),
    queryFn: () => trashApi.list(projectId ?? '', { page, limit }),
    enabled: Boolean(projectId),
    placeholderData: keepPreviousData,
  });
}

export function useRestoreTask() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ projectId, taskId }: { projectId: string; taskId: string }) => trashApi.restore(projectId, taskId),
    onSuccess: (task) => upsertTaskEverywhere(queryClient, task, { created: true }),
    onSettled: (_task, _error, { projectId, taskId }) =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.trashAll(projectId) }),
        invalidateAfterTaskChange(queryClient, { id: taskId, projectId }),
      ]),
    meta: { errorMessage: 'Could not restore the task' },
  });
}
