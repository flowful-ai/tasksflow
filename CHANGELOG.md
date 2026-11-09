# Changelog

## v2.0.0

v2 is a rewrite of the backend's security model and infrastructure, plus a redesigned web app. Upgrading a v1 installation needs manual steps: follow [docs/v2-upgrade.md](docs/v2-upgrade.md).

### Breaking changes

- **One app container.** The API serves the built SPA and applies migrations on boot. The `tasksflow-web` container, nginx, Redis, MinIO and the migrate container are gone. Route the domain to `tasksflow-api:3001`.
- **No websocket.** Realtime is Server-Sent Events at `/api/events/stream`; `VITE_WS_URL` is removed.
- **No Redis.** Realtime fan-out, rate limits and the job queue use Postgres; `REDIS_PASSWORD` is removed.
- **Social sign-up only.** Email/password sign-up is disabled; existing password accounts can still sign in and should link GitHub or Google. `APP_MANAGER_EMAILS` sets app managers (otherwise the first account is promoted).
- **GitHub App installs require user authorization.** Enable "Request user authorization (OAuth) during installation", set the callback to `<url>/api/github/callback`, and set `GITHUB_APP_CLIENT_ID`/`GITHUB_APP_CLIENT_SECRET`.
- **Slack uses OAuth installs.** `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET` replace `SLACK_APP_TOKEN`; bot tokens are stored per project, encrypted.
- **MCP is OAuth-only.** The MCP endpoint is `/api/mcp` (Streamable HTTP; `/api/mcp/sse` still works). The split SSE endpoints (`/api/mcp/sse/stream`, `/api/mcp/sse/message`), the REST tool executor and the legacy `ft_v1_*` workspace agent tokens are removed (410).
- **Task moves take neighbours, not keys.** `POST /api/tasks/:taskId/move` takes `stateId` plus optional `afterTaskId`/`beforeTaskId` and the server computes the position. A `position` field is rejected with a 400 `VALIDATION_ERROR` (it used to be accepted), and `POST /api/tasks/calculate-position` is removed.
- **Error responses** are `{ success: false, error: { code, message } }` everywhere, including 401s.
- **Migration `0016_v2`** normalises task priorities and state categories, pins `tasks.position` to `COLLATE "C"`, rewrites GitHub external ids to `owner/repo#N` and deletes ACL rows, labels and states that point across workspaces or projects. Invalid position keys are re-keyed on boot.
- **Layout.** `packages/{database,domain,auth,integrations}` moved into `apps/api/src`; migrations live in `apps/api/drizzle`. turbo is gone.

### Security fixes

- Project ACL enforced on task and comment routes; comment routes skipped it entirely.
- Task state and label updates and deletes are scoped to their project (a project admin could change other workspaces' states and labels).
- Only owners can grant, revoke or change the owner role (an admin could promote themselves and delete the workspace); new owner-only ownership transfer.
- Smart views and public shares: execution limited to the caller's accessible projects, personal views private, share password hashes and tokens no longer returned, public shares return an allow-listed DTO, password attempts counted per share and per IP.
- Tasks reject states, labels and assignees from other projects or workspaces (which leaked user profiles); malformed ids return 404.
- MCP tools scoped to the bound workspace (closes a cross-workspace task leak), per-tool role permissions, schema-validated arguments, `untrusted_text` wrapping of user and GitHub text.
- MCP OAuth server: redirects only to validated URIs, atomic code redemption (replay revokes the token family), refresh rotation with reuse detection, RFC 8707 resource binding.
- In-app chat: mutating tool calls need approval; Markdown images are never loaded.
- Auth: implicit account linking requires verified emails; trusted origins limited to `WEB_URL` and `BETTER_AUTH_URL` in production; Better Auth rate limits on in every environment and shared through Postgres.
- GitHub App installation claims verified with a session-bound state nonce and the user's OAuth code; webhooks deduplicated by delivery id and matched to the installation.
- Client IP resolved from `X-Forwarded-For` with `TRUSTED_PROXY_HOPS`; forwarded headers overwritten before routing.
- CSP for the SPA, HSTS in production, nosniff, Referrer-Policy and frame denial; 1 MB body limit (5 MB for webhooks); log redaction of tokens; generic 500s.
- Stronger `API_KEY_ENCRYPTION_KEY` handling (32-byte keys decoded, legacy keys still decrypt, with a warning).
- Dependency advisories patched (better-auth GHSA-965c-763c-88jm and others); Bun pinned to 1.3.11.

### Features

- Sub-tasks and task relations (`blocks`, `relates`, `duplicates`).
- Inbox with assignment, @mention (`@[Name](user:<uuid>)`), comment, status and due-date notifications; read, archive and snooze.
- ⌘K command palette with Postgres full-text search, recents and actions.
- Per-task history and a workspace activity feed limited to accessible projects.
- Trash with restore; tasks are purged 30 days after deletion.
- Bulk actions on up to 200 tasks (state, priority, assignees, labels, delete, restore).
- Outgoing webhooks signed with HMAC-SHA256, with delivery logs and test sends.
- Keyboard shortcuts with a `?` sheet; redesigned board, task card, task detail, sidebar, project top bar, filters and settings (including a webhooks tab and ownership transfer).
- Inbox, My tasks and Trash pages.
- Settings: the Profile tab edits your display name and lists active sessions (sign out one or all others); the Workspace tab renames the workspace (owners and admins), and its danger zone lets members leave and the owner delete the workspace.
- The Done column orders tasks by completion time (`completed_at`).
- Six new agent tools: `list_members`, `list_labels`, `list_comments`, `bulk_update_tasks`, `list_smart_views`, `run_smart_view`; task keys (`ENG-123`), `me` and email user references, state names for `move_task`, cursor pagination.
- GitHub sync is two-way: task edits and comments on linked issues are pushed back to GitHub; closed or reopened issues move tasks; merged PRs move linked tasks to done; `FLOW-123` references resolve to tasks.
- All side effects (realtime, Slack, GitHub, notifications, webhooks) follow domain events, so MCP and bulk edits behave like UI edits.

### Infrastructure

- Single Docker image (`apps/api/Dockerfile`) with the API bundle, the SPA and the migrations; migrations applied on boot under an advisory lock (`RUN_MIGRATIONS`).
- Postgres `LISTEN/NOTIFY` replaces Redis pub/sub for SSE; Postgres job queue (`FOR UPDATE SKIP LOCKED`) for reminders, GitHub sync, Slack, outgoing webhooks and trash purge; rate limits in an UNLOGGED Postgres table.
- `/health` checks the database and `/ready` reports draining; graceful shutdown on SIGTERM/SIGINT (`SHUTDOWN_TIMEOUT_MS`).
- `docker-compose.prod.yml`: Postgres with memory limits, the API, and a daily `postgres-backup-local` sidecar (7 daily, 4 weekly, 6 monthly).
- Fractional-indexing position keys with byte-order collation and automatic repair of invalid columns.
- Transactional `TaskService` (sequence numbers, column locks, events after commit).
- CI: format, ESLint (type-checked), typecheck, unit and Postgres integration tests, migration drift, build, dependency audit and Docker build. Prettier and ESLint applied to the whole repo.
