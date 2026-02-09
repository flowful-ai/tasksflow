import { relations } from 'drizzle-orm';
import {
  users,
  workspaces,
  workspaceMembers,
  workspaceInvitations,
  projects,
  projectIntegrations,
  workspaceAgents,
  mcpOAuthClients,
  mcpOAuthConsents,
  mcpOAuthAuthorizationCodes,
  mcpOAuthAccessTokens,
  mcpOAuthRefreshTokens,
  taskStates,
  tasks,
  taskAssignees,
  labels,
  taskLabels,
  externalLinks,
  taskEvents,
  comments,
  smartViews,
  smartViewShares,
  publicShares,
  agents,
  userApiKeys,
  sessions,
  accounts,
  githubInstallations,
} from './schema.js';

// User relations
export const usersRelations = relations(users, ({ many }) => ({
  workspaceMembers: many(workspaceMembers),
  createdProjects: many(projects),
  taskAssignees: many(taskAssignees),
  comments: many(comments),
  agents: many(agents),
  apiKeys: many(userApiKeys),
  sessions: many(sessions),
  accounts: many(accounts),
  githubInstallations: many(githubInstallations),
  smartViews: many(smartViews),
  smartViewShares: many(smartViewShares),
  invitationsSent: many(workspaceInvitations),
  mcpOAuthConsents: many(mcpOAuthConsents),
  mcpOAuthAuthorizationCodes: many(mcpOAuthAuthorizationCodes),
  mcpOAuthAccessTokens: many(mcpOAuthAccessTokens),
  mcpOAuthRefreshTokens: many(mcpOAuthRefreshTokens),
}));

// Workspace relations
export const workspacesRelations = relations(workspaces, ({ many }) => ({
  members: many(workspaceMembers),
  invitations: many(workspaceInvitations),
  projects: many(projects),
  smartViews: many(smartViews),
  agents: many(agents),
  workspaceAgents: many(workspaceAgents),
  mcpOAuthConsents: many(mcpOAuthConsents),
  mcpOAuthAuthorizationCodes: many(mcpOAuthAuthorizationCodes),
  mcpOAuthAccessTokens: many(mcpOAuthAccessTokens),
  mcpOAuthRefreshTokens: many(mcpOAuthRefreshTokens),
}));

// Workspace member relations
export const workspaceMembersRelations = relations(workspaceMembers, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceMembers.workspaceId],
    references: [workspaces.id],
  }),
  user: one(users, {
    fields: [workspaceMembers.userId],
    references: [users.id],
  }),
}));

// Workspace invitation relations
export const workspaceInvitationsRelations = relations(workspaceInvitations, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceInvitations.workspaceId],
    references: [workspaces.id],
  }),
  invitedBy: one(users, {
    fields: [workspaceInvitations.invitedBy],
    references: [users.id],
  }),
}));

// Project relations
export const projectsRelations = relations(projects, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [projects.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [projects.createdBy],
    references: [users.id],
  }),
  integrations: many(projectIntegrations),
  taskStates: many(taskStates),
  tasks: many(tasks),
  labels: many(labels),
}));

// Workspace agent relations
export const workspaceAgentsRelations = relations(workspaceAgents, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [workspaceAgents.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [workspaceAgents.createdBy],
    references: [users.id],
  }),
}));

// MCP OAuth relations
export const mcpOAuthClientsRelations = relations(mcpOAuthClients, ({ many }) => ({
  consents: many(mcpOAuthConsents),
  authorizationCodes: many(mcpOAuthAuthorizationCodes),
  accessTokens: many(mcpOAuthAccessTokens),
  refreshTokens: many(mcpOAuthRefreshTokens),
}));

export const mcpOAuthConsentsRelations = relations(mcpOAuthConsents, ({ one }) => ({
  user: one(users, {
    fields: [mcpOAuthConsents.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [mcpOAuthConsents.workspaceId],
    references: [workspaces.id],
  }),
  client: one(mcpOAuthClients, {
    fields: [mcpOAuthConsents.clientId],
    references: [mcpOAuthClients.id],
  }),
}));

export const mcpOAuthAuthorizationCodesRelations = relations(mcpOAuthAuthorizationCodes, ({ one }) => ({
  user: one(users, {
    fields: [mcpOAuthAuthorizationCodes.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [mcpOAuthAuthorizationCodes.workspaceId],
    references: [workspaces.id],
  }),
  client: one(mcpOAuthClients, {
    fields: [mcpOAuthAuthorizationCodes.clientId],
    references: [mcpOAuthClients.id],
  }),
}));

export const mcpOAuthAccessTokensRelations = relations(mcpOAuthAccessTokens, ({ one, many }) => ({
  user: one(users, {
    fields: [mcpOAuthAccessTokens.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [mcpOAuthAccessTokens.workspaceId],
    references: [workspaces.id],
  }),
  client: one(mcpOAuthClients, {
    fields: [mcpOAuthAccessTokens.clientId],
    references: [mcpOAuthClients.id],
  }),
  refreshTokens: many(mcpOAuthRefreshTokens),
}));

export const mcpOAuthRefreshTokensRelations = relations(mcpOAuthRefreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [mcpOAuthRefreshTokens.userId],
    references: [users.id],
  }),
  workspace: one(workspaces, {
    fields: [mcpOAuthRefreshTokens.workspaceId],
    references: [workspaces.id],
  }),
  client: one(mcpOAuthClients, {
    fields: [mcpOAuthRefreshTokens.clientId],
    references: [mcpOAuthClients.id],
  }),
  accessToken: one(mcpOAuthAccessTokens, {
    fields: [mcpOAuthRefreshTokens.accessTokenId],
    references: [mcpOAuthAccessTokens.id],
  }),
}));

