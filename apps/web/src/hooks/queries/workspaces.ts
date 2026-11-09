import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { memberApi, workspacesApi } from '../../api/workspaces';
import type { ProjectDto, WorkspaceDetailDto, WorkspaceDto } from '../../api/types';
import { nextWorkspaceId } from '../../lib/account';
import { useWorkspaceStore } from '../../stores/workspace';

/** Cursor of the first page of a cursor-paginated list. */
export const FIRST_CURSOR: string | null = null;

/** Workspaces the current user belongs to. */
export function useWorkspaces() {
  return useQuery({
    queryKey: queryKeys.workspaces.list(),
    queryFn: workspacesApi.list,
    staleTime: 5 * 60_000,
  });
}

/**
 * The selected workspace (persisted id), falling back to the first one. Also
 * repairs a stale persisted id (e.g. after leaving a workspace).
 */
export function useCurrentWorkspace(): {
  workspace: WorkspaceDetailDto | null;
  workspaceId: string | null;
  workspaces: WorkspaceDetailDto[];
  isLoading: boolean;
  error: Error | null;
  setWorkspaceId: (id: string) => void;
} {
  const { data: workspaces, isLoading, error } = useWorkspaces();
  const storedId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const setWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);

  const list = workspaces ?? [];
  const workspace = list.find((w) => w.id === storedId) ?? list[0] ?? null;

  useEffect(() => {
    if (workspaces && workspace && workspace.id !== storedId) setWorkspaceId(workspace.id);
  }, [workspaces, workspace, storedId, setWorkspaceId]);

  return {
    workspace,
    // Use the stored id while the list loads so dependent queries start immediately.
    workspaceId: workspace?.id ?? (workspaces ? null : storedId),
    workspaces: list,
    isLoading,
    error,
    setWorkspaceId,
  };
}

/** Workspace with members (GET /api/workspaces/:id). */
export function useWorkspace(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.workspaces.detail(workspaceId ?? ''),
    queryFn: () => workspacesApi.get(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

/** The caller's role in the workspace. */
export function useWorkspaceRole(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.workspaces.role(workspaceId ?? ''),
    queryFn: async () => (await workspacesApi.me(workspaceId ?? '')).role,
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
  });
}

export function useWorkspaceMembers(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.workspaces.members(workspaceId ?? ''),
    queryFn: () => memberApi.list(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

/** Recent activity, newest first, paginated by cursor (call fetchNextPage for more). */
export function useWorkspaceActivity(workspaceId: string | null | undefined, limit = 20) {
  return useInfiniteQuery({
    queryKey: queryKeys.workspaces.activity(workspaceId ?? ''),
    queryFn: ({ pageParam }) =>
      workspacesApi.activity(workspaceId ?? '', { limit, cursor: pageParam }),
    initialPageParam: FIRST_CURSOR,
    getNextPageParam: (last) => last.meta?.nextCursor ?? null,
    enabled: Boolean(workspaceId),
  });
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient();
  const setWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  return useMutation({
    mutationFn: workspacesApi.create,
    onSuccess: (workspace: WorkspaceDto) => {
      setWorkspaceId(workspace.id);
      return queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.list() });
    },
    meta: { errorMessage: 'Could not create the workspace' },
  });
}

function useInvalidateMembers(workspaceId: string) {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.members(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.detail(workspaceId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.role(workspaceId) }),
    ]);
}

export function useUpdateMemberRole(workspaceId: string) {
  const invalidate = useInvalidateMembers(workspaceId);
  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: 'admin' | 'member' }) =>
      memberApi.updateRole(workspaceId, userId, role),
    onSettled: invalidate,
    meta: { errorMessage: 'Could not change the role' },
  });
}

export function useRemoveMember(workspaceId: string) {
  const invalidate = useInvalidateMembers(workspaceId);
  return useMutation({
    mutationFn: (userId: string) => memberApi.remove(workspaceId, userId),
    onSettled: invalidate,
    meta: { errorMessage: 'Could not remove the member' },
  });
}

/** Owner only: make `userId` the owner; the caller becomes an admin. */
export function useTransferOwnership(workspaceId: string) {
  const invalidate = useInvalidateMembers(workspaceId);
  return useMutation({
    mutationFn: (userId: string) => workspacesApi.transferOwnership(workspaceId, userId),
    onSettled: invalidate,
    meta: { errorMessage: 'Could not transfer ownership' },
  });
}

/** Owner or admin: rename the workspace. */
export function useUpdateWorkspace(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { name: string }) => workspacesApi.update(workspaceId, input),
    onSuccess: (workspace) => {
      queryClient.setQueryData<WorkspaceDetailDto[]>(queryKeys.workspaces.list(), (list) =>
        list?.map((w) => (w.id === workspace.id ? { ...w, ...workspace } : w))
      );
      queryClient.setQueryData(queryKeys.workspaces.detail(workspaceId), workspace);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.list() }),
    // The form shows the error inline.
    meta: { silentError: true },
  });
}

/**
 * After leaving or deleting a workspace: drop it from the list, select another
 * one (or none) and forget every cached query of the workspace and its
 * projects. Resolves to the workspace now selected.
 */
function useForgetWorkspace() {
  const queryClient = useQueryClient();
  const setWorkspaceId = useWorkspaceStore((s) => s.setCurrentWorkspaceId);
  return async (workspaceId: string): Promise<string | null> => {
    const list = queryClient.getQueryData<WorkspaceDetailDto[]>(queryKeys.workspaces.list()) ?? [];
    const next = nextWorkspaceId(list, workspaceId);
    const projectIds = (
      queryClient.getQueryData<ProjectDto[]>(queryKeys.projects.list(workspaceId)) ?? []
    ).map((p) => p.id);
    const gone = new Set<string>([workspaceId, ...projectIds]);

    queryClient.setQueryData<WorkspaceDetailDto[]>(queryKeys.workspaces.list(), (current) =>
      current?.filter((w) => w.id !== workspaceId)
    );
    setWorkspaceId(next);
    queryClient.removeQueries({
      predicate: (query) =>
        query.queryKey.some((part) => typeof part === 'string' && gone.has(part)),
    });
    await queryClient.invalidateQueries({ queryKey: queryKeys.workspaces.list() });
    return next;
  };
}

/** Owner only. Resolves to the workspace selected afterwards (null when none is left). */
export function useDeleteWorkspace() {
  const forget = useForgetWorkspace();
  return useMutation({
    mutationFn: async (workspaceId: string) => {
      await workspacesApi.delete(workspaceId);
      return forget(workspaceId);
    },
    // The confirm dialog shows the error inline.
    meta: { silentError: true },
  });
}

/** Leave the workspace (remove yourself). The last owner gets a 409. */
export function useLeaveWorkspace() {
  const forget = useForgetWorkspace();
  return useMutation({
    mutationFn: async ({ workspaceId, userId }: { workspaceId: string; userId: string }) => {
      await memberApi.remove(workspaceId, userId);
      return forget(workspaceId);
    },
    meta: { silentError: true },
  });
}
