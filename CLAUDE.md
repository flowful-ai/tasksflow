# FlowTask - Claude Code Context

Context for coding agents working on the FlowTask codebase. `AGENTS.md` (root and per directory) holds the hard rules; this file explains how the system fits together.

## Project Overview

FlowTask is a kanban task manager for small dev teams and their AI agents. It is a TypeScript monorepo on **Bun** with:

- **Kanban boards** with drag and drop, sub-tasks, task relations, bulk actions and per-task history
- **Smart Views**: saved filtered views, with public shares (optional password)
- **Inbox** with @mentions, assignment, status and due-date notifications
- **Search** (⌘K command palette, Postgres full-text search) and keyboard shortcuts (`?` opens the sheet)
- **Trash** with restore; trashed tasks are purged after 30 days
- **GitHub App integration (two-way)**: issues and PRs sync into tasks; task edits and comments sync back to GitHub
- **Slack integration**: notifications only
- **Outgoing webhooks** signed with HMAC-SHA256
- **MCP server** (Streamable HTTP, OAuth 2.1) so Claude, Cursor and other MCP clients can work on tasks
- **In-app AI chat** using workspace API keys, with user approval for tool calls that change data

## Runtime: Bun

- Use `bun`, never `node`/`npm`/`npx` (`bunx` is fine for CLIs such as `drizzle-kit`).
- TypeScript runs directly; the API is bundled with `bun build` for production.
- Bun version: `>=1.3.0` (`packageManager` pins `bun@1.3.11`; CI and the Dockerfile use 1.3.11).
- There is no turbo: root scripts use `bun run --filter <package> <script>`.

## Architecture

### Layout

```
flowtask/
├── apps/
│   ├── api/                  # @flowtask/api: Hono on Bun (port 3001)
│   │   ├── src/
│   │   │   ├── index.ts      # boot: migrations, Bun.serve, SSE, background, shutdown
│   │   │   ├── app.ts        # createApp(): middleware, health, routers, SPA fallback
│   │   │   ├── db/           # Drizzle schema, relations, client, migration runner
│   │   │   ├── domain/       # business logic services, domain event bus, jobs queue
│   │   │   ├── auth/         # Better Auth config, session middleware, role permissions
│   │   │   ├── integrations/ # GitHub App and Slack clients, shared integration plumbing
│   │   │   ├── services/     # agent tool runtime, MCP OAuth server, GitHub install/link
│   │   │   ├── routes/       # Hono routers, one file per area
│   │   │   ├── sse/          # realtime hub (SSE + Postgres LISTEN/NOTIFY)
│   │   │   ├── background/   # domain-event bridges and job runner wiring
│   │   │   ├── lib/          # authorize guards, responses, MCP helpers, SPA, shutdown
│   │   │   └── test/         # integration harness and bun test preload
│   │   ├── drizzle/          # generated SQL migrations + meta/ snapshots
│   │   ├── drizzle.config.ts
│   │   ├── scripts/          # rekey-positions.ts, list-routes.ts
│   │   └── Dockerfile        # the one production image (API + SPA + migrations)
│   └── web/                  # @flowtask/web: React + Vite SPA (dev server port 3000)
└── packages/
    └── shared/               # @flowtask/shared: Zod schemas, types, constants, utils
```

### Package dependencies

```
apps/api  ──> @flowtask/shared
apps/web  ──> @flowtask/shared
```

`packages/shared` has no workspace dependencies and no build step: its `exports` point at the TypeScript source, which Bun (API, tests) and Vite/tsc (web) read directly.

### One process in production

The API container serves everything: the JSON API, SSE, MCP, OAuth and the built SPA (`WEB_DIST_DIR`, `/app/public` in the image). On boot it applies pending migrations under a Postgres advisory lock (`RUN_MIGRATIONS`, default true), repairs invalid task position keys in the background, then starts serving. Postgres is the only other service. There is no Redis, no websocket server, no nginx and no separate migrate container.

In development, `bun run dev` starts the API on 3001 and Vite on 3000. Vite proxies `/api` and `/.well-known` to the API, so open http://localhost:3000.

## Key Design Decisions

