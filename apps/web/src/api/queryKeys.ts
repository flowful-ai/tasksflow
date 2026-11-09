/**
 * Query key factory: the single source of every TanStack Query key.
 *
 * Keys are hierarchical, so a prefix invalidates everything below it:
 *   queryClient.invalidateQueries({ queryKey: queryKeys.tasks.lists() })      // every task list
 *   queryClient.invalidateQueries({ queryKey: queryKeys.tasks.project(id) }) // one project's lists
 *
 * Never write a literal key in a component; add an entry here instead.
 */
import type { NotificationFilter } from '@flowtask/shared';
import type { TaskListFilters } from './types';

/** Drop undefined/empty filter values so `{}` and `{ assigneeId: undefined }` share a cache entry. */
export function normalizeFilters(filters: TaskListFilters = {}): TaskListFilters {
  const normalized: TaskListFilters = {};
  if (filters.assigneeId) normalized.assigneeId = filters.assigneeId;
  if (filters.labelId) normalized.labelId = filters.labelId;
  if (filters.parentId) normalized.parentId = filters.parentId;
  if (filters.priority) normalized.priority = filters.priority;
  if (filters.search?.trim()) normalized.search = filters.search.trim();
  if (filters.stateId) normalized.stateId = filters.stateId;
  return normalized;
}

export function hasActiveFilters(filters: TaskListFilters): boolean {
  return Object.keys(normalizeFilters(filters)).length > 0;
}

export const queryKeys = {
  auth: {
    session: () => ['auth', 'session'] as const,
    linkedAccounts: () => ['auth', 'linked-accounts'] as const,
  },

  app: {
    all: ['app'] as const,
    me: () => ['app', 'me'] as const,
    users: (params: { search?: string; limit?: number; offset?: number }) =>
      ['app', 'users', params] as const,
  },

  workspaces: {
    all: ['workspaces'] as const,
    list: () => ['workspaces', 'list'] as const,
    detail: (workspaceId: string) => ['workspaces', 'detail', workspaceId] as const,
    role: (workspaceId: string) => ['workspaces', 'role', workspaceId] as const,
    members: (workspaceId: string) => ['workspaces', 'members', workspaceId] as const,
    /** Activity feeds of every workspace. */
    activities: () => ['workspaces', 'activity'] as const,
    activity: (workspaceId: string) => ['workspaces', 'activity', workspaceId] as const,
    invitations: (workspaceId: string) => ['workspaces', 'invitations', workspaceId] as const,
    apiKeys: (workspaceId: string) => ['workspaces', 'api-keys', workspaceId] as const,
    aiSettings: (workspaceId: string) => ['workspaces', 'ai-settings', workspaceId] as const,
    mcpConnections: (workspaceId: string) =>
      ['workspaces', 'mcp-connections', workspaceId] as const,
    /** Every `active` variant of a workspace's agent list. */
    agentLists: (workspaceId: string) => ['workspaces', 'agents', workspaceId] as const,
    agents: (workspaceId: string, active: boolean | 'all' = 'all') =>
      ['workspaces', 'agents', workspaceId, active] as const,
    agentAvailability: (workspaceId: string) =>
      ['workspaces', 'agent-availability', workspaceId] as const,
    webhooks: (workspaceId: string) => ['workspaces', 'webhooks', workspaceId] as const,
    /** Dashboard task statistics across the given projects. */
    taskStats: (workspaceId: string, projectIds: readonly string[]) =>
      ['workspaces', 'task-stats', workspaceId, [...projectIds].sort()] as const,
  },

  invitations: {
    byToken: (token: string) => ['invitations', 'token', token] as const,
  },

  projects: {
    all: ['projects'] as const,
    lists: () => ['projects', 'list'] as const,
    list: (workspaceId: string) => ['projects', 'list', workspaceId] as const,
    /** Project with taskStates and labels: also the source of useProjectStates/useProjectLabels. */
    detail: (projectId: string) => ['projects', 'detail', projectId] as const,
    permissions: (projectId: string) => ['projects', 'permissions', projectId] as const,
    members: (projectId: string) => ['projects', 'members', projectId] as const,
    /** Every page of one project's trash. */
    trashAll: (projectId: string) => ['projects', 'trash', projectId] as const,
    trash: (projectId: string, page: number = 1) => ['projects', 'trash', projectId, page] as const,
    github: (projectId: string) => ['projects', 'github', projectId] as const,
    slack: (projectId: string) => ['projects', 'slack', projectId] as const,
    slackChannels: (projectId: string) => ['projects', 'slack-channels', projectId] as const,
  },

  tasks: {
    all: ['tasks'] as const,
    /** Every task list of every project. */
    lists: () => ['tasks', 'list'] as const,
    /** Every task list of one project (any filters). */
    project: (projectId: string) => ['tasks', 'list', projectId] as const,
    /** One project's task list for a filter set (infinite query, all pages). */
    list: (projectId: string, filters: TaskListFilters = {}) =>
      ['tasks', 'list', projectId, normalizeFilters(filters)] as const,
    details: () => ['tasks', 'detail'] as const,
    detail: (taskId: string) => ['tasks', 'detail', taskId] as const,
    comments: (taskId: string) => ['tasks', 'comments', taskId] as const,
    history: (taskId: string) => ['tasks', 'history', taskId] as const,
    relations: (taskId: string) => ['tasks', 'relations', taskId] as const,
  },

  smartViews: {
    all: ['smart-views'] as const,
    list: (workspaceId: string) => ['smart-views', 'list', workspaceId] as const,
    detail: (viewId: string) => ['smart-views', 'detail', viewId] as const,
    /** Every executed smart view (task results). */
    executions: () => ['smart-views', 'execute'] as const,
    execute: (viewId: string) => ['smart-views', 'execute', viewId] as const,
  },

  publicShares: {
    byToken: (token: string) => ['public-share', token] as const,
  },

  notifications: {
    all: ['notifications'] as const,
    lists: () => ['notifications', 'list'] as const,
    list: (workspaceId: string, filter: NotificationFilter = 'inbox') =>
      ['notifications', 'list', workspaceId, filter] as const,
    unreadCount: (workspaceId: string) => ['notifications', 'unread-count', workspaceId] as const,
  },

  search: {
    all: ['search'] as const,
    query: (workspaceId: string, q: string) =>
      ['search', workspaceId, q.trim().toLowerCase()] as const,
  },

  github: {
    installations: () => ['github', 'installations'] as const,
    repos: (installationId: number) => ['github', 'repos', installationId] as const,
  },

  webhooks: {
    deliveries: (webhookId: string) => ['webhooks', 'deliveries', webhookId] as const,
  },
} as const;
