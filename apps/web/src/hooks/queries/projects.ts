import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query';
import type { ProjectAccess, TaskStateCategory } from '@flowtask/shared';
import { queryKeys } from '../../api/queryKeys';
import { projectsApi, type CreateProjectInput, type UpdateProjectInput } from '../../api/projects';
import type { LabelDto, ProjectDetailDto, ProjectDto, TaskStateDto } from '../../api/types';
import { useWorkspaceStore } from '../../stores/workspace';
import { useCurrentWorkspace } from './workspaces';

/** Projects of a workspace (filtered by the project ACL), with states, labels and taskCount. */
export function useProjects(workspaceId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.list(workspaceId ?? ''),
    queryFn: () => projectsApi.list(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
  });
}

/** Projects of the current workspace. */
export function useCurrentProjects() {
  const { workspaceId } = useCurrentWorkspace();
  return useProjects(workspaceId);
}

/** One project with its task states and labels. Seeded from the list cache when available. */
export function useProject(projectId: string | null | undefined) {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId ?? ''),
    queryFn: () => projectsApi.get(projectId ?? ''),
    enabled: Boolean(projectId),
    initialData: () =>
      findProjectInLists(
        queryClient.getQueriesData<ProjectDto[]>({ queryKey: queryKeys.projects.lists() }),
        projectId
      ),
    // Show the list copy immediately, but refetch the detail in the background.
    initialDataUpdatedAt: 0,
  });
}

function findProjectInLists(
  entries: Array<[QueryKey, ProjectDto[] | undefined]>,
  projectId: string | null | undefined
): ProjectDetailDto | undefined {
  if (!projectId) return undefined;
  for (const [, list] of entries) {
    const found = list?.find((p) => p.id === projectId);
    if (found) return found;
  }
  return undefined;
}

const sortStates = (states: TaskStateDto[]): TaskStateDto[] =>
  [...states].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0));

/** Task states (board columns) of a project, in position order. Shares the project query. */
export function useProjectStates(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId ?? ''),
    queryFn: () => projectsApi.get(projectId ?? ''),
    enabled: Boolean(projectId),
    select: (project: ProjectDetailDto) => sortStates(project.taskStates),
  });
}

/** Labels of a project. Shares the project query. */
export function useProjectLabels(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.detail(projectId ?? ''),
    queryFn: () => projectsApi.get(projectId ?? ''),
    enabled: Boolean(projectId),
    select: (project: ProjectDetailDto): LabelDto[] => project.labels,
  });
}

/** Several projects at once (smart views spanning projects). */
export function useProjectsById(projectIds: readonly string[]) {
  return useQueries({
    queries: projectIds.map((projectId) => ({
      queryKey: queryKeys.projects.detail(projectId),
      queryFn: () => projectsApi.get(projectId),
    })),
    combine: (results) => ({
      projects: results.flatMap((r) => (r.data ? [r.data] : [])),
      isLoading: results.some((r) => r.isLoading),
    }),
  });
}

export function useProjectPermissions(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.permissions(projectId ?? ''),
    queryFn: () => projectsApi.permissions(projectId ?? ''),
    enabled: Boolean(projectId),
  });
}

export function useProjectMembers(projectId: string | null | undefined) {
  return useQuery({
    queryKey: queryKeys.projects.members(projectId ?? ''),
    queryFn: () => projectsApi.listMembers(projectId ?? ''),
    enabled: Boolean(projectId),
  });
}

// ============ Mutations ============

function useInvalidateProject() {
  const queryClient = useQueryClient();
  return (projectId?: string) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.projects.lists() }),
      projectId
        ? queryClient.invalidateQueries({ queryKey: queryKeys.projects.detail(projectId) })
        : undefined,
    ]);
}

export function useCreateProject() {
  const invalidate = useInvalidateProject();
  const setProjectId = useWorkspaceStore((s) => s.setCurrentProjectId);
  return useMutation({
    mutationFn: (input: CreateProjectInput) => projectsApi.create(input),
    onSuccess: (project) => {
      setProjectId(project.id);
      return invalidate();
    },
    meta: { errorMessage: 'Could not create the project' },
  });
}

export function useUpdateProject(projectId: string) {
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (input: UpdateProjectInput) => projectsApi.update(projectId, input),
    onSettled: () => invalidate(projectId),
    meta: { errorMessage: 'Could not update the project' },
  });
}

export function useDeleteProject() {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: (projectId: string) => projectsApi.delete(projectId),
    onSuccess: (_data, projectId) => {
      queryClient.removeQueries({ queryKey: queryKeys.projects.detail(projectId) });
      queryClient.removeQueries({ queryKey: queryKeys.tasks.project(projectId) });
      return invalidate();
    },
    meta: { errorMessage: 'Could not delete the project' },
  });
}

export function useSetProjectAccess(projectId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProject();
  return useMutation({
    mutationFn: ({ access, userIds }: { access: ProjectAccess; userIds?: string[] }) =>
      projectsApi.setAccess(projectId, access, userIds),
    onSettled: () =>
      Promise.all([
        invalidate(projectId),
        queryClient.invalidateQueries({ queryKey: queryKeys.projects.members(projectId) }),
      ]),
    meta: { errorMessage: 'Could not update access' },
  });
}

/** Create/update/delete task states. All invalidate the project (states live on it). */
export function useTaskStateMutations(projectId: string) {
  const invalidate = useInvalidateProject();
  const onSettled = () => invalidate(projectId);
  return {
    create: useMutation({
      mutationFn: (input: { name: string; category: TaskStateCategory; color?: string }) =>
        projectsApi.createState(projectId, input),
      onSettled,
      meta: { errorMessage: 'Could not create the state' },
    }),
    update: useMutation({
      mutationFn: ({ stateId, ...input }: { stateId: string; name?: string; color?: string }) =>
        projectsApi.updateState(projectId, stateId, input),
      onSettled,
      meta: { errorMessage: 'Could not update the state' },
    }),
    remove: useMutation({
      mutationFn: (stateId: string) => projectsApi.deleteState(projectId, stateId),
      onSettled,
      meta: { errorMessage: 'Could not delete the state' },
    }),
  };
}

/** Create/update/delete labels. */
export function useLabelMutations(projectId: string) {
  const queryClient = useQueryClient();
  const invalidate = useInvalidateProject();
  const onSettled = () =>
    Promise.all([
      invalidate(projectId),
      queryClient.invalidateQueries({ queryKey: queryKeys.tasks.project(projectId) }),
    ]);
  return {
    create: useMutation({
      mutationFn: (input: { name: string; color?: string }) =>
        projectsApi.createLabel(projectId, input),
      onSettled,
      meta: { errorMessage: 'Could not create the label' },
    }),
    update: useMutation({
      mutationFn: ({ labelId, ...input }: { labelId: string; name?: string; color?: string }) =>
        projectsApi.updateLabel(projectId, labelId, input),
      onSettled,
      meta: { errorMessage: 'Could not update the label' },
    }),
    remove: useMutation({
      mutationFn: (labelId: string) => projectsApi.deleteLabel(projectId, labelId),
      onSettled,
      meta: { errorMessage: 'Could not delete the label' },
    }),
  };
}