### GitHub sync is two-way

- **GitHub → FlowTask**: webhooks (`POST /api/webhooks/github`, verified with `GITHUB_WEBHOOK_SECRET`) and manual syncs create and update tasks from issues and PRs, deduplicated on `X-GitHub-Delivery`. Closed/reopened issues move the task to the first done/backlog state; merged PRs move linked tasks to done.
- **FlowTask → GitHub**: title, description, state, priority and label changes on a task linked to a GitHub issue, and new comments, are pushed back by the reverse sync (`apps/api/src/integrations/github/reverse-sync.ts`) as durable jobs. Writes that came from GitHub carry `origin: 'github'` and are never pushed back; a content hash (`external_links.sync_hash`) guards against echo loops.
- Installing the App requires proof: a session-bound state nonce plus the user-authorization code, checked against `GET /user/installations` (`apps/api/src/services/github-install-service.ts`).
- **Slack** is notifications only (FlowTask → Slack). Slash commands reply with help text; Slack events are acknowledged and ignored.

### Domain events drive side effects

Every write path (REST routes, MCP and in-app agent tools, bulk, trash, GitHub sync, invitations) goes through the domain services (`TaskService`, `CommentService`, `ProjectService`, `WorkspaceService`, `InvitationService`), which emit on `domainEvents` (`apps/api/src/domain/events/bus.ts`) after the transaction commits. `apps/api/src/background/domain-bridges.ts` subscribes once and turns events into SSE messages (with an explicit scope: a project, or `'workspace'`), realtime access refreshes, Slack notifications and GitHub reverse sync; the notification and outgoing-webhook subscribers live in `apps/api/src/domain/`. Do not call `publishEvent`, `notifyAccessChanged`, Slack or GitHub by hand from a route, tool or integration.

Domain events: `task.created`, `task.updated`, `task.moved`, `task.deleted`, `task.restored`, `tasks.rekeyed`, `comment.created`, `comment.updated`, `comment.deleted`, `project.updated`, `member.joined`, `member.left`, `member.role_changed`, `workspace.deleted`.

### Fractional positions

Task order within a column uses fractional-indexing keys (`packages/shared/src/utils/lexicographic.ts`, built on the `fractional-indexing` package). Keys must sort byte-wise, so `tasks.position` is `COLLATE "C"` (set in migration `0016_v2.sql`) and queries order by `position COLLATE "C", id`. The server computes keys from `afterTaskId`/`beforeTaskId` under a per-column advisory lock and re-keys a column when a neighbour key is invalid. `bun run db:rekey` re-keys columns by hand.

### Filter engine

Smart Views store a JSON filter that `apps/api/src/domain/smart-view/filter-engine.ts` compiles to SQL through an allow-list (`FIELD_MAP`):

```typescript
{
  operator: "AND",
  conditions: [
    { field: "assignee_id", op: "eq", value: "{{current_user}}" },
    { field: "state.category", op: "in", value: ["backlog", "in_progress"] },
    { field: "due_date", op: "lt", value: "{{now + 7d}}" }
  ]
}
```

### Realtime (SSE)

- One stream per tab: `GET /api/events/stream?workspaceId=<id>` (session cookie). Same port as the API.
- `apps/api/src/sse/hub.ts` keeps each client's role and accessible project ids, and only writes events for projects the user can access. Every `publishEvent` call names its scope (`{ projectId }` or `'workspace'`); the hub never guesses it from the payload. Sessions and membership are re-checked every 60 s; removing a member closes their streams at once.
- Cross-instance fan-out uses Postgres `LISTEN` on a dedicated connection (`apps/api/src/sse/postgres-transport.ts`) and `NOTIFY` through the app pool. Payloads over about 7 KB are sent as ids only.
- User-targeted events (`publishUserEvent`, for example `notification:created`) reach every stream of that user.
- Client event names are in `REALTIME_EVENTS` (`packages/shared/src/constants.ts`), e.g. `task:created`, `task:moved`, `tasks:rekeyed`.

### Jobs queue (Postgres)

