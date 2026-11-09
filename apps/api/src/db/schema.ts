import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  bigint,
  jsonb,
  uniqueIndex,
  index,
  check,
  customType,
  primaryKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/** Postgres full-text search vector (always a generated column here). */
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});

/** Allowed values for tasks.priority (mirrors TaskPrioritySchema in @flowtask/shared). */
export const TASK_PRIORITY_VALUES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
/** Allowed values for task_states.category (mirrors TaskStateCategorySchema). */
export const TASK_STATE_CATEGORY_VALUES = ['backlog', 'in_progress', 'done'] as const;
/** Allowed values for task_relations.type. */
export const TASK_RELATION_TYPE_VALUES = ['blocks', 'relates', 'duplicates'] as const;
/** Allowed values for notifications.type. */
export const NOTIFICATION_TYPE_VALUES = [
  'assigned',
  'mentioned',
  'commented',
  'status_changed',
  'due_soon',
  'overdue',
  'github',
] as const;

function sqlInList(values: readonly string[]) {
  return sql.raw(values.map((v) => `'${v}'`).join(', '));
}

// ============ CORE TABLES ============

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').default(false).notNull(),
  name: text('name'),
  avatarUrl: text('avatar_url'),
  appRole: text('app_role').notNull().default('user'), // 'app_manager', 'user'
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  allowedAgentModels: jsonb('allowed_agent_models'),
  defaultAgentId: uuid('default_agent_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const workspaceMembers = pgTable(
  'workspace_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull().default('member'), // 'owner', 'admin', 'member'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('unique_workspace_member').on(table.workspaceId, table.userId)]
);

export const workspaceInvitations = pgTable(
  'workspace_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    email: text('email'), // nullable for generic invite links
    role: text('role').notNull().default('member'), // 'admin', 'member'
    token: uuid('token').notNull().defaultRandom().unique(),
    invitedBy: uuid('invited_by').references(() => users.id, { onDelete: 'set null' }),
    status: text('status').notNull().default('pending'), // 'pending', 'accepted', 'revoked', 'exhausted'
    maxUses: integer('max_uses'), // null = unlimited uses
    usesCount: integer('uses_count').default(0).notNull(), // track usage for multi-use links
    expiresAt: timestamp('expires_at').notNull(),
    acceptedAt: timestamp('accepted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('invitation_workspace_idx').on(table.workspaceId),
    index('invitation_token_idx').on(table.token),
  ]
);

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    identifier: text('identifier').notNull(), // e.g., "FLOW" for FLOW-123
    description: text('description'),
    icon: text('icon'),
    isArchived: boolean('is_archived').default(false).notNull(),
    access: text('access').notNull().default('all'), // 'all', 'admin', 'members'
    // Next task sequence number (FLOW-<n>), allocated with UPDATE ... RETURNING
    // inside the task-create transaction. Backfill: drizzle/0016_v2.sql
    nextTaskSeq: integer('next_task_seq').notNull().default(1),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('project_workspace_idx').on(table.workspaceId),
    uniqueIndex('unique_project_identifier').on(table.workspaceId, table.identifier),
  ]
);

export const projectMembers = pgTable(
  'project_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('unique_project_member').on(table.projectId, table.userId),
    index('project_member_project_idx').on(table.projectId),
    index('project_member_user_idx').on(table.userId),
  ]
);

// ============ INTEGRATIONS (Extensible) ============

export const projectIntegrations = pgTable(
  'project_integrations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    integrationType: text('integration_type').notNull(), // 'github', 'slack', 'linear', etc.
    config: jsonb('config').notNull(), // Type-validated at app layer
    isEnabled: boolean('is_enabled').default(true).notNull(),
    lastSyncAt: timestamp('last_sync_at'),
    syncStatus: text('sync_status').default('idle').notNull(), // 'idle', 'syncing', 'synced', 'error'
    syncError: text('sync_error'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('unique_project_integration').on(table.projectId, table.integrationType)]
);

