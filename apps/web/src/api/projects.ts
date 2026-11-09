/** Projects, task states, labels and project access. */
import type { ProjectAccess, TaskStateCategory } from '@flowtask/shared';
import { http, qs } from './http';
import type { LabelDto, ProjectDetailDto, ProjectDto, ProjectMemberDto, ProjectPermissionsDto, TaskStateDto } from './types';

export interface CreateProjectInput {
  workspaceId: string;
  name: string;
  identifier: string;
  description?: string;
  icon?: string;
}

export interface UpdateProjectInput {
  name?: string;
  description?: string;
  icon?: string;
  isArchived?: boolean;
}

export const projectsApi = {
  list: (workspaceId: string, options: { includeArchived?: boolean } = {}): Promise<ProjectDto[]> =>
    http.get(`/api/projects${qs({ workspaceId, includeArchived: options.includeArchived || undefined })}`),
  get: (projectId: string): Promise<ProjectDetailDto> => http.get(`/api/projects/${projectId}`),
  create: (input: CreateProjectInput): Promise<ProjectDto> => http.post('/api/projects', input),
  update: (projectId: string, input: UpdateProjectInput): Promise<ProjectDto> =>
    http.patch(`/api/projects/${projectId}`, input),
  delete: (projectId: string): Promise<null> => http.delete(`/api/projects/${projectId}`),
  permissions: (projectId: string): Promise<ProjectPermissionsDto> => http.get(`/api/projects/${projectId}/permissions`),

  listStates: (projectId: string): Promise<TaskStateDto[]> => http.get(`/api/projects/${projectId}/states`),
  createState: (
    projectId: string,
    input: { name: string; category: TaskStateCategory; color?: string }
  ): Promise<TaskStateDto> => http.post(`/api/projects/${projectId}/states`, input),
  updateState: (projectId: string, stateId: string, input: { name?: string; color?: string }): Promise<TaskStateDto> =>
    http.patch(`/api/projects/${projectId}/states/${stateId}`, input),
  deleteState: (projectId: string, stateId: string): Promise<null> =>
    http.delete(`/api/projects/${projectId}/states/${stateId}`),

  createLabel: (projectId: string, input: { name: string; color?: string }): Promise<LabelDto> =>
    http.post(`/api/projects/${projectId}/labels`, input),
  updateLabel: (projectId: string, labelId: string, input: { name?: string; color?: string }): Promise<LabelDto> =>
    http.patch(`/api/projects/${projectId}/labels/${labelId}`, input),
  deleteLabel: (projectId: string, labelId: string): Promise<null> =>
    http.delete(`/api/projects/${projectId}/labels/${labelId}`),

  listMembers: (projectId: string): Promise<ProjectMemberDto[]> => http.get(`/api/projects/${projectId}/members`),
  setAccess: (projectId: string, access: ProjectAccess, userIds?: string[]): Promise<null> =>
    http.put(`/api/projects/${projectId}/members`, { access, userIds }),
};