`apps/api/src/domain/jobs/` is a queue on the `jobs` table: claims with `FOR UPDATE SKIP LOCKED`, exponential backoff (5 s doubling, capped at 1 h), stale-lock reclaim, keyed singletons and recurring jobs. Job types:

| Job                                                       | Kind                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------- |
| `notifications.due_scan`                                  | recurring, hourly: due-soon and overdue reminders             |
| `tasks.trash_purge`                                       | recurring, daily: deletes tasks trashed more than 30 days ago |
| `webhooks.deliver`                                        | outgoing webhook delivery                                     |
| `webhooks.delivery_cleanup`                               | recurring, daily: prunes old delivery rows                    |
| `jobs.cleanup`                                            | recurring, daily: prunes finished jobs                        |
| `github.reverse_sync.task`, `github.reverse_sync.comment` | FlowTask → GitHub                                             |
| `slack.notify_task_event`                                 | Slack notification                                            |

`JOBS_DISABLED=true` turns the runner off in a process (integration work then runs in-process with retries).

### Authorization

`AuthorizationService` (`apps/api/src/domain/workspace/authorization.ts`) resolves workspace membership, the project ACL (`projects.access`: `all`, `members`, `admin`, plus `project_members`) and the role permission (`apps/api/src/auth/permissions.ts`; roles `owner`, `admin`, `member`). Routes use the guards in `apps/api/src/lib/authorize.ts` (`requireUser`, `requireWorkspace`, `requireProject`, `requireTask`, `requireSmartView`), which throw `AppError` (401/403/404). Resources the caller may not know about return 404, not 403.

### MCP and agent tools

- MCP endpoint: `/api/mcp` (Streamable HTTP, stateless, POST only), with `/api/mcp/sse` as an alias for already-configured clients.
- Auth is OAuth 2.1 only: Authorization Code + PKCE (S256), dynamic client registration, refresh token rotation with reuse detection, and RFC 8707 resource binding. Only workspace `owner` and `admin` roles can authorize. There are no static bearer tokens.
- Metadata: `/.well-known/oauth-protected-resource/api/mcp` (and `/api/mcp/sse`), `/.well-known/oauth-authorization-server`, `/api/mcp/.well-known/oauth-authorization-server`.
- Tools are defined once in `AGENT_TOOLS` (`apps/api/src/domain/agent/tools.ts`) and run through `executeAgentTool` in `apps/api/src/services/agent-tool-runtime.ts`, shared by MCP and the in-app chat. Text written by users or synced from GitHub is wrapped as `{ "untrusted_text": "..." }` in tool output.
- The in-app chat (`POST /api/agents/:agentId/execute`) uses the workspace's OpenRouter key (OpenAI, Anthropic and Google keys are also accepted); mutating tools need user approval in the UI.

### Response format

```typescript
{ success: true, data: T, meta?: {...} }
{ success: false, error: { code: string, message: string } }
```

`handleRouteError` (`apps/api/src/lib/responses.ts`) keeps `AppError` status codes and hides internal errors behind a generic 500.

## Database Schema

Defined in `apps/api/src/db/schema.ts` (relations in `apps/api/src/db/relations.ts`).