// ============ TASK MANAGEMENT ============

export const taskStates = pgTable(
  'task_states',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(), // "Backlog", "In Progress", "Done"
    category: text('category').notNull(), // 'backlog', 'in_progress', 'done'
    position: text('position').notNull(), // Lexicographic ordering
    color: text('color'),
  },
  (table) => [
    index('task_state_project_idx').on(table.projectId),
    check(
      'task_state_category_check',
      sql`${table.category} IN (${sqlInList(TASK_STATE_CATEGORY_VALUES)})`
    ),
  ]
);

export const tasks = pgTable(
  'tasks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    stateId: uuid('state_id').references(() => taskStates.id, { onDelete: 'set null' }),
    sequenceNumber: integer('sequence_number').notNull(), // FLOW-123
    title: text('title').notNull(),
    description: text('description'), // Markdown
    priority: text('priority'), // 'urgent', 'high', 'medium', 'low', 'none'
    // Fractional index within the column. Must sort byte-wise: the column is
    // switched to COLLATE "C" by drizzle/0016_v2.sql
    // (drizzle can't declare a collation, and a custom type would make
    // drizzle-kit push TRUNCATE the table), and TaskService orders with an
    // explicit COLLATE "C" as well.
    position: text('position').notNull(),
    // Sub-tasks: same-project parent, cycles rejected in TaskService.
    parentId: uuid('parent_id').references((): AnyPgColumn => tasks.id, { onDelete: 'set null' }),
    dueDate: timestamp('due_date'),
    startDate: timestamp('start_date'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references(() => workspaceAgents.id, { onDelete: 'set null' }), // Agent that created this task (if any)
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'), // Soft delete
    // Set by TaskService when the task enters a done-category state, cleared
    // when it leaves one. Orders the board's Done column.
    completedAt: timestamp('completed_at'),
    // Full-text search: title (weight A) + description (weight B), 'simple'
    // config so it works for any language. Not selected by TaskService.
    searchVector: tsvector('search_vector').generatedAlwaysAs(
      sql`setweight(to_tsvector('simple', coalesce(title, '')), 'A') || setweight(to_tsvector('simple', coalesce(description, '')), 'B')`
    ),
  },
  (table) => [
    index('task_project_idx').on(table.projectId),
    index('task_parent_idx').on(table.parentId),
    index('task_search_idx').using('gin', table.searchVector),
    index('task_deleted_at_idx').on(table.projectId, table.deletedAt),
    index('task_due_date_idx').on(table.dueDate),
    check(
      'task_priority_check',
      sql`${table.priority} IS NULL OR ${table.priority} IN (${sqlInList(TASK_PRIORITY_VALUES)})`
    ),
    index('task_state_idx').on(table.stateId),
    index('task_assignee_idx').on(table.createdBy),
    // Composite index for the primary board query: filter by project (+state)
    // and order by position, avoiding an in-memory sort on every kanban load.
    index('task_project_state_position_idx').on(table.projectId, table.stateId, table.position),
    uniqueIndex('unique_task_sequence').on(table.projectId, table.sequenceNumber),
  ]
);

export const taskAssignees = pgTable(
  'task_assignees',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('unique_task_assignee').on(table.taskId, table.userId),
    index('task_assignee_user_idx').on(table.userId),
  ]
);

export const labels = pgTable(
  'labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    color: text('color'),
  },
  (table) => [index('label_project_idx').on(table.projectId)]
);

export const taskLabels = pgTable(
  'task_labels',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    labelId: uuid('label_id')
      .references(() => labels.id, { onDelete: 'cascade' })
      .notNull(),
  },
  (table) => [
    uniqueIndex('unique_task_label').on(table.taskId, table.labelId),
    // Filtering tasks by label uses label_id, which the unique index can't serve
    // (label_id is not its leading column).
    index('task_label_label_idx').on(table.labelId),
  ]
);

