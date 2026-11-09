import { useEffect, useMemo } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateSmartView, UpdateSmartView } from '@flowtask/shared';
import { queryKeys } from '../../api/queryKeys';
import { SMART_VIEW_PAGE_SIZE, publicShareApi, smartViewsApi } from '../../api/smartViews';
import type { CreatePublicShareInput, SmartViewExecuteDto } from '../../api/types';
import { flattenPages, smartViewAdapter } from './taskCache';

export function useSmartViews(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.smartViews.list(workspaceId ?? ''),
    queryFn: () => smartViewsApi.list(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

export function useSmartView(viewId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.smartViews.detail(viewId ?? ''),
    queryFn: () => smartViewsApi.get(viewId ?? ''),
    enabled: Boolean(viewId),
  });
}

/**
 * Execute a smart view and load ALL its pages. Returns the view, the tasks,
 * the server `total` and `isComplete`.
 */
export function useSmartViewTasks(viewId: string | null | undefined) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.smartViews.execute(viewId ?? ''),
    queryFn: ({ pageParam, signal }) => smartViewsApi.execute(viewId ?? '', pageParam, SMART_VIEW_PAGE_SIZE, signal),
    initialPageParam: 1,
    getNextPageParam: (last: SmartViewExecuteDto, pages: SmartViewExecuteDto[]) => {
      const loaded = pages.reduce((sum, page) => sum + page.tasks.length, 0);
      return last.tasks.length > 0 && loaded < last.meta.total ? pages.length + 1 : undefined;
    },
    enabled: Boolean(viewId),
    placeholderData: keepPreviousData,
  });

  const { hasNextPage, isFetchingNextPage, isError, fetchNextPage } = query;
  useEffect(() => {
    if (hasNextPage && !isFetchingNextPage && !isError) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, isError, fetchNextPage]);

  const tasks = useMemo(() => flattenPages(query.data, smartViewAdapter), [query.data]);
  const view = query.data?.pages[0]?.view;
  const total = query.data?.pages[0]?.meta.total ?? tasks.length;
  return { ...query, view, tasks, total, isComplete: !hasNextPage && !query.isLoading };
}

function useInvalidateViews() {
  const queryClient = useQueryClient();
  return (viewId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.smartViews.all, exact: false, refetchType: 'active' }),
      viewId ? queryClient.invalidateQueries({ queryKey: queryKeys.smartViews.execute(viewId) }) : undefined,
    ]);
}

export function useCreateSmartView() {
  const invalidate = useInvalidateViews();
  return useMutation({
    mutationFn: (input: CreateSmartView & { workspaceId: string }) => smartViewsApi.create(input),
    onSettled: () => invalidate(),
    meta: { errorMessage: 'Could not create the view' },
  });
}

export function useUpdateSmartView(viewId: string) {
  const invalidate = useInvalidateViews();
  return useMutation({
    mutationFn: (input: UpdateSmartView) => smartViewsApi.update(viewId, input),
    onSettled: () => invalidate(viewId),
    meta: { errorMessage: 'Could not save the view' },
  });
}

export function useDeleteSmartView() {
  const invalidate = useInvalidateViews();
  return useMutation({
    mutationFn: (viewId: string) => smartViewsApi.delete(viewId),
    onSettled: () => invalidate(),
    meta: { errorMessage: 'Could not delete the view' },
  });
}

/** Create / disable / delete public share links of a view. */
export function usePublicShareMutations(viewId: string) {
  const invalidate = useInvalidateViews();
  const onSettled = () => invalidate(viewId);
  return {
    create: useMutation({
      mutationFn: (input: CreatePublicShareInput) => smartViewsApi.createPublicShare(viewId, input),
      onSettled,
      meta: { errorMessage: 'Could not create the share link' },
    }),
    disable: useMutation({
      mutationFn: (shareId: string) => smartViewsApi.disablePublicShare(viewId, shareId),
      onSettled,
      meta: { errorMessage: 'Could not disable the share link' },
    }),
    remove: useMutation({
      mutationFn: (shareId: string) => smartViewsApi.deletePublicShare(viewId, shareId),
      onSettled,
      meta: { errorMessage: 'Could not delete the share link' },
    }),
  };
}

/** Public share page data (unauthenticated). */
export function usePublicShare(token: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.publicShares.byToken(token ?? ''),
    queryFn: () => publicShareApi.get(token ?? ''),
    enabled: Boolean(token),
    retry: false,
  });
}