| Table                                                                                                                             | Purpose                                                                                    |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `users`                                                                                                                           | User accounts (`app_role`: `user` or `app_manager`)                                        |
| `sessions`, `accounts`, `verification_tokens`                                                                                     | Better Auth sessions, linked social/password accounts, verification tokens                 |
| `auth_rate_limits`                                                                                                                | Better Auth rate-limit counters, shared across replicas                                    |
| `workspaces`                                                                                                                      | Top-level organisation                                                                     |
| `workspace_members`                                                                                                               | Membership with role (`owner`, `admin`, `member`)                                          |
| `workspace_invitations`                                                                                                           | Invitations by token                                                                       |
| `projects`                                                                                                                        | Projects (identifier for `FLOW-123` keys, `access` mode, `next_task_seq`)                  |
| `project_members`                                                                                                                 | Project ACL for `members`-only projects                                                    |
| `project_integrations`                                                                                                            | GitHub/Slack configuration per project                                                     |
| `task_states`                                                                                                                     | Kanban columns (`category`: `backlog`, `in_progress`, `done`)                              |
| `tasks`                                                                                                                           | Tasks (priority, position, parent, soft delete, `completed_at`, generated `search_vector`) |
| `task_assignees`                                                                                                                  | Task ↔ user                                                                                |
| `labels`, `task_labels`                                                                                                           | Project labels and task ↔ label                                                            |
| `task_relations`                                                                                                                  | `blocks`, `relates`, `duplicates`                                                          |
| `task_events`                                                                                                                     | Audit log behind per-task history and the activity feed                                    |
| `comments`                                                                                                                        | Task comments (Markdown, mentions)                                                         |
| `external_links`                                                                                                                  | Task ↔ GitHub issue/PR (`external_id` is `owner/repo#N`)                                   |
| `smart_views`, `smart_view_shares`                                                                                                | Saved views and per-user shares                                                            |
| `public_shares`, `public_share_password_attempts`                                                                                 | Public share tokens and password attempt counters                                          |
| `notifications`                                                                                                                   | Inbox                                                                                      |
| `agents`                                                                                                                          | In-app AI agent configurations                                                             |
| `workspace_api_keys`                                                                                                              | Encrypted AI provider keys (OpenRouter, OpenAI, Anthropic, Google)                         |
| `mcp_oauth_clients`, `mcp_oauth_consents`, `mcp_oauth_authorization_codes`, `mcp_oauth_access_tokens`, `mcp_oauth_refresh_tokens` | MCP OAuth server                                                                           |
| `github_installations`                                                                                                            | GitHub App installations verified for a user                                               |
| `webhook_deliveries`                                                                                                              | Processed GitHub delivery ids (dedupe, 7-day retention)                                    |
| `integration_oauth_states`                                                                                                        | Session-bound state nonces for GitHub/Slack installs                                       |
| `jobs`                                                                                                                            | Postgres job queue                                                                         |
| `outgoing_webhooks`, `outgoing_webhook_deliveries`                                                                                | Outgoing webhooks and their delivery log                                                   |
| `rate_limit_counters`                                                                                                             | Fixed-window rate limits (UNLOGGED)                                                        |

## Code Conventions

### TypeScript

- Strict mode.
- **Never use `unknown` or `any` types**: use typed interfaces, type guards or generics. ESLint enforces `@typescript-eslint/no-explicit-any` as an error (`eslint.config.mjs`, typescript-eslint type-checked rules); `unknown` is a review rule, so narrow it at the boundary with a type guard when a library hands you one.
- When narrowing, write type guards (`function isX(val): val is X`) instead of type assertions.
- Zod for runtime validation; shared schemas live in `packages/shared/src/types/`.
- Explicit types on function signatures. `type` for object shapes, `interface` for extendable contracts.
- Relative imports use `.js` extensions.
- Prettier formats the repo (`bun run format`); CI runs `bun run format:check` and `bun run lint`.

### API routes

- Routers live in `apps/api/src/routes/` and are mounted in `apps/api/src/app.ts`. Routers mounted before `app.use('/api/*', authMiddleware)` handle their own auth.
- Validate with `zValidator` and shared Zod schemas, authorize with the `require*` guards, delegate to a domain service, return `{ success: true, data }`.
- Keep handlers thin; business logic goes in `apps/api/src/domain/`.

```typescript
// apps/api/src/routes/projects.ts
projects.get('/:projectId', async (c) => {
  const { project } = await requireProject(c, c.req.param('projectId'), 'project:read');
  const full = fromResult(await projectService.getById(project.id), {
    code: 'FETCH_FAILED',
    message: 'Failed to load project',
  });
  return c.json({ success: true, data: full });
});
```

### Domain services

- Classes constructed with the Drizzle client (`new TaskService(db)`), returning `Result<T, E>` (`ok`/`err` from `@flowtask/shared`).
- Emit domain events after commit; `TaskService.transaction()` groups several task writes and emits once committed.

### Frontend

- React function components, Zustand stores (`apps/web/src/stores/`), TanStack Query hooks (`apps/web/src/hooks/queries/`), API client in `apps/web/src/api/`.
- Tailwind CSS. The SPA runs under a strict CSP (no inline styles or scripts).
- Component files use PascalCase: `GroupedKanbanBoard.tsx`.
- Import zod-free subpaths of `@flowtask/shared` (`/constants`, `/utils`, `/json`) where you can; `/types` pulls in zod.