// Links between tasks and external items (GitHub issues/PRs).
// external_id is `owner/repo#N` (lower-cased) for GitHub items, so it is unique per repo.
export const externalLinks = pgTable(
  'external_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    integrationId: uuid('integration_id')
      .references(() => projectIntegrations.id, { onDelete: 'cascade' })
      .notNull(),
    taskId: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    externalType: text('external_type').notNull(), // 'github_issue', 'github_pr'
    externalId: text('external_id').notNull(),
    externalUrl: text('external_url').notNull(),
    lastSyncedAt: timestamp('last_synced_at'),
    // Hash of the title/body/state/labels last exchanged with GitHub (either direction).
    // Incoming webhooks whose content matches it are echoes and get skipped.
    syncHash: text('sync_hash'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('external_link_task_idx').on(table.taskId),
    index('external_link_integration_idx').on(table.integrationId),
    uniqueIndex('unique_external_link').on(
      table.integrationId,
      table.externalType,
      table.externalId
    ),
  ]
);

// ============ AUDIT TRAIL ============

export const taskEvents = pgTable(
  'task_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    mcpClientId: text('mcp_client_id').references(() => mcpOAuthClients.clientId, {
      onDelete: 'set null',
    }),
    eventType: text('event_type').notNull(), // 'created', 'updated', 'moved', 'assigned', 'commented'
    fieldName: text('field_name'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    // Display snapshot taken when the event was recorded (e.g. state names for a
    // move), so history still renders after a state/label/user is deleted.
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('task_event_task_idx').on(table.taskId),
    // Per-task history, newest first, keyset-paginated on (created_at, id).
    index('task_event_task_created_idx').on(table.taskId, table.createdAt, table.id),
    // Supports "activity by actor" lookups and the set-null on user delete.
    index('task_event_actor_idx').on(table.actorId),
  ]
);

export const comments = pgTable(
  'comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    taskId: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references(() => workspaceAgents.id, { onDelete: 'set null' }), // Agent that created this comment (if any)
    content: text('content').notNull(), // Markdown
    externalCommentId: text('external_comment_id'), // GitHub comment ID for synced comments
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'), // Soft delete
  },
  (table) => [
    index('comment_task_idx').on(table.taskId),
    // Supports the set-null on user delete and "comments by user" lookups.
    index('comment_user_idx').on(table.userId),
    // Synced-comment lookups (idempotency check, update/delete by external id)
    // filter on external_comment_id.
    index('comment_external_comment_idx').on(table.externalCommentId),
  ]
);

// ============ SMART VIEWS ============

export const smartViews = pgTable(
  'smart_views',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    description: text('description'),
    icon: text('icon'),

    // Filter configuration
    filters: jsonb('filters').notNull().default('{}'),
    /*
    {
      "operator": "AND",
      "conditions": [
        { "field": "assignee_id", "op": "eq", "value": "{{current_user}}" },
        { "field": "state.category", "op": "in", "value": ["backlog", "in_progress"] },
        { "field": "due_date", "op": "lt", "value": "{{now + 7d}}" }
      ]
    }
    */

    // Display configuration
    displayType: text('display_type').default('kanban').notNull(), // 'kanban', 'list', 'table', 'calendar'
    groupBy: text('group_by').default('state').notNull(), // 'state', 'assignee', 'project', 'priority'
    secondaryGroupBy: text('secondary_group_by'), // optional secondary grouping
    sortBy: text('sort_by').default('position').notNull(),
    sortOrder: text('sort_order').default('asc').notNull(),
    visibleFields: jsonb('visible_fields'), // ['title', 'assignee', 'due_date', ...]

    isPersonal: boolean('is_personal').default(false).notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('smart_view_workspace_idx').on(table.workspaceId)]
);

export const smartViewShares = pgTable(
  'smart_view_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    smartViewId: uuid('smart_view_id')
      .references(() => smartViews.id, { onDelete: 'cascade' })
      .notNull(),
    sharedWithUserId: uuid('shared_with_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    permission: text('permission').default('view').notNull(), // 'view', 'edit'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('unique_smart_view_share').on(table.smartViewId, table.sharedWithUserId),
    // "Views shared with me" lookups query by the non-leading shared_with_user_id.
    index('smart_view_share_user_idx').on(table.sharedWithUserId),
  ]
);

