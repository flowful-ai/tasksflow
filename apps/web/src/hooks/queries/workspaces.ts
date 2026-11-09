import { useEffect } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { memberApi, workspacesApi } from '../../api/workspaces';
import type { WorkspaceDetailDto, WorkspaceDto } from '../../api/types';
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
