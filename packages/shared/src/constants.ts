/**
 * Application-wide constants.
 */

// Task priorities with display metadata
export const TASK_PRIORITIES = {
  urgent: { label: 'Urgent', color: '#ef4444', order: 0 },
  high: { label: 'High', color: '#f97316', order: 1 },
  medium: { label: 'Medium', color: '#eab308', order: 2 },
  low: { label: 'Low', color: '#22c55e', order: 3 },
  none: { label: 'No priority', color: '#6b7280', order: 4 },
} as const;

// Default task states for new projects
export const DEFAULT_TASK_STATES = [
  { name: 'Backlog', category: 'backlog', color: '#6b7280' },
  { name: 'Todo', category: 'backlog', color: '#8b5cf6' },
  { name: 'In Progress', category: 'in_progress', color: '#3b82f6' },
  { name: 'In Review', category: 'in_progress', color: '#f59e0b' },
  { name: 'Done', category: 'done', color: '#22c55e' },
  { name: 'Cancelled', category: 'done', color: '#ef4444' },
] as const;

// Workspace roles with permissions
export const WORKSPACE_ROLES = {
  owner: {
    label: 'Owner',
    permissions: ['all'],
  },
  admin: {
    label: 'Admin',
    permissions: ['manage_members', 'manage_projects', 'manage_integrations', 'manage_settings'],
  },
  member: {
    label: 'Member',
    permissions: ['view', 'create_tasks', 'edit_own_tasks', 'comment'],
  },
} as const;

// Predefined smart view templates
export const SMART_VIEW_TEMPLATES = {
  my_tasks: {
    name: 'My Tasks',
    icon: 'user',
    filters: {
      operator: 'AND' as const,
      conditions: [{ field: 'assignee_id', op: 'eq' as const, value: '{{current_user}}' }],
    },
    displayType: 'list' as const,
    groupBy: 'state' as const,
  },
  overdue: {
    name: 'Overdue',
    icon: 'alert-circle',
    filters: {
      operator: 'AND' as const,
      conditions: [
        { field: 'due_date', op: 'lt' as const, value: '{{now}}' },
        { field: 'state.category', op: 'neq' as const, value: 'done' },
      ],
    },
    displayType: 'list' as const,
    sortBy: 'due_date' as const,
  },
  this_week: {
    name: 'This Week',
    icon: 'calendar',
    filters: {
      operator: 'AND' as const,
      conditions: [
        { field: 'due_date', op: 'gte' as const, value: '{{start_of_week}}' },
        { field: 'due_date', op: 'lte' as const, value: '{{end_of_week}}' },
      ],
    },
    displayType: 'kanban' as const,
    groupBy: 'state' as const,
  },
  high_priority: {
    name: 'High Priority',
    icon: 'flag',
    filters: {
      operator: 'AND' as const,
      conditions: [{ field: 'priority', op: 'in' as const, value: ['urgent', 'high'] }],
    },
    displayType: 'list' as const,
    sortBy: 'priority' as const,
  },
} as const;

// API rate limits
export const RATE_LIMITS = {
  api: {
    windowMs: 60 * 1000, // 1 minute
    max: 100, // requests per window
  },
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // login attempts
  },
  webhooks: {
    windowMs: 60 * 1000,
    max: 1000,
  },
} as const;

// File upload limits
export const FILE_LIMITS = {
  maxSize: 10 * 1024 * 1024, // 10MB
  allowedTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'],
} as const;

// Pagination defaults
export const PAGINATION = {
  defaultPage: 1,
  defaultLimit: 20,
  maxLimit: 100,
} as const;

// Real-time events (SSE)
export const REALTIME_EVENTS = {
  TASK_CREATED: 'task:created',
  TASK_UPDATED: 'task:updated',
  TASK_DELETED: 'task:deleted',
  TASK_MOVED: 'task:moved',
  COMMENT_CREATED: 'comment:created',
  COMMENT_UPDATED: 'comment:updated',
  COMMENT_DELETED: 'comment:deleted',
  PROJECT_UPDATED: 'project:updated',
  MEMBER_JOINED: 'member:joined',
  MEMBER_LEFT: 'member:left',
} as const;

// Backwards compatibility alias (deprecated)
export const WS_EVENTS = {
  ...REALTIME_EVENTS,
  // Legacy client->server events (no longer used with SSE)
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  PING: 'ping',
  PONG: 'pong',
} as const;