export const publicShares = pgTable(
  'public_shares',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    smartViewId: uuid('smart_view_id')
      .references(() => smartViews.id, { onDelete: 'cascade' })
      .notNull(),
    token: uuid('token').notNull().unique().defaultRandom(),
    displayTypeOverride: text('display_type_override'),
    hideFields: jsonb('hide_fields'), // Fields to hide from public
    passwordHash: text('password_hash'),
    expiresAt: timestamp('expires_at'),
    maxAccessCount: integer('max_access_count'),
    accessCount: integer('access_count').default(0).notNull(),
    lastAccessedAt: timestamp('last_accessed_at'),
    isActive: boolean('is_active').default(true).notNull(),
    // GitHub issue/PR links are only exposed publicly when explicitly enabled.
    showExternalLinks: boolean('show_external_links').default(false).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('public_share_token_idx').on(table.token),
    // Listing shares for a view queries by smart_view_id.
    index('public_share_smart_view_idx').on(table.smartViewId),
  ]
);

// Fixed-window counters for share-password attempts. Keys are
// `token:<token>` (per share, independent of IP) and `ip:<ip>:<token>`.
export const publicSharePasswordAttempts = pgTable(
  'public_share_password_attempts',
  {
    key: text('key').primaryKey(),
    attempts: integer('attempts').default(0).notNull(),
    windowExpiresAt: timestamp('window_expires_at').notNull(),
  },
  (table) => [index('share_pw_attempt_expiry_idx').on(table.windowExpiresAt)]
);

// ============ AI AGENTS ============

export const agents = pgTable(
  'agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    model: text('model').notNull(), // e.g., 'anthropic/claude-3-opus'
    systemPrompt: text('system_prompt'),
    tools: jsonb('tools'), // Enabled tools for this agent

    // Rate limiting
    requestsPerMinute: integer('requests_per_minute').default(10).notNull(),
    tokensPerDay: integer('tokens_per_day').default(100000).notNull(),
    currentDayTokens: integer('current_day_tokens').default(0).notNull(),
    lastTokenReset: timestamp('last_token_reset').defaultNow(),

    isActive: boolean('is_active').default(true).notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('agent_workspace_idx').on(table.workspaceId)]
);

// ============ WORKSPACE AGENTS (MCP API Tokens) ============

export const workspaceAgents = pgTable(
  'workspace_agents',
  {
    id: uuid('id').primaryKey().defaultRandom(),

    // Scope
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    restrictedProjectIds: jsonb('restricted_project_ids'), // null = all projects in workspace

    // Identity
    name: text('name').notNull(),
    description: text('description'),

    // Authentication
    tokenHash: text('token_hash').notNull(), // bcrypt hash
    tokenPrefix: text('token_prefix').notNull(), // 12 chars for lookup (after ft_v1_)
    lastUsedAt: timestamp('last_used_at'),

    // Permissions (array of allowed MCP tool names)
    permissions: jsonb('permissions').notNull().default('[]'),

    // Rate limiting (daily only - per-minute uses Redis)
    tokensPerDay: integer('tokens_per_day').default(100000).notNull(),
    currentDayTokens: integer('current_day_tokens').default(0).notNull(),
    lastTokenReset: timestamp('last_token_reset').defaultNow(),

    // Status
    isActive: boolean('is_active').default(true).notNull(),
    expiresAt: timestamp('expires_at'),

    // Audit
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('workspace_agent_workspace_idx').on(table.workspaceId),
    index('workspace_agent_prefix_idx').on(table.tokenPrefix),
    index('workspace_agent_expires_idx').on(table.expiresAt),
  ]
);

// ============ MCP OAUTH ============

