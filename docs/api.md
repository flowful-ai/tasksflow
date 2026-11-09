# HTTP API reference

Every endpoint the API serves, generated from the route files with:

```bash
bun apps/api/scripts/list-routes.ts > /tmp/routes.md   # Markdown tables, grouped by route file
bun apps/api/scripts/list-routes.ts --tsv              # one route per line
```

Re-run it after changing routes and paste the tables below the "Endpoints" heading. The script reads `apps/api/src/app.ts` (mount prefixes, and whether a router is mounted before the session middleware) and each router in `apps/api/src/routes/`. Its columns are heuristics over the source:

- **Auth**: `session` = a Better Auth session cookie (sign in through `/api/auth/*`); `none` = public; `MCP OAuth bearer` = an MCP access token (see [mcp.md](mcp.md)); `signature (HMAC)` = verified webhook signature; `session (app manager)` = an app manager account.
- **Permission**: the workspace permission the handler checks (`auth/permissions.ts`), `smart view <action>` for smart-view access rules, `owner or admin` for role checks, `gone (410)` for removed endpoints. `-` means only authentication (or ownership of the resource, such as your own notifications) is checked; the project ACL applies on top wherever a project or task is involved.
- **Body**: the Zod schema the JSON body is validated with (most live in `packages/shared/src/types/`).

## Conventions

- Base URL: the app's origin (`BETTER_AUTH_URL`); in development, `http://localhost:3001` or through the Vite proxy on `http://localhost:3000`.
- Success: `{ "success": true, "data": ..., "meta"?: {...} }`. Errors: `{ "success": false, "error": { "code": "NOT_FOUND", "message": "..." } }` with the HTTP status (400 validation, 401 unauthenticated, 403 forbidden, 404 not found or not visible to you, 413 body too large, 429 rate limited, 500 internal).
- Resources in another workspace, or in a project you cannot access, return 404.
- Lists are paginated with `page`/`limit` (default 50, maximum 100) or a `cursor`, depending on the endpoint.
- Request bodies are limited to 1 MB (5 MB under `/api/webhooks/`).
- The MCP, OAuth and Better Auth endpoints follow their own protocols and response formats.
- Realtime: `GET /api/events/stream?workspaceId=<id>` is a `text/event-stream`; event names are in `REALTIME_EVENTS` (`packages/shared/src/constants.ts`).

## Endpoints

### `app.ts`

| Method | Path                                                | Auth | Permission | Body |
| ------ | --------------------------------------------------- | ---- | ---------- | ---- |
| GET    | `/health`                                           | none | -          | -    |
| GET    | `/ready`                                            | none | -          | -    |
| GET    | `/`                                                 | none | -          | -    |
| GET    | `/.well-known/oauth-protected-resource/api/mcp`     | none | -          | -    |
| GET    | `/.well-known/oauth-protected-resource/api/mcp/sse` | none | -          | -    |
| GET    | `/.well-known/oauth-protected-resource`             | none | -          | -    |
| GET    | `/.well-known/oauth-authorization-server`           | none | -          | -    |

### `routes/auth.ts`

| Method | Path          | Auth        | Permission | Body |
| ------ | ------------- | ----------- | ---------- | ---- |
| ALL    | `/api/auth/*` | Better Auth | -          | -    |

### `routes/public.ts`

| Method | Path                              | Auth                                  | Permission | Body                |
| ------ | --------------------------------- | ------------------------------------- | ---------- | ------------------- |
| GET    | `/api/public/share/:token`        | none (share token, optional password) | -          | -                   |
| POST   | `/api/public/share/:token/verify` | none (share token, optional password) | -          | `inline zod schema` |

### `routes/webhooks.ts`

| Method | Path                        | Auth             | Permission                    | Body |
| ------ | --------------------------- | ---------------- | ----------------------------- | ---- |
| POST   | `/api/webhooks/github`      | signature (HMAC) | -                             | -    |
| POST   | `/api/webhooks/slack`       | signature (HMAC) | -                             | -    |
| GET    | `/api/webhooks/slack/oauth` | session          | `project:manage_integrations` | -    |

### `routes/github.ts`