// Project integration relations
export const projectIntegrationsRelations = relations(projectIntegrations, ({ one, many }) => ({
  project: one(projects, {
    fields: [projectIntegrations.projectId],
    references: [projects.id],
  }),
  externalLinks: many(externalLinks),
}));

// Task state relations
export const taskStatesRelations = relations(taskStates, ({ one, many }) => ({
  project: one(projects, {
    fields: [taskStates.projectId],
    references: [projects.id],
  }),
  tasks: many(tasks),
}));

// Task relations
export const tasksRelations = relations(tasks, ({ one, many }) => ({
  project: one(projects, {
    fields: [tasks.projectId],
    references: [projects.id],
  }),
  state: one(taskStates, {
    fields: [tasks.stateId],
    references: [taskStates.id],
  }),
  createdBy: one(users, {
    fields: [tasks.createdBy],
    references: [users.id],
  }),
  agent: one(workspaceAgents, {
    fields: [tasks.agentId],
    references: [workspaceAgents.id],
  }),
  assignees: many(taskAssignees),
  labels: many(taskLabels),
  comments: many(comments),
  events: many(taskEvents),
  externalLinks: many(externalLinks),
}));

// Task assignee relations
export const taskAssigneesRelations = relations(taskAssignees, ({ one }) => ({
  task: one(tasks, {
    fields: [taskAssignees.taskId],
    references: [tasks.id],
  }),
  user: one(users, {
    fields: [taskAssignees.userId],
    references: [users.id],
  }),
}));

// Label relations
export const labelsRelations = relations(labels, ({ one, many }) => ({
  project: one(projects, {
    fields: [labels.projectId],
    references: [projects.id],
  }),
  taskLabels: many(taskLabels),
}));

// Task label relations
export const taskLabelsRelations = relations(taskLabels, ({ one }) => ({
  task: one(tasks, {
    fields: [taskLabels.taskId],
    references: [tasks.id],
  }),
  label: one(labels, {
    fields: [taskLabels.labelId],
    references: [labels.id],
  }),
}));

// External link relations
export const externalLinksRelations = relations(externalLinks, ({ one }) => ({
  integration: one(projectIntegrations, {
    fields: [externalLinks.integrationId],
    references: [projectIntegrations.id],
  }),
  task: one(tasks, {
    fields: [externalLinks.taskId],
    references: [tasks.id],
  }),
}));

// Task event relations
export const taskEventsRelations = relations(taskEvents, ({ one }) => ({
  task: one(tasks, {
    fields: [taskEvents.taskId],
    references: [tasks.id],
  }),
  actor: one(users, {
    fields: [taskEvents.actorId],
    references: [users.id],
  }),
}));

// Comment relations
export const commentsRelations = relations(comments, ({ one }) => ({
  task: one(tasks, {
    fields: [comments.taskId],
    references: [tasks.id],
  }),
  user: one(users, {
    fields: [comments.userId],
    references: [users.id],
  }),
  agent: one(workspaceAgents, {
    fields: [comments.agentId],
    references: [workspaceAgents.id],
  }),
}));

// Smart view relations
export const smartViewsRelations = relations(smartViews, ({ one, many }) => ({
  workspace: one(workspaces, {
    fields: [smartViews.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [smartViews.createdBy],
    references: [users.id],
  }),
  shares: many(smartViewShares),
  publicShares: many(publicShares),
}));

// Smart view share relations
export const smartViewSharesRelations = relations(smartViewShares, ({ one }) => ({
  smartView: one(smartViews, {
    fields: [smartViewShares.smartViewId],
    references: [smartViews.id],
  }),
  sharedWithUser: one(users, {
    fields: [smartViewShares.sharedWithUserId],
    references: [users.id],
  }),
}));

// Public share relations
export const publicSharesRelations = relations(publicShares, ({ one }) => ({
  smartView: one(smartViews, {
    fields: [publicShares.smartViewId],
    references: [smartViews.id],
  }),
  createdBy: one(users, {
    fields: [publicShares.createdBy],
    references: [users.id],
  }),
}));

// Agent relations
export const agentsRelations = relations(agents, ({ one }) => ({
  workspace: one(workspaces, {
    fields: [agents.workspaceId],
    references: [workspaces.id],
  }),
  createdBy: one(users, {
    fields: [agents.createdBy],
    references: [users.id],
  }),
}));

// User API key relations
export const userApiKeysRelations = relations(userApiKeys, ({ one }) => ({
  user: one(users, {
    fields: [userApiKeys.userId],
    references: [users.id],
  }),
}));

// Session relations
export const sessionsRelations = relations(sessions, ({ one }) => ({
  user: one(users, {
    fields: [sessions.userId],
    references: [users.id],
  }),
}));

// Account relations
export const accountsRelations = relations(accounts, ({ one }) => ({
  user: one(users, {
    fields: [accounts.userId],
    references: [users.id],
  }),
}));

// GitHub installation relations
export const githubInstallationsRelations = relations(githubInstallations, ({ one }) => ({
  user: one(users, {
    fields: [githubInstallations.userId],
    references: [users.id],
  }),
}));