export const mcpOAuthClients = pgTable(
  'mcp_oauth_clients',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: text('client_id').notNull().unique(),
    clientName: text('client_name').notNull(),
    redirectUris: jsonb('redirect_uris').notNull(),
    grantTypes: jsonb('grant_types').notNull().default('["authorization_code","refresh_token"]'),
    responseTypes: jsonb('response_types').notNull().default('["code"]'),
    scope: text('scope'),
    tokenEndpointAuthMethod: text('token_endpoint_auth_method').notNull().default('none'),
    clientUri: text('client_uri'),
    logoUri: text('logo_uri'),
    tosUri: text('tos_uri'),
    policyUri: text('policy_uri'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('mcp_oauth_client_id_idx').on(table.clientId)]
);

export const mcpOAuthConsents = pgTable(
  'mcp_oauth_consents',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    clientId: uuid('client_id')
      .references(() => mcpOAuthClients.id, { onDelete: 'cascade' })
      .notNull(),
    approvedScopes: jsonb('approved_scopes').notNull(),
    grantedByRole: text('granted_by_role').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('unique_mcp_oauth_consent').on(table.userId, table.workspaceId, table.clientId),
  ]
);

export const mcpOAuthAuthorizationCodes = pgTable(
  'mcp_oauth_authorization_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .references(() => mcpOAuthClients.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    codeHash: text('code_hash').notNull().unique(),
    redirectUri: text('redirect_uri').notNull(),
    scope: text('scope').notNull(),
    codeChallenge: text('code_challenge').notNull(),
    codeChallengeMethod: text('code_challenge_method').notNull(),
    // RFC 8707 resource indicator the code was issued for (canonical MCP URL when absent).
    resource: text('resource'),
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
    // Token family created when the code was redeemed; revoked if the code is replayed.
    tokenFamilyId: uuid('token_family_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('mcp_oauth_auth_code_client_idx').on(table.clientId),
    index('mcp_oauth_auth_code_user_idx').on(table.userId),
    index('mcp_oauth_auth_code_expires_idx').on(table.expiresAt),
  ]
);

export const mcpOAuthAccessTokens = pgTable(
  'mcp_oauth_access_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: uuid('client_id')
      .references(() => mcpOAuthClients.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    scope: text('scope').notNull(),
    // RFC 8707 audience; null on tokens issued before resource binding (treated as the canonical MCP URL).
    resource: text('resource'),
    // Refresh-token family this access token belongs to (null on legacy tokens).
    familyId: uuid('family_id'),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('mcp_oauth_access_token_client_idx').on(table.clientId),
    index('mcp_oauth_access_token_user_idx').on(table.userId),
    index('mcp_oauth_access_token_expires_idx').on(table.expiresAt),
    index('mcp_oauth_access_token_family_idx').on(table.familyId),
  ]
);

export const mcpOAuthRefreshTokens = pgTable(
  'mcp_oauth_refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accessTokenId: uuid('access_token_id').references(() => mcpOAuthAccessTokens.id, {
      onDelete: 'set null',
    }),
    clientId: uuid('client_id')
      .references(() => mcpOAuthClients.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    scope: text('scope').notNull(),
    resource: text('resource'),
    // Rotation family: reuse of a rotated token outside the grace window revokes the whole family.
    familyId: uuid('family_id'),
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    replacedByTokenId: uuid('replaced_by_token_id'),
    rotatedAt: timestamp('rotated_at'),
    // Successor token pair encrypted with a key derived from this (presented) refresh token,
    // so a concurrent refresh inside the grace window gets the same successor back.
    rotationGracePayload: text('rotation_grace_payload'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('mcp_oauth_refresh_token_client_idx').on(table.clientId),
    index('mcp_oauth_refresh_token_user_idx').on(table.userId),
    index('mcp_oauth_refresh_token_expires_idx').on(table.expiresAt),
    index('mcp_oauth_refresh_token_family_idx').on(table.familyId),
  ]
);

