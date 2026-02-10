import {
  pgTable,
  uuid,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

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
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('project_workspace_idx').on(table.workspaceId),
    uniqueIndex('unique_project_identifier').on(table.workspaceId, table.identifier),
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
  (table) => [index('task_state_project_idx').on(table.projectId)]
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
    position: text('position').notNull(), // Lexicographic ordering within column
    dueDate: timestamp('due_date'),
    startDate: timestamp('start_date'),
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    agentId: uuid('agent_id').references(() => workspaceAgents.id, { onDelete: 'set null' }), // Agent that created this task (if any)
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    deletedAt: timestamp('deleted_at'), // Soft delete
  },
  (table) => [
    index('task_project_idx').on(table.projectId),
    index('task_state_idx').on(table.stateId),
    index('task_assignee_idx').on(table.createdBy),
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
  (table) => [uniqueIndex('unique_task_label').on(table.taskId, table.labelId)]
);

// One-way sync tracking (External → FlowTask only)
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
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('external_link_task_idx').on(table.taskId),
    uniqueIndex('unique_external_link').on(table.integrationId, table.externalType, table.externalId),
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
    eventType: text('event_type').notNull(), // 'created', 'updated', 'moved', 'assigned', 'commented'
    fieldName: text('field_name'),
    oldValue: jsonb('old_value'),
    newValue: jsonb('new_value'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('task_event_task_idx').on(table.taskId)]
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
  (table) => [index('comment_task_idx').on(table.taskId)]
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
  (table) => [uniqueIndex('unique_smart_view_share').on(table.smartViewId, table.sharedWithUserId)]
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
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('public_share_token_idx').on(table.token)]
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
  (table) => [uniqueIndex('unique_mcp_oauth_consent').on(table.userId, table.workspaceId, table.clientId)]
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
    expiresAt: timestamp('expires_at').notNull(),
    usedAt: timestamp('used_at'),
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
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('mcp_oauth_access_token_client_idx').on(table.clientId),
    index('mcp_oauth_access_token_user_idx').on(table.userId),
    index('mcp_oauth_access_token_expires_idx').on(table.expiresAt),
  ]
);

export const mcpOAuthRefreshTokens = pgTable(
  'mcp_oauth_refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accessTokenId: uuid('access_token_id').references(() => mcpOAuthAccessTokens.id, { onDelete: 'set null' }),
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
    expiresAt: timestamp('expires_at').notNull(),
    revokedAt: timestamp('revoked_at'),
    replacedByTokenId: uuid('replaced_by_token_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('mcp_oauth_refresh_token_client_idx').on(table.clientId),
    index('mcp_oauth_refresh_token_user_idx').on(table.userId),
    index('mcp_oauth_refresh_token_expires_idx').on(table.expiresAt),
  ]
);

// User's OpenRouter API keys (encrypted)
export const userApiKeys = pgTable(
  'user_api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    provider: text('provider').notNull(), // 'openrouter'
    encryptedKey: text('encrypted_key').notNull(),
    lastUsedAt: timestamp('last_used_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('unique_user_api_key').on(table.userId, table.provider)]
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

export type UserApiKey = typeof userApiKeys.$inferSelect;
export type NewUserApiKey = typeof userApiKeys.$inferInsert;

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