## Common Tasks

### Adding an API endpoint

1. Add the request schema to `packages/shared/src/types/` and export it.
2. Add the service method in `apps/api/src/domain/<area>/service.ts`.
3. Add the handler in `apps/api/src/routes/<area>.ts` (guard, validate, delegate). New routers are mounted in `apps/api/src/app.ts`.
4. Add the client call in `apps/web/src/api/` and a query hook in `apps/web/src/hooks/queries/`.
5. Regenerate `docs/api.md` from `bun apps/api/scripts/list-routes.ts`.

### Adding a table or column

1. Edit `apps/api/src/db/schema.ts` (and `apps/api/src/db/relations.ts`).
2. Run `bun run db:generate`. Commit the single generated migration in `apps/api/drizzle/` with its `meta/` snapshot. Never hand-edit SQL or `meta/`.
3. Run `bun run db:migrate` (or just restart `bun run dev`: the API migrates on boot).
4. CI's `migration drift` job runs `drizzle-kit generate` and fails if it produces anything, so schema and migrations must match.

### Adding an MCP tool

1. Add the name to `AgentToolSchema` in `packages/shared/src/types/agent.ts`.
2. Add the definition (description, JSON Schema `parameters`, `outputSchema`, `annotations` with an honest `readOnlyHint`/`destructiveHint`) to `AGENT_TOOLS` in `apps/api/src/domain/agent/tools.ts`.
3. Add its permission to `TOOL_PERMISSIONS` in `apps/api/src/lib/mcp/tool-permissions.ts`.
4. Implement the handler in `apps/api/src/services/agent-tools/task-tools.ts` or `workspace-tools.ts`. Resolve every id through the `ToolContext` and wrap user-written text with `untrusted()`. `executeAgentTool` picks it up for both MCP and the in-app chat.
5. Add the label to `AGENT_TOOL_LABELS` in `apps/web/src/lib/agent-tools.ts` (settings and the chat's "Using …" line read it).
6. Run `bun test apps/api/src/domain/agent/types.test.ts` (AGENT_TOOLS ↔ AgentToolSchema parity) and `bun test apps/api/src/services/agent-tool-runtime.test.ts`.

The `Record<AgentTool, …>` types make steps 3–5 compile errors when skipped.

### Adding a Smart View filter field

1. Add the field to `FIELD_MAP` in `apps/api/src/domain/smart-view/filter-engine.ts` and a case in `filter-engine.test.ts`.
2. Add it to the filter builder in `apps/web/src/components/smart-views/filter-builder/` (`constants.ts`, `FilterValueInput.tsx`).

### Adding an integration

Integrations live in `apps/api/src/integrations/<name>/` and are exported from `apps/api/src/integrations/index.ts`; there is no provider registry. Webhook receivers go in `apps/api/src/routes/webhooks.ts`, background work goes through `scheduleBackgroundJob`/`registerBackgroundJob` (`apps/api/src/integrations/background.ts`), and the settings UI is in `apps/web/src/components/settings/IntegrationSettings.tsx`.

## Testing

Test files sit next to the code (`service.ts` → `service.test.ts`).

```bash
bun run test                  # every suite; database suites skip themselves
TEST_DATABASE_URL=postgresql://flowtask:flowtask@localhost:5432/flowtask_test \
  bun run test:integration    # apps/api suites against a real Postgres
bun test apps/api/src/domain/smart-view   # one directory
```

- `bunfig.toml` preloads `apps/api/src/test/preload.ts`: with `TEST_DATABASE_URL` set it applies the migrations once before any suite runs.
- `apps/api/src/test/harness.ts` mounts `createApp()` with real Better Auth sessions and truncates and re-seeds the database for each suite. Never point `TEST_DATABASE_URL` at a database you care about.
- Create the test database once: `docker compose exec postgres createdb -U flowtask flowtask_test`.

## Debugging

- **API**: logs go to stdout (`bun run dev`, or `docker compose logs -f tasksflow-api` in production). `GET /health` (database reachable) and `GET /ready` (and not draining).
- **Database**: `bun run db:studio`, or `docker compose exec postgres psql -U flowtask flowtask`.
- **Jobs**: `SELECT type, attempts, last_error, run_at FROM jobs WHERE done_at IS NULL ORDER BY run_at;`
- **Realtime**: the browser's EventSource on `/api/events/stream`; the API logs `SSE manager initialized with Postgres LISTEN/NOTIFY` at boot. `initSSE()` resolves the URL like the pool (`resolveDatabaseUrl()`: `DATABASE_URL`, else built from `POSTGRES_*`); with neither it logs `no database URL configured; realtime events stay on this instance` and there is no cross-instance fan-out. `NOTIFY` goes through the shared app pool, so the `LISTEN` connection is the only extra one per instance.
- **Frontend**: React DevTools, the Network tab, Zustand stores.

## Environment Setup

```bash
docker compose up -d   # Postgres 16 on 127.0.0.1:5432 (flowtask/flowtask)
cp .env.example .env   # set BETTER_AUTH_SECRET, API_KEY_ENCRYPTION_KEY, an OAuth provider
bun install
bun run dev            # API :3001 (migrates on boot) + web :3000
```

Sign-up is GitHub/Google only, so local login needs `GITHUB_CLIENT_ID`/`GITHUB_CLIENT_SECRET` (callback `http://localhost:3001/api/auth/callback/github`) or the Google pair, plus `VITE_GITHUB_CLIENT_ID`/`VITE_GOOGLE_CLIENT_ID` to show the button. Every variable is documented in `.env.example` and the README.

## Important Files

| File                                                                 | Purpose                                                                   |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `apps/api/src/index.ts`                                              | Boot: migrations, `Bun.serve`, SSE, background, graceful shutdown         |
| `apps/api/src/app.ts`                                                | `createApp()`: middleware, health, discovery, router mounts, SPA fallback |
| `apps/api/src/db/schema.ts`                                          | All tables                                                                |
| `apps/api/src/domain/task/service.ts`                                | Core task logic (transactions, positions, events)                         |
| `apps/api/src/domain/workspace/authorization.ts`                     | `AuthorizationService`                                                    |
| `apps/api/src/lib/authorize.ts`                                      | Route guards                                                              |
| `apps/api/src/domain/smart-view/filter-engine.ts`                    | JSON filter → SQL                                                         |
| `apps/api/src/background/domain-bridges.ts`                          | Domain events → SSE, Slack, GitHub                                        |
| `apps/api/src/sse/hub.ts`                                            | Realtime hub                                                              |
| `apps/api/src/domain/jobs/runner.ts`                                 | Job runner                                                                |
| `apps/api/src/domain/agent/tools.ts`                                 | `AGENT_TOOLS`                                                             |
| `apps/api/src/services/agent-tool-runtime.ts`                        | `executeAgentTool`                                                        |
| `apps/api/src/routes/mcp-sse.ts`, `apps/api/src/routes/mcp-oauth.ts` | MCP server and OAuth endpoints                                            |
| `apps/api/src/integrations/github/`                                  | GitHub App sync and reverse sync                                          |
| `apps/web/src/components/task-display/GroupedKanbanBoard.tsx`        | Kanban board                                                              |
| `apps/web/src/stores/workspace.ts`                                   | Workspace/project state                                                   |

## Quick Reference

```bash
bun install
bun run dev              # API + web
bun run build            # web, then API bundle
bun run typecheck
bun run lint             # ESLint
bun run format           # Prettier write
bun run format:check
bun run test
bun run test:integration # needs TEST_DATABASE_URL

bun run db:generate      # migration from schema.ts
bun run db:migrate       # apply migrations
bun run db:studio
bun run db:rekey         # re-key task positions (see apps/api/scripts/rekey-positions.ts)

bun apps/api/scripts/list-routes.ts   # route table for docs/api.md

docker compose up -d     # dev Postgres
docker compose down
```

More: `docs/architecture.md`, `docs/api.md`, `docs/mcp.md`, `docs/deploy.md`.