| Method | Path                                                | Auth                        | Permission                                    | Body                         |
| ------ | --------------------------------------------------- | --------------------------- | --------------------------------------------- | ---------------------------- |
| GET    | `/api/github/callback`                              | session (OAuth state nonce) | -                                             | -                            |
| GET    | `/api/github/installations/:installationId/repos`   | session                     | -                                             | -                            |
| GET    | `/api/github/my-installations`                      | session                     | -                                             | -                            |
| GET    | `/api/github/:projectId/github`                     | session                     | `project:read`, `project:manage_integrations` | -                            |
| POST   | `/api/github/:projectId/github/install/start`       | session                     | `project:manage_integrations`                 | -                            |
| POST   | `/api/github/:projectId/github/install`             | session                     | -                                             | `InstallBodySchema`          |
| POST   | `/api/github/:projectId/github/link`                | session                     | `project:manage_integrations`                 | `LinkGitHubRepositorySchema` |
| DELETE | `/api/github/:projectId/github/link`                | session                     | `project:manage_integrations`                 | -                            |
| POST   | `/api/github/:projectId/github/sync`                | session                     | `project:manage_integrations`                 | `GitHubRepoRefSchema`        |
| GET    | `/api/github/:projectId/slack`                      | session                     | `project:read`                                | -                            |
| POST   | `/api/github/:projectId/slack/install/start`        | session                     | `project:manage_integrations`                 | -                            |
| GET    | `/api/github/:projectId/slack/channels`             | session                     | `project:manage_integrations`                 | -                            |
| PATCH  | `/api/github/:projectId/slack`                      | session                     | `project:manage_integrations`                 | `JSON (parsed in handler)`   |
| DELETE | `/api/github/:projectId/slack`                      | session                     | `project:manage_integrations`                 | -                            |
| GET    | `/api/projects/installations/:installationId/repos` | session                     | -                                             | -                            |
| GET    | `/api/projects/my-installations`                    | session                     | -                                             | -                            |
| GET    | `/api/projects/:projectId/github`                   | session                     | `project:read`, `project:manage_integrations` | -                            |
| POST   | `/api/projects/:projectId/github/install/start`     | session                     | `project:manage_integrations`                 | -                            |
| POST   | `/api/projects/:projectId/github/install`           | session                     | -                                             | `InstallBodySchema`          |
| POST   | `/api/projects/:projectId/github/link`              | session                     | `project:manage_integrations`                 | `LinkGitHubRepositorySchema` |
| DELETE | `/api/projects/:projectId/github/link`              | session                     | `project:manage_integrations`                 | -                            |
| POST   | `/api/projects/:projectId/github/sync`              | session                     | `project:manage_integrations`                 | `GitHubRepoRefSchema`        |
| GET    | `/api/projects/:projectId/slack`                    | session                     | `project:read`                                | -                            |
| POST   | `/api/projects/:projectId/slack/install/start`      | session                     | `project:manage_integrations`                 | -                            |
| GET    | `/api/projects/:projectId/slack/channels`           | session                     | `project:manage_integrations`                 | -                            |
| PATCH  | `/api/projects/:projectId/slack`                    | session                     | `project:manage_integrations`                 | `JSON (parsed in handler)`   |
| DELETE | `/api/projects/:projectId/slack`                    | session                     | `project:manage_integrations`                 | -                            |

### `routes/invitations.ts`

| Method | Path                                                     | Auth                    | Permission                 | Body                     |
| ------ | -------------------------------------------------------- | ----------------------- | -------------------------- | ------------------------ |
| GET    | `/api/invitations/:token`                                | none (invitation token) | -                          | -                        |
| POST   | `/api/workspaces/:workspaceId/invitations`               | session                 | `workspace:manage_members` | `CreateInvitationSchema` |
| GET    | `/api/workspaces/:workspaceId/invitations`               | session                 | `workspace:manage_members` | -                        |
| DELETE | `/api/workspaces/:workspaceId/invitations/:invitationId` | session                 | `workspace:manage_members` | -                        |
| POST   | `/api/invitations/:token/accept`                         | session                 | -                          | -                        |

### `routes/mcp-sse.ts`

| Method | Path                   | Auth             | Permission   | Body |
| ------ | ---------------------- | ---------------- | ------------ | ---- |
| ALL    | `/api/mcp`             | MCP OAuth bearer | -            | -    |
| ALL    | `/api/mcp/sse`         | MCP OAuth bearer | -            | -    |
| GET    | `/api/mcp/tools`       | MCP OAuth bearer | -            | -    |
| GET    | `/api/mcp/sse/stream`  | none             | `gone (410)` | -    |
| POST   | `/api/mcp/sse/message` | none             | `gone (410)` | -    |