// Workspace OpenRouter API keys (encrypted)
export const workspaceApiKeys = pgTable(
  'workspace_api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull(), // 'openrouter'
    encryptedKey: text('encrypted_key').notNull(),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('unique_workspace_api_key').on(table.workspaceId, table.provider)]
);

// ============ GITHUB INSTALLATIONS (User-level) ============

export const githubInstallations = pgTable(
  'github_installations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    installationId: integer('installation_id').notNull(),
    accountLogin: text('account_login'), // GitHub account/org name for display
    accountType: text('account_type'), // 'User' or 'Organization'
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('unique_user_installation').on(table.userId, table.installationId),
    index('github_installation_user_idx').on(table.userId),
  ]
);

// ============ INTEGRATION PLUMBING ============

// GitHub webhook deliveries already processed (X-GitHub-Delivery), for dedupe.
// Rows older than 7 days are pruned by the webhook handler.
export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    deliveryId: text('delivery_id').primaryKey(),
    receivedAt: timestamp('received_at').defaultNow().notNull(),
  },
  (table) => [index('webhook_delivery_received_idx').on(table.receivedAt)]
);

// Short-lived OAuth `state` nonces for the GitHub App and Slack install flows,
// bound to the user session that started the flow.
export const integrationOauthStates = pgTable(
  'integration_oauth_states',
  {
    state: text('state').primaryKey(),
    provider: text('provider').notNull(), // 'github' | 'slack'
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    sessionId: text('session_id').notNull(),
    projectId: uuid('project_id')
      .references(() => projects.id, { onDelete: 'cascade' })
      .notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('integration_oauth_state_expires_idx').on(table.expiresAt)]
);

// ============ SESSIONS (for Better Auth) ============

export const sessions = pgTable(
  'sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    userAgent: text('user_agent'),
    ipAddress: text('ip_address'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('session_user_idx').on(table.userId)]
);

export const verificationTokens = pgTable(
  'verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    identifier: text('identifier').notNull(),
    token: text('token').notNull().unique(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('unique_verification_token').on(table.identifier, table.token)]
);

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at'),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('unique_provider_account').on(table.providerId, table.accountId),
    index('account_user_idx').on(table.userId),
  ]
);

// Better Auth rate-limit counters (rateLimit.storage = 'database'), shared by
// every API replica. lastRequest is epoch milliseconds, as Better Auth stores it.
export const authRateLimits = pgTable(
  'auth_rate_limits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: text('key').notNull().unique(),
    count: integer('count').notNull(),
    lastRequest: bigint('last_request', { mode: 'number' }).notNull(),
  },
  (table) => [index('auth_rate_limits_last_request_idx').on(table.lastRequest)]
);

// ============ TASK RELATIONS ============

export const taskRelations = pgTable(
  'task_relations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    // 'blocks': task blocks relatedTask. 'duplicates': task duplicates relatedTask.
    // 'relates': symmetric (stored once; the reverse pair is rejected in TaskRelationService).
    taskId: uuid('task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    relatedTaskId: uuid('related_task_id')
      .references(() => tasks.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type').notNull(),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('unique_task_relation').on(table.taskId, table.relatedTaskId, table.type),
    index('task_relation_related_idx').on(table.relatedTaskId),
    check('task_relation_no_self', sql`${table.taskId} <> ${table.relatedTaskId}`),
    check(
      'task_relation_type_check',
      sql`${table.type} IN (${sqlInList(TASK_RELATION_TYPE_VALUES)})`
    ),
  ]
);

// ============ NOTIFICATIONS (Inbox) ============

export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    type: text('type').notNull(),
    taskId: uuid('task_id').references(() => tasks.id, { onDelete: 'cascade' }),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
    data: jsonb('data').notNull().default({}),
    // Idempotency key, e.g. "due_soon:<taskId>:2026-11-09" (one reminder per task per day).
    dedupeKey: text('dedupe_key'),
    readAt: timestamp('read_at', { withTimezone: true }),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    // Inbox list: WHERE user_id AND workspace_id ... ORDER BY created_at DESC, id DESC
    index('notification_inbox_idx').on(table.userId, table.workspaceId, table.createdAt, table.id),
    // Unread badge
    index('notification_unread_idx')
      .on(table.userId, table.workspaceId)
      .where(sql`${table.readAt} IS NULL AND ${table.archivedAt} IS NULL`),
    index('notification_task_idx').on(table.taskId),
    uniqueIndex('unique_notification_dedupe')
      .on(table.userId, table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
    check(
      'notification_type_check',
      sql`${table.type} IN (${sqlInList(NOTIFICATION_TYPE_VALUES)})`
    ),
  ]
);

