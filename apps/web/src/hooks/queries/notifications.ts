/** Inbox notifications and ⌘K search. */
import { useMemo } from 'react';
import {
  keepPreviousData,
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { NotificationFilter } from '@flowtask/shared';
import { queryKeys } from '../../api/queryKeys';
import { notificationsApi, searchApi } from '../../api/notifications';
import type { NotificationDto } from '../../api/types';
import { FIRST_CURSOR } from './workspaces';

/** Notifications of the current user in a workspace (newest first, cursor pages). */
export function useNotifications(
  workspaceId: string | null | undefined,
  filter: NotificationFilter = 'inbox',
  limit = 30
) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.notifications.list(workspaceId ?? '', filter),
    queryFn: ({ pageParam }) =>
      notificationsApi.list({ workspaceId: workspaceId ?? '', filter, cursor: pageParam, limit }),
    initialPageParam: FIRST_CURSOR,
    getNextPageParam: (last) => last.meta?.nextCursor ?? null,
    enabled: Boolean(workspaceId),
    placeholderData: keepPreviousData,
  });
  const notifications = useMemo<NotificationDto[]>(
    () => query.data?.pages.flatMap((p) => p.data) ?? [],
    [query.data]
  );
  return { ...query, notifications };
}

/** Unread badge count. Refreshed by `notification:*` realtime events. */
export function useUnreadNotificationCount(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.notifications.unreadCount(workspaceId ?? ''),
    queryFn: () => notificationsApi.unreadCount(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
    staleTime: 30_000,
  });
}

/**
 * Per-notification actions: read, unread, archive, unarchive, snooze, readAll.
 * Every action refreshes the lists and the unread count.
 */
export function useNotificationActions(workspaceId: string) {
  const queryClient = useQueryClient();
  const onSettled = () => queryClient.invalidateQueries({ queryKey: queryKeys.notifications.all });
  const meta = { errorMessage: 'Could not update the notification' };
  return {
    markRead: useMutation({ mutationFn: notificationsApi.markRead, onSettled, meta }),
    markUnread: useMutation({ mutationFn: notificationsApi.markUnread, onSettled, meta }),
    archive: useMutation({ mutationFn: notificationsApi.archive, onSettled, meta }),
    unarchive: useMutation({ mutationFn: notificationsApi.unarchive, onSettled, meta }),
    snooze: useMutation({
      mutationFn: ({ id, until }: { id: string; until: string }) =>
        notificationsApi.snooze(id, until),
      onSettled,
      meta,
    }),
    readAll: useMutation({
      mutationFn: () => notificationsApi.readAll(workspaceId),
      onSettled,
      meta,
    }),
  };
}

/**
 * Search tasks and projects. Disabled for an empty query; keeps the previous
 * results while typing. Debounce `q` in the caller (≈150 ms).
 */
export function useSearch(workspaceId: string | null | undefined, q: string, limit = 10) {
  const trimmed = q.trim();
  return useQuery({
    queryKey: queryKeys.search.query(workspaceId ?? '', trimmed),
    queryFn: ({ signal }) => searchApi.search(workspaceId ?? '', trimmed, limit, signal),
    enabled: Boolean(workspaceId) && trimmed.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