### `routes/mcp-oauth.ts`

| Method | Path                                                    | Auth                  | Permission | Body                                       |
| ------ | ------------------------------------------------------- | --------------------- | ---------- | ------------------------------------------ |
| GET    | `/api/mcp/.well-known/oauth-authorization-server`       | none (OAuth endpoint) | -          | -                                          |
| GET    | `/api/mcp/oauth/token/.well-known/openid-configuration` | none (OAuth endpoint) | -          | -                                          |
| POST   | `/api/mcp/oauth/register`                               | none (OAuth endpoint) | -          | `JSON (parsed in handler)`                 |
| GET    | `/api/mcp/oauth/authorize`                              | none (OAuth endpoint) | -          | -                                          |
| POST   | `/api/mcp/oauth/authorize`                              | none (OAuth endpoint) | -          | `form (application/x-www-form-urlencoded)` |
| POST   | `/api/mcp/oauth/token`                                  | none (OAuth endpoint) | -          | `form (application/x-www-form-urlencoded)` |
| POST   | `/api/mcp/oauth/revoke`                                 | none (OAuth endpoint) | -          | `form (application/x-www-form-urlencoded)` |

### `routes/events.ts`

| Method | Path                 | Auth    | Permission | Body |
| ------ | -------------------- | ------- | ---------- | ---- |
| GET    | `/api/events/stream` | session | -          | -    |
| GET    | `/api/events/health` | none    | -          | -    |

### `routes/tasks-bulk.ts`

| Method | Path              | Auth    | Permission  | Body                    |
| ------ | ----------------- | ------- | ----------- | ----------------------- |
| POST   | `/api/tasks/bulk` | session | `task:read` | `BulkTaskRequestSchema` |

### `routes/task-relations.ts`

| Method | Path                                       | Auth    | Permission    | Body                    |
| ------ | ------------------------------------------ | ------- | ------------- | ----------------------- |
| GET    | `/api/tasks/:taskId/relations`             | session | `task:read`   | -                       |
| POST   | `/api/tasks/:taskId/relations`             | session | `task:update` | `AddTaskRelationSchema` |
| DELETE | `/api/tasks/:taskId/relations/:relationId` | session | `task:update` | -                       |

### `routes/task-history.ts`

| Method | Path                         | Auth    | Permission  | Body |
| ------ | ---------------------------- | ------- | ----------- | ---- |
| GET    | `/api/tasks/:taskId/history` | session | `task:read` | -    |

### `routes/trash.ts`

| Method | Path                                             | Auth    | Permission    | Body |
| ------ | ------------------------------------------------ | ------- | ------------- | ---- |
| GET    | `/api/projects/:projectId/trash`                 | session | `task:read`   | -    |
| POST   | `/api/projects/:projectId/trash/:taskId/restore` | session | `task:update` | -    |

### `routes/notifications.ts`

| Method | Path                               | Auth    | Permission | Body                         |
| ------ | ---------------------------------- | ------- | ---------- | ---------------------------- |
| GET    | `/api/notifications`               | session | -          | -                            |
| GET    | `/api/notifications/unread-count`  | session | -          | -                            |
| POST   | `/api/notifications/read-all`      | session | -          | `ReadAllNotificationsSchema` |
| POST   | `/api/notifications/:id/read`      | session | -          | -                            |
| POST   | `/api/notifications/:id/unread`    | session | -          | -                            |
| POST   | `/api/notifications/:id/archive`   | session | -          | -                            |
| POST   | `/api/notifications/:id/unarchive` | session | -          | -                            |
| POST   | `/api/notifications/:id/snooze`    | session | -          | `SnoozeNotificationSchema`   |

### `routes/search.ts`

| Method | Path          | Auth    | Permission  | Body |
| ------ | ------------- | ------- | ----------- | ---- |
| GET    | `/api/search` | session | `task:read` | -    |

### `routes/outgoing-webhooks.ts`

