/** Tasks, comments, bulk operations, history, relations and the project trash. */
import type { BulkTaskOperation } from '@flowtask/shared';
import { api, http, qs, type ApiEnvelope, type CursorMeta, type PageMeta } from './http';
import type {
  AddTaskRelationInput,
  BulkTaskResponseDto,
  CommentDto,
  CreateTaskInput,
  MoveTaskInput,
  TaskDetailDto,
  TaskDto,
  TaskHistoryItemDto,
  TaskListFilters,
  TaskRelationDto,
  TrashMetaDto,
  UpdateTaskInput,
} from './types';

/** Page size used when loading every task of a project (the API maximum). */
export const TASK_PAGE_SIZE = 100;

export const tasksApi = {
  /** One page of a project's tasks, sorted by position. `meta.total` is the full count. */
  listPage: (
    projectId: string,
    page: number,
    filters: TaskListFilters = {},
    limit: number = TASK_PAGE_SIZE,
    signal?: AbortSignal
  ): Promise<ApiEnvelope<TaskDto[], PageMeta>> =>
    api.get(`/api/tasks${qs({ projectId, page, limit, ...filters })}`, signal),
  get: (taskId: string, options: { includeDeleted?: boolean } = {}): Promise<TaskDetailDto> =>
    http.get(`/api/tasks/${taskId}${qs({ includeDeleted: options.includeDeleted || undefined })}`),
  create: (input: CreateTaskInput): Promise<TaskDetailDto> => http.post('/api/tasks', input),
  update: (taskId: string, input: UpdateTaskInput): Promise<TaskDetailDto> => http.patch(`/api/tasks/${taskId}`, input),
  move: ({ taskId, ...body }: MoveTaskInput): Promise<TaskDetailDto> => http.post(`/api/tasks/${taskId}/move`, body),
  /** Soft delete (restorable from the trash). */
  delete: (taskId: string): Promise<null> => http.delete(`/api/tasks/${taskId}`),
  addAssignee: (taskId: string, userId: string): Promise<null> => http.post(`/api/tasks/${taskId}/assignees`, { userId }),
  removeAssignee: (taskId: string, userId: string): Promise<null> =>
    http.delete(`/api/tasks/${taskId}/assignees/${userId}`),
  addLabel: (taskId: string, labelId: string): Promise<null> => http.post(`/api/tasks/${taskId}/labels`, { labelId }),
  removeLabel: (taskId: string, labelId: string): Promise<null> => http.delete(`/api/tasks/${taskId}/labels/${labelId}`),
  /** One request for up to 200 tasks in one workspace. */
  bulk: (taskIds: string[], op: BulkTaskOperation): Promise<BulkTaskResponseDto> =>
    http.post('/api/tasks/bulk', { taskIds, op }),

  history: (
    taskId: string,
    params: { cursor?: string | null; limit?: number } = {}
  ): Promise<ApiEnvelope<TaskHistoryItemDto[], CursorMeta>> => api.get(`/api/tasks/${taskId}/history${qs(params)}`),

  listRelations: (taskId: string): Promise<TaskRelationDto[]> => http.get(`/api/tasks/${taskId}/relations`),
  addRelation: (taskId: string, input: AddTaskRelationInput): Promise<TaskRelationDto> =>
    http.post(`/api/tasks/${taskId}/relations`, input),
  removeRelation: (taskId: string, relationId: string): Promise<null> =>
    http.delete(`/api/tasks/${taskId}/relations/${relationId}`),

  createGitHubIssue: (taskId: string, repo: { owner: string; repo: string }): Promise<{ url: string; number: number }> =>
    http.post(`/api/tasks/${taskId}/github-issue`, repo),
  linkGitHubPr: (
    taskId: string,
    payload: { owner: string; repo: string; prNumber: number }
  ): Promise<{ url: string; number: number }> => http.post(`/api/tasks/${taskId}/github-pr`, payload),
};

export const commentsApi = {
  list: (taskId: string): Promise<CommentDto[]> => http.get(`/api/tasks/${taskId}/comments${qs({ limit: 100 })}`),
  create: (taskId: string, content: string): Promise<CommentDto> =>
    http.post(`/api/tasks/${taskId}/comments`, { content }),
  update: (taskId: string, commentId: string, content: string): Promise<CommentDto> =>
    http.patch(`/api/tasks/${taskId}/comments/${commentId}`, { content }),
  delete: (taskId: string, commentId: string): Promise<null> =>
    http.delete(`/api/tasks/${taskId}/comments/${commentId}`),
};

export const trashApi = {
  list: (
    projectId: string,
    params: { page?: number; limit?: number } = {}
  ): Promise<ApiEnvelope<TaskDto[], TrashMetaDto>> => api.get(`/api/projects/${projectId}/trash${qs(params)}`),
  /** Restore a soft-deleted task (used by the delete undo toast). */
  restore: (projectId: string, taskId: string): Promise<TaskDetailDto> =>
    http.post(`/api/projects/${projectId}/trash/${taskId}/restore`),
};
