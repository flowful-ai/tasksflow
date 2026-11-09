/** Inbox notifications of the current user, and ⌘K search. */
import type { NotificationFilter } from '@flowtask/shared';
import { api, http, qs, type ApiEnvelope, type CursorMeta } from './http';
import type { NotificationDto, SearchResult } from './types';

export const notificationsApi = {
  list: (params: {
    workspaceId: string;
    filter?: NotificationFilter;
    cursor?: string | null;
    limit?: number;
  }): Promise<ApiEnvelope<NotificationDto[], CursorMeta>> =>
    api.get(`/api/notifications${qs(params)}`),
  unreadCount: async (workspaceId: string): Promise<number> =>
    (await http.get<{ count: number }>(`/api/notifications/unread-count${qs({ workspaceId })}`))
      .count,
  readAll: (workspaceId: string): Promise<{ updated: number }> =>
    http.post('/api/notifications/read-all', { workspaceId }),
  markRead: (id: string): Promise<NotificationDto> => http.post(`/api/notifications/${id}/read`),
  markUnread: (id: string): Promise<NotificationDto> =>
    http.post(`/api/notifications/${id}/unread`),
  archive: (id: string): Promise<NotificationDto> => http.post(`/api/notifications/${id}/archive`),
  unarchive: (id: string): Promise<NotificationDto> =>
    http.post(`/api/notifications/${id}/unarchive`),
  /** Hide until `until` (ISO date in the future); it comes back unread. */
  snooze: (id: string, until: string): Promise<NotificationDto> =>
    http.post(`/api/notifications/${id}/snooze`, { until }),
};

export const searchApi = {
  /** Tasks (full text; an exact key such as "TF-12" ranks first) and projects. */
  search: (
    workspaceId: string,
    q: string,
    limit?: number,
    signal?: AbortSignal
  ): Promise<SearchResult> => http.get(`/api/search${qs({ workspaceId, q, limit })}`, signal),
};