| Method | Path                                    | Auth    | Permission       | Body                          |
| ------ | --------------------------------------- | ------- | ---------------- | ----------------------------- |
| GET    | `/api/outgoing-webhooks`                | session | `owner or admin` | -                             |
| POST   | `/api/outgoing-webhooks`                | session | `owner or admin` | `CreateOutgoingWebhookSchema` |
| GET    | `/api/outgoing-webhooks/:id`            | session | `owner or admin` | -                             |
| PATCH  | `/api/outgoing-webhooks/:id`            | session | `owner or admin` | `UpdateOutgoingWebhookSchema` |
| DELETE | `/api/outgoing-webhooks/:id`            | session | `owner or admin` | -                             |
| POST   | `/api/outgoing-webhooks/:id/test`       | session | `owner or admin` | -                             |
| GET    | `/api/outgoing-webhooks/:id/deliveries` | session | `owner or admin` | -                             |

### `routes/workspaces.ts`

| Method | Path                                              | Auth    | Permission                                   | Body                    |
| ------ | ------------------------------------------------- | ------- | -------------------------------------------- | ----------------------- |
| GET    | `/api/workspaces`                                 | session | -                                            | -                       |
| POST   | `/api/workspaces`                                 | session | -                                            | `CreateWorkspaceSchema` |
| GET    | `/api/workspaces/by-slug/:slug`                   | session | `workspace:read`                             | -                       |
| GET    | `/api/workspaces/:workspaceId`                    | session | `workspace:read`                             | -                       |
| GET    | `/api/workspaces/:workspaceId/me`                 | session | `workspace:read`                             | -                       |
| GET    | `/api/workspaces/:workspaceId/activity`           | session | `project:read`                               | -                       |
| PATCH  | `/api/workspaces/:workspaceId`                    | session | `workspace:update`                           | `UpdateWorkspaceSchema` |
| DELETE | `/api/workspaces/:workspaceId`                    | session | `workspace:delete`                           | -                       |
| GET    | `/api/workspaces/:workspaceId/members`            | session | `workspace:read`                             | -                       |
| POST   | `/api/workspaces/:workspaceId/members`            | session | `workspace:manage_members`                   | `inline zod schema`     |
| POST   | `/api/workspaces/:workspaceId/transfer-ownership` | session | `workspace:read`                             | `inline zod schema`     |
| PATCH  | `/api/workspaces/:workspaceId/members/:memberId`  | session | `workspace:manage_members`                   | `inline zod schema`     |
| DELETE | `/api/workspaces/:workspaceId/members/:memberId`  | session | `workspace:manage_members`, `workspace:read` | -                       |

### `routes/projects.ts`

| Method | Path                                       | Auth    | Permission                                         | Body                             |
| ------ | ------------------------------------------ | ------- | -------------------------------------------------- | -------------------------------- |
| GET    | `/api/projects`                            | session | `project:read`                                     | -                                |
| POST   | `/api/projects`                            | session | `project:create`                                   | `CreateProjectSchema (extended)` |
| GET    | `/api/projects/:projectId`                 | session | `project:read`                                     | -                                |
| GET    | `/api/projects/:projectId/permissions`     | session | `project:read`, `project:update`, `project:delete` | -                                |
| PATCH  | `/api/projects/:projectId`                 | session | `project:update`                                   | `UpdateProjectSchema`            |
| DELETE | `/api/projects/:projectId`                 | session | `project:delete`                                   | -                                |
| GET    | `/api/projects/:projectId/states`          | session | `project:read`                                     | -                                |
| POST   | `/api/projects/:projectId/states`          | session | `project:update`                                   | `CreateTaskStateSchema`          |
| PATCH  | `/api/projects/:projectId/states/:stateId` | session | `project:update`                                   | `StateOrLabelUpdateSchema`       |
| DELETE | `/api/projects/:projectId/states/:stateId` | session | `project:update`                                   | -                                |
| POST   | `/api/projects/:projectId/labels`          | session | `project:update`                                   | `CreateLabelSchema`              |
| PATCH  | `/api/projects/:projectId/labels/:labelId` | session | `project:update`                                   | `StateOrLabelUpdateSchema`       |
| DELETE | `/api/projects/:projectId/labels/:labelId` | session | `project:update`                                   | -                                |
| GET    | `/api/projects/:projectId/members`         | session | `project:read`                                     | -                                |
| PUT    | `/api/projects/:projectId/members`         | session | `project:update`                                   | `inline zod schema`              |

### `routes/workspace-agents.ts`

