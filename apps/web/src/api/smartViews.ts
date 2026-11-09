/** Smart views, their execution and public shares. */
import type { CreateSmartView, UpdateSmartView } from '@flowtask/shared';
import { http, qs } from './http';
import type { CreatePublicShareInput, PublicShareDto, SmartViewDto, SmartViewExecuteDto } from './types';

/** Page size used when loading every task of a smart view (the API maximum). */
export const SMART_VIEW_PAGE_SIZE = 100;

export const smartViewsApi = {
  list: (workspaceId: string): Promise<SmartViewDto[]> => http.get(`/api/smart-views${qs({ workspaceId })}`),
  get: (viewId: string): Promise<SmartViewDto> => http.get(`/api/smart-views/${viewId}`),
  create: (input: CreateSmartView & { workspaceId: string }): Promise<SmartViewDto> =>
    http.post('/api/smart-views', input),
  update: (viewId: string, input: UpdateSmartView): Promise<SmartViewDto> =>
    http.patch(`/api/smart-views/${viewId}`, input),
  delete: (viewId: string): Promise<null> => http.delete(`/api/smart-views/${viewId}`),
  /** One page of the view's tasks plus the view itself; `meta.total` is the full count. */
  execute: (viewId: string, page: number, limit: number = SMART_VIEW_PAGE_SIZE, signal?: AbortSignal): Promise<SmartViewExecuteDto> =>
    http.get(`/api/smart-views/${viewId}/execute${qs({ page, limit })}`, signal),

  createPublicShare: (viewId: string, input: CreatePublicShareInput): Promise<PublicShareDto> =>
    http.post(`/api/smart-views/${viewId}/public`, input),
  disablePublicShare: (viewId: string, shareId: string): Promise<PublicShareDto> =>
    http.post(`/api/smart-views/${viewId}/public/${shareId}/disable`),
  deletePublicShare: (viewId: string, shareId: string): Promise<null> =>
    http.delete(`/api/smart-views/${viewId}/public/${shareId}`),
};

/** A task on a public share page (only the fields the share exposes). */
export interface PublicTaskDto {
  id: string;
  title: string;
  priority: string | null;
  dueDate: string | null;
  sequenceNumber: number;
  state: { id: string; name: string; color: string | null; category?: string } | null;
  assignees: { id: string; name: string | null; email: string }[];
  labels: { id: string; name: string; color: string | null }[];
  project: { id: string; identifier: string; name: string };
  description: string | null;
  stateId: string | null;
  /** Present only when the share was created with `showExternalLinks`. */
  externalLinks?: { id: string; externalType: 'github_issue' | 'github_pr'; externalId: string; externalUrl: string }[];
  createdAt: string;
  updatedAt: string | null;
}

export interface PublicShareViewDto {
  name: string;
  displayType: 'kanban' | 'list' | 'table' | 'calendar';
  groupBy?: 'state' | 'assignee' | 'project' | 'priority' | 'label' | 'none';
  secondaryGroupBy?: 'state' | 'assignee' | 'project' | 'priority' | 'label' | 'none' | null;
}

export interface PublicShareDataDto {
  requiresPassword?: boolean;
  view?: PublicShareViewDto;
  tasks?: PublicTaskDto[];
}

/** Unauthenticated share page endpoints. */
export const publicShareApi = {
  get: (token: string): Promise<PublicShareDataDto> => http.get(`/api/public/share/${token}`),
  verify: (token: string, password: string): Promise<PublicShareDataDto> =>
    http.post(`/api/public/share/${token}/verify`, { password }),
};