// ============ JOBS (Postgres queue, FOR UPDATE SKIP LOCKED) ============

export const jobs = pgTable(
  'jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull().default({}),
    // Singleton key: at most one pending job per key (recurring scans, dedupe).
    key: text('key'),
    runAt: timestamp('run_at', { withTimezone: true }).defaultNow().notNull(),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(5),
    lastError: text('last_error'),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    lockedBy: text('locked_by'),
    doneAt: timestamp('done_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('job_pending_idx')
      .on(table.runAt)
      .where(sql`${table.doneAt} IS NULL AND ${table.failedAt} IS NULL`),
    uniqueIndex('unique_pending_job_key')
      .on(table.key)
      .where(
        sql`${table.key} IS NOT NULL AND ${table.doneAt} IS NULL AND ${table.failedAt} IS NULL`
      ),
    index('job_done_idx').on(table.doneAt),
  ]
);

// ============ OUTGOING WEBHOOKS ============

export const outgoingWebhooks = pgTable(
  'outgoing_webhooks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    workspaceId: uuid('workspace_id')
      .references(() => workspaces.id, { onDelete: 'cascade' })
      .notNull(),
    url: text('url').notNull(),
    description: text('description'),
    // HMAC-SHA256 signing secret. Returned in full only at creation / rotation.
    secret: text('secret').notNull(),
    events: text('events')
      .array()
      .notNull()
      .default(sql`ARRAY[]::text[]`),
    enabled: boolean('enabled').notNull().default(true),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index('outgoing_webhook_workspace_idx').on(table.workspaceId)]
);

export const outgoingWebhookDeliveries = pgTable(
  'outgoing_webhook_deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    webhookId: uuid('webhook_id')
      .references(() => outgoingWebhooks.id, { onDelete: 'cascade' })
      .notNull(),
    event: text('event').notNull(),
    payload: jsonb('payload').notNull(),
    status: text('status').notNull().default('pending'), // 'pending', 'success', 'failed'
    responseCode: integer('response_code'),
    attempt: integer('attempt').notNull().default(0),
    error: text('error'),
    durationMs: integer('duration_ms'),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index('outgoing_webhook_delivery_webhook_idx').on(table.webhookId, table.createdAt),
    index('outgoing_webhook_delivery_created_idx').on(table.createdAt),
  ]
);

// ============ RATE LIMITING (UNLOGGED via drizzle/0016_v2.sql) ============