| Method | Path                                    | Auth | Permission   | Body |
| ------ | --------------------------------------- | ---- | ------------ | ---- |
| ALL    | `/api/workspaces/:workspaceId/agents`   | none | `gone (410)` | -    |
| ALL    | `/api/workspaces/:workspaceId/agents/*` | none | `gone (410)` | -    |

### `routes/workspace-api-keys.ts`

| Method | Path                                              | Auth    | Permission       | Body                              |
| ------ | ------------------------------------------------- | ------- | ---------------- | --------------------------------- |
| POST   | `/api/workspaces/:workspaceId/api-keys`           | session | `owner or admin` | `inline zod schema`               |
| GET    | `/api/workspaces/:workspaceId/api-keys`           | session | `owner or admin` | -                                 |
| GET    | `/api/workspaces/:workspaceId/api-keys/:provider` | session | `owner or admin` | -                                 |
| DELETE | `/api/workspaces/:workspaceId/api-keys/:provider` | session | `owner or admin` | -                                 |
| GET    | `/api/workspaces/:workspaceId/ai-settings`        | session | `agent:execute`  | -                                 |
| PATCH  | `/api/workspaces/:workspaceId/ai-settings`        | session | `owner or admin` | `UpdateWorkspaceAiSettingsSchema` |

### `routes/mcp-connections.ts`

| Method | Path                                                             | Auth    | Permission       | Body                |
| ------ | ---------------------------------------------------------------- | ------- | ---------------- | ------------------- |
| GET    | `/api/workspaces/:workspaceId/mcp-connections`                   | session | `owner or admin` | -                   |
| PATCH  | `/api/workspaces/:workspaceId/mcp-connections/:consentId/scopes` | session | `owner or admin` | `inline zod schema` |
| DELETE | `/api/workspaces/:workspaceId/mcp-connections/:consentId`        | session | `owner or admin` | -                   |

### `routes/tasks.ts`

| Method | Path                                   | Auth    | Permission                   | Body                          |
| ------ | -------------------------------------- | ------- | ---------------------------- | ----------------------------- |
| GET    | `/api/tasks`                           | session | `task:read`                  | -                             |
| POST   | `/api/tasks`                           | session | `task:create`, `task:assign` | `CreateTaskSchema (extended)` |
| GET    | `/api/tasks/:taskId`                   | session | `task:read`                  | -                             |
| PATCH  | `/api/tasks/:taskId`                   | session | `task:update`                | `UpdateTaskSchema`            |
| POST   | `/api/tasks/:taskId/move`              | session | `task:update`                | `MoveTaskSchema`              |
| DELETE | `/api/tasks/:taskId`                   | session | `task:delete`                | -                             |
| POST   | `/api/tasks/:taskId/restore`           | session | `task:update`                | -                             |
| POST   | `/api/tasks/:taskId/assignees`         | session | `task:assign`                | `inline zod schema`           |
| DELETE | `/api/tasks/:taskId/assignees/:userId` | session | `task:assign`                | -                             |
| POST   | `/api/tasks/:taskId/labels`            | session | `task:update`                | `inline zod schema`           |
| DELETE | `/api/tasks/:taskId/labels/:labelId`   | session | `task:update`                | -                             |
| POST   | `/api/tasks/calculate-position`        | session | -                            | `inline zod schema`           |
| POST   | `/api/tasks/:taskId/github-issue`      | session | `task:update`                | `GitHubRepoRefSchema`         |
| POST   | `/api/tasks/:taskId/github-issue/link` | session | `task:update`                | `LinkTaskGitHubIssueSchema`   |
| POST   | `/api/tasks/:taskId/github-pr`         | session | `task:update`                | `LinkTaskGitHubPrSchema`      |

### `routes/comments.ts`

| Method | Path                                     | Auth    | Permission                       | Body                  |
| ------ | ---------------------------------------- | ------- | -------------------------------- | --------------------- |
| GET    | `/api/tasks/:taskId/comments`            | session | `comment:read`                   | -                     |
| GET    | `/api/tasks/:taskId/comments/count`      | session | `comment:read`                   | -                     |
| POST   | `/api/tasks/:taskId/comments`            | session | `comment:create`                 | `CreateCommentSchema` |
| GET    | `/api/tasks/:taskId/comments/:commentId` | session | `comment:read`                   | -                     |
| PATCH  | `/api/tasks/:taskId/comments/:commentId` | session | `comment:update`                 | `UpdateCommentSchema` |
| DELETE | `/api/tasks/:taskId/comments/:commentId` | session | `comment:read`, `comment:delete` | -                     |

