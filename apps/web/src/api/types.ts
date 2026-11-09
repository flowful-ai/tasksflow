/**
 * Wire (JSON) shapes of the FlowTask API.
 *
 * Wherever `@flowtask/shared` defines the entity, the DTO is derived from it
 * with `Serialized<T>` (Date → ISO string), so web and API cannot drift. Shapes
 * that only exist in the domain layer (task detail, history, relations,
 * webhooks) are declared here with a pointer to their source.
 */
import type {
  AppContext as SharedAppContext,
  AppManagedUser as SharedAppManagedUser,
  AppUsersListResponse as SharedAppUsersListResponse,
  BulkTaskItemResult,
  DisplayType,
  JsonObject,
  JsonValue,
  Label,
  NotificationItem,
  OutgoingWebhookDeliveryStatus,
  OutgoingWebhookEvent,
  Project,
  PublicInvitation as SharedPublicInvitation,
  PublicShare,
  SlackNotificationSettings,
  SmartView,
  Task,
  TaskPriority,
  TaskRelationType,
  TaskState,
  User,
  VisibleField,
  Workspace,
  WorkspaceActivityItem as SharedWorkspaceActivityItem,
  WorkspaceMember as SharedWorkspaceMember,
  WorkspaceRole,
} from '@flowtask/shared';

/** JSON-serialised form of a shared type: every Date becomes an ISO string. */
export type Serialized<T> = T extends Date
  ? string
  : T extends (infer U)[]
    ? Serialized<U>[]
    : T extends object
      ? { [K in keyof T]: Serialized<T[K]> }
      : T;

// ============ Users & workspaces ============

export type UserDto = Serialized<User>;
export type WorkspaceDto = Serialized<Workspace>;
export type { WorkspaceRole };

export type WorkspaceMemberDto = Serialized<SharedWorkspaceMember> & {
  user: Pick<UserDto, 'id' | 'email' | 'name' | 'avatarUrl'>;
};

/** GET /api/workspaces/:id (domain WorkspaceWithRelations). */
export type WorkspaceDetailDto = WorkspaceDto & {
  members: WorkspaceMemberDto[];
  projectCount: number;
};

export type WorkspaceActivityItemDto = Serialized<SharedWorkspaceActivityItem>;
export type PublicInvitationDto = Serialized<SharedPublicInvitation>;

export type AppContextDto = SharedAppContext;
export type AppManagedUserDto = Serialized<SharedAppManagedUser>;
export type AppUsersListResponseDto = Serialized<SharedAppUsersListResponse>;

// ============ Projects ============

export type TaskStateDto = TaskState;
export type LabelDto = Label;

/** GET /api/projects (domain ProjectWithRelations). */
export type ProjectDto = Serialized<Project> & {
  taskStates: TaskStateDto[];
  labels: LabelDto[];
  taskCount: number;
};

/** GET /api/projects/:id (same shape as list items). */
export type ProjectDetailDto = ProjectDto;

export interface ProjectPermissionsDto {
  role: WorkspaceRole;
  canEdit: boolean;
  canDelete: boolean;
}

export interface ProjectMemberDto {
  id: string;
  projectId: string;
  userId: string;
  createdAt: string;
  user: Pick<UserDto, 'id' | 'email' | 'name' | 'avatarUrl'>;
}

// ============ Tasks ============

/** Minimal reference to another task (domain TaskRef). */
export interface TaskRefDto {
  id: string;
  /** "TF-42" */
  key: string;
  title: string;
  projectId: string;
  stateId: string | null;
  stateCategory: string | null;
  done: boolean;
}

export interface TaskExternalLinkDto {
  id: string;
  externalType: 'github_issue' | 'github_pr';
  externalId: string;
  externalUrl: string;
}

export interface TaskAgentDto {
  id: string;
  name: string;
}

/** A task as listed by GET /api/tasks and carried by realtime events (domain TaskWithRelations). */
export type TaskDto = Serialized<Task> & {
  state: TaskStateDto | null;
  assignees: UserDto[];
  labels: LabelDto[];
  project: { id: string; identifier: string; name: string; workspaceId?: string };
  agent: TaskAgentDto | null;
  externalLinks: TaskExternalLinkDto[];
  parentId?: string | null;
  /** "TF-42" */
  key?: string;
  subtaskCount?: number;
  subtaskDoneCount?: number;
};

/** GET /api/tasks/:id (domain TaskDetail). */
export type TaskDetailDto = TaskDto & {
  parent?: TaskRefDto | null;
  subtasks?: TaskRefDto[];
  blocks?: TaskRefDto[];
  blockedBy?: TaskRefDto[];
};

export interface TaskListFilters {
  assigneeId?: string;
  stateId?: string;
  labelId?: string;
  priority?: TaskPriority;
  search?: string;
  /** A task id lists its sub-tasks; 'none' lists top-level tasks only. */
  parentId?: string;
}

/** Body of POST /api/tasks/:id/move. Neighbours are preferred over `position`. */
export interface MoveTaskInput {
  taskId: string;
  stateId: string;
  /** The task that ends up directly above (omit at the top of the column). */
  afterTaskId?: string | null;
  /** The task that ends up directly below (omit at the bottom of the column). */
  beforeTaskId?: string | null;
}

export interface CreateTaskInput {
  projectId: string;
  title: string;
  description?: string;
  stateId?: string;
  priority?: TaskPriority;
  dueDate?: string;
  assigneeIds?: string[];
  labelIds?: string[];
  parentId?: string | null;
  createOnGitHub?: boolean;
  githubRepo?: { owner: string; repo: string };
}