export const rateLimitCounters = pgTable(
  'rate_limit_counters',
  {
    key: text('key').notNull(),
    bucketStart: timestamp('bucket_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.key, table.bucketStart] }),
    index('rate_limit_counters_expires_idx').on(table.expiresAt),
  ]
);

// Type exports for use in application code
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

export type Workspace = typeof workspaces.$inferSelect;
export type NewWorkspace = typeof workspaces.$inferInsert;

export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type NewWorkspaceMember = typeof workspaceMembers.$inferInsert;

export type WorkspaceInvitation = typeof workspaceInvitations.$inferSelect;
export type NewWorkspaceInvitation = typeof workspaceInvitations.$inferInsert;

export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type ProjectIntegration = typeof projectIntegrations.$inferSelect;
export type NewProjectIntegration = typeof projectIntegrations.$inferInsert;

export type TaskState = typeof taskStates.$inferSelect;
export type NewTaskState = typeof taskStates.$inferInsert;

export type Task = typeof tasks.$inferSelect;
export type NewTask = typeof tasks.$inferInsert;

export type TaskAssignee = typeof taskAssignees.$inferSelect;
export type NewTaskAssignee = typeof taskAssignees.$inferInsert;

export type Label = typeof labels.$inferSelect;
export type NewLabel = typeof labels.$inferInsert;

export type TaskLabel = typeof taskLabels.$inferSelect;
export type NewTaskLabel = typeof taskLabels.$inferInsert;

export type ExternalLink = typeof externalLinks.$inferSelect;
export type NewExternalLink = typeof externalLinks.$inferInsert;

export type TaskEvent = typeof taskEvents.$inferSelect;
export type NewTaskEvent = typeof taskEvents.$inferInsert;

export type Comment = typeof comments.$inferSelect;
export type NewComment = typeof comments.$inferInsert;

export type SmartView = typeof smartViews.$inferSelect;
export type NewSmartView = typeof smartViews.$inferInsert;

export type SmartViewShare = typeof smartViewShares.$inferSelect;
export type NewSmartViewShare = typeof smartViewShares.$inferInsert;

export type PublicShare = typeof publicShares.$inferSelect;
export type NewPublicShare = typeof publicShares.$inferInsert;

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export type WorkspaceApiKey = typeof workspaceApiKeys.$inferSelect;
export type NewWorkspaceApiKey = typeof workspaceApiKeys.$inferInsert;

export type Session = typeof sessions.$inferSelect;
export type NewSession = typeof sessions.$inferInsert;

export type VerificationToken = typeof verificationTokens.$inferSelect;
export type NewVerificationToken = typeof verificationTokens.$inferInsert;

export type Account = typeof accounts.$inferSelect;
export type NewAccount = typeof accounts.$inferInsert;

export type WorkspaceAgent = typeof workspaceAgents.$inferSelect;
export type NewWorkspaceAgent = typeof workspaceAgents.$inferInsert;

export type McpOAuthClient = typeof mcpOAuthClients.$inferSelect;
export type NewMcpOAuthClient = typeof mcpOAuthClients.$inferInsert;

export type McpOAuthConsent = typeof mcpOAuthConsents.$inferSelect;
export type NewMcpOAuthConsent = typeof mcpOAuthConsents.$inferInsert;

export type McpOAuthAuthorizationCode = typeof mcpOAuthAuthorizationCodes.$inferSelect;
export type NewMcpOAuthAuthorizationCode = typeof mcpOAuthAuthorizationCodes.$inferInsert;

export type McpOAuthAccessToken = typeof mcpOAuthAccessTokens.$inferSelect;
export type NewMcpOAuthAccessToken = typeof mcpOAuthAccessTokens.$inferInsert;

export type McpOAuthRefreshToken = typeof mcpOAuthRefreshTokens.$inferSelect;
export type NewMcpOAuthRefreshToken = typeof mcpOAuthRefreshTokens.$inferInsert;

export type GitHubInstallation = typeof githubInstallations.$inferSelect;
export type NewGitHubInstallation = typeof githubInstallations.$inferInsert;

export type ProjectMember = typeof projectMembers.$inferSelect;
export type NewProjectMember = typeof projectMembers.$inferInsert;

export type TaskRelation = typeof taskRelations.$inferSelect;
export type NewTaskRelation = typeof taskRelations.$inferInsert;

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;

export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;

export type OutgoingWebhook = typeof outgoingWebhooks.$inferSelect;
export type NewOutgoingWebhook = typeof outgoingWebhooks.$inferInsert;

export type OutgoingWebhookDelivery = typeof outgoingWebhookDeliveries.$inferSelect;
export type NewOutgoingWebhookDelivery = typeof outgoingWebhookDeliveries.$inferInsert;

export type RateLimitCounter = typeof rateLimitCounters.$inferSelect;
export type NewRateLimitCounter = typeof rateLimitCounters.$inferInsert;