### `routes/smart-views.ts`

| Method | Path                                               | Auth    | Permission                            | Body                               |
| ------ | -------------------------------------------------- | ------- | ------------------------------------- | ---------------------------------- |
| GET    | `/api/smart-views`                                 | session | `smart_view:read`, `smart_view:share` | -                                  |
| POST   | `/api/smart-views`                                 | session | `smart_view:create`                   | `CreateSmartViewSchema (extended)` |
| GET    | `/api/smart-views/:viewId`                         | session | `smart view read`                     | -                                  |
| GET    | `/api/smart-views/:viewId/execute`                 | session | `smart view read`                     | -                                  |
| PATCH  | `/api/smart-views/:viewId`                         | session | `smart view update`                   | `UpdateSmartViewSchema`            |
| DELETE | `/api/smart-views/:viewId`                         | session | `smart view delete`                   | -                                  |
| POST   | `/api/smart-views/:viewId/shares`                  | session | `smart view share`                    | `inline zod schema`                |
| DELETE | `/api/smart-views/:viewId/shares/:userId`          | session | `smart view share`                    | -                                  |
| POST   | `/api/smart-views/:viewId/public`                  | session | `smart view share`                    | `CreatePublicShareSchema`          |
| POST   | `/api/smart-views/:viewId/public/:shareId/disable` | session | `smart view share`                    | -                                  |
| DELETE | `/api/smart-views/:viewId/public/:shareId`         | session | `smart view share`                    | -                                  |

### `routes/agents.ts`

| Method | Path                           | Auth    | Permission      | Body                           |
| ------ | ------------------------------ | ------- | --------------- | ------------------------------ |
| GET    | `/api/agents`                  | session | `agent:read`    | -                              |
| GET    | `/api/agents/availability`     | session | `agent:execute` | -                              |
| POST   | `/api/agents`                  | session | `agent:create`  | `CreateAgentSchema (extended)` |
| GET    | `/api/agents/:agentId`         | session | `agent:read`    | -                              |
| PATCH  | `/api/agents/:agentId`         | session | `agent:update`  | `UpdateAgentSchema`            |
| DELETE | `/api/agents/:agentId`         | session | `agent:delete`  | -                              |
| POST   | `/api/agents/:agentId/execute` | session | `agent:execute` | `ExecuteAgentSchema`           |

### `routes/app-admin.ts`

| Method | Path                          | Auth                  | Permission | Body                      |
| ------ | ----------------------------- | --------------------- | ---------- | ------------------------- |
| GET    | `/api/app/me`                 | session               | -          | -                         |
| GET    | `/api/app/users`              | session (app manager) | -          | -                         |
| PATCH  | `/api/app/users/:userId/role` | session (app manager) | -          | `UpdateAppUserRoleSchema` |

163 routes.

## Notes

- `routes/github.ts` is mounted under both `/api/github` and `/api/projects`, and it mounts the Slack router (`routes/slack.ts`), so its routes answer on both prefixes. The web app uses `/api/projects/:projectId/github…`, `/api/projects/:projectId/slack…`, `/api/github/my-installations` and `/api/github/installations/:installationId/repos`.
- `POST …/github/install` and `GET /api/github/callback` check the session-bound state nonce, the user's GitHub OAuth code and `project:manage_integrations` inside `completeGitHubInstallation` (`apps/api/src/services/github-install-service.ts`), which the script does not see.
- `GET /api/github/installations/:installationId/repos` requires an installation verified for the caller; `GET /api/github/my-installations` lists only the caller's.
- Notifications, `GET /api/workspaces` and `POST /api/workspaces` act on the signed-in user's own data.
- `POST /api/workspaces/:workspaceId/transfer-ownership` additionally requires the caller to be an owner.
- `GET /` redirects GitHub installation callbacks (`?installation_id=…&setup_action=…`) to `/api/github/callback`, and otherwise serves the SPA.
- `/api/auth/*` is Better Auth (sign-in, sign-out, social callbacks at `/api/auth/callback/github` and `/api/auth/callback/google`, session, account linking); see the Better Auth documentation for its endpoints.