export interface UpdateTaskInput {
  title?: string;
  description?: string;
  stateId?: string;
  priority?: TaskPriority | null;
  dueDate?: string | null;
  startDate?: string | null;
  parentId?: string | null;
  assigneeIds?: string[];
  labelIds?: string[];
}

/** POST /api/tasks/bulk → { results, tasks }. */
export interface BulkTaskResponseDto {
  results: BulkTaskItemResult[];
  tasks: TaskDto[];
}

export interface CommentDto {
  id: string;
  taskId: string;
  userId: string | null;
  agentId: string | null;
  content: string;
  createdAt: string;
  updatedAt: string | null;
  user: Pick<UserDto, 'id' | 'email' | 'name' | 'avatarUrl'> | null;
  agent: TaskAgentDto | null;
}

// ============ History, relations, trash ============

/** Resolved display value of a history entry (domain HistoryDisplayValue). */
export type HistoryDisplayValueDto =
  | { kind: 'state'; id: string; name: string; category: string; color: string | null }
  | { kind: 'user'; id: string; name: string | null; avatarUrl: string | null }
  | { kind: 'label'; id: string; name: string; color: string | null }
  | { kind: 'task'; task: TaskRefDto }
  | { kind: 'comment'; id: string; excerpt: string | null; deleted: boolean }
  | { kind: 'relation'; type: string; direction: 'outgoing' | 'incoming'; task: TaskRefDto | null }
  | { kind: 'value'; value: JsonValue };

/** GET /api/tasks/:id/history item (domain TaskHistoryItem). */
export interface TaskHistoryItemDto {
  id: string;
  type: string;
  field: string | null;
  createdAt: string;
  actor: { id: string; name: string | null; avatarUrl: string | null } | null;
  agent: { id: string; name: string } | null;
  oldValue: JsonValue;
  newValue: JsonValue;
  from: HistoryDisplayValueDto | null;
  to: HistoryDisplayValueDto | null;
}

/** GET /api/tasks/:id/relations item (domain TaskRelationView). */
export interface TaskRelationDto {
  id: string;
  type: TaskRelationType;
  direction: 'outgoing' | 'incoming';
  task: TaskRefDto;
  createdAt: string;
  createdBy: string | null;
}

export interface AddTaskRelationInput {
  relatedTaskId: string;
  type: TaskRelationType;
  direction?: 'outgoing' | 'incoming';
}

export interface TrashMetaDto {
  total: number;
  page: number;
  limit: number;
  retentionDays: number;
}

// ============ Notifications & search ============

export type NotificationDto = Serialized<NotificationItem>;
export type {
  NotificationFilter,
  SearchResult,
  SearchTaskHit,
  SearchProjectHit,
} from '@flowtask/shared';

// ============ Smart views & public shares ============

/** A public share as returned to its owner (the password hash is replaced by `hasPassword`). */
export type PublicShareDto = Omit<Serialized<PublicShare>, 'passwordHash'> & {
  hasPassword: boolean;
  shareUrl?: string;
};

export type SmartViewDto = Serialized<SmartView> & {
  publicShares?: PublicShareDto[];
};

export interface CreatePublicShareInput {
  displayTypeOverride?: DisplayType;
  hideFields?: VisibleField[];
  password?: string;
  expiresAt?: string;
  maxAccessCount?: number;
  showExternalLinks?: boolean;
}

export interface SmartViewExecuteDto {
  view: SmartViewDto;
  tasks: TaskDto[];
  meta: { total: number; page: number; limit: number };
}

// ============ Outgoing webhooks ============

export type OutgoingWebhookEventSelector = OutgoingWebhookEvent | '*';

/** domain OutgoingWebhookView */
export interface OutgoingWebhookDto {
  id: string;
  workspaceId: string;
  url: string;
  description: string | null;
  events: OutgoingWebhookEventSelector[];
  enabled: boolean;
  /** Masked, e.g. "whsec_…AbCd". */
  secretPreview: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Returned by create and by update with `rotateSecret`: the only time the secret is shown. */
export interface OutgoingWebhookWithSecretDto extends OutgoingWebhookDto {
  secret: string;
}

export interface OutgoingWebhookDeliveryDto {
  id: string;
  webhookId: string;
  event: string;
  status: OutgoingWebhookDeliveryStatus;
  responseCode: number | null;
  attempt: number;
  error: string | null;
  durationMs: number | null;
  deliveredAt: string | null;
  createdAt: string;
  payload: JsonObject;
}

export interface CreateOutgoingWebhookInput {
  workspaceId: string;
  url: string;
  description?: string;
  events: OutgoingWebhookEventSelector[];
  enabled?: boolean;
}

export interface UpdateOutgoingWebhookInput {
  url?: string;
  description?: string | null;
  events?: OutgoingWebhookEventSelector[];
  enabled?: boolean;
  rotateSecret?: boolean;
}

// ============ Slack ============

export interface SlackIntegrationDto {
  connected: boolean;
  id: string | null;
  isEnabled: boolean;
  teamName: string | null;
  channelId: string | null;
  channelName: string | null;
  notifications: SlackNotificationSettings | null;
  canConnect: boolean;
}

export interface SlackChannelDto {
  id: string;
  name: string;
  isPrivate: boolean;
  isMember: boolean;
}

export interface UpdateSlackInput {
  channelId?: string;
  isEnabled?: boolean;
  notifications?: Partial<SlackNotificationSettings>;
}
