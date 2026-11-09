# Architecture

FlowTask is one Bun process (`apps/api`) in front of one Postgres database. The process serves the React SPA (`apps/web`, built), the JSON API, Server-Sent Events, the MCP endpoint and the OAuth server, and runs the background job runner. `packages/shared` holds the Zod schemas, types and utilities both apps import.

```
browser ──┐                             ┌── GitHub (App API, webhooks)
MCP client ┼──> tasksflow-api :3001 ────┼── Slack (Web API)
GitHub/Slack ┘   (Hono on Bun)          ├── OpenRouter / AI providers
webhooks           │                    └── outgoing webhook receivers
                   ▼
               Postgres 16  (data, jobs, rate limits, LISTEN/NOTIFY)
```

## Boot

`apps/api/src/index.ts`:

1. warns if `API_KEY_ENCRYPTION_KEY` is a legacy (non 32-byte) key;
2. applies pending migrations under `pg_advisory_lock` (`RUN_MIGRATIONS`, `MIGRATIONS_DIR`); exits on failure;
3. starts a background scan that re-keys task columns with invalid position keys;
4. starts `Bun.serve` on `API_HOST:API_PORT` (idle timeout 255 s for SSE);
5. starts the realtime hub (`initSSE()`), then the background services (`startApiBackground()`: domain-event bridges, subscribers, job runner);
6. installs SIGTERM/SIGINT handlers for graceful shutdown (see [deploy.md](deploy.md#graceful-shutdown)).

## Request flow

Each request passes through, in order (`apps/api/src/app.ts`):

1. **Client IP**: `Bun.serve`'s fetch resolves the client IP from `X-Forwarded-For` and `TRUSTED_PROXY_HOPS` and overwrites the forwarded headers, so nothing downstream reads a spoofed value.
2. **Middleware**: request logger (redacts tokens), security headers (CSP, HSTS in production, nosniff, frame denial), CORS restricted to the trusted origins, body limit (1 MB; 5 MB under `/api/webhooks/`).
3. **Unauthenticated routes**: `/health`, `/ready`, OAuth discovery under `/.well-known/`, `/api/auth/*` (Better Auth), `/api/public/*` (public shares), `/api/webhooks/*` (signature-verified), `/api/github/callback`, `/api/invitations/:token`, `/api/mcp*` (MCP OAuth bearer and the OAuth endpoints), `/api/events/*` (checks the session itself).
4. **`authMiddleware`** on `/api/*`: loads the Better Auth session (cookie) into the context. It does not reject; handlers call `requireUser` or another guard.
5. **Router**: validates input with `zValidator` and shared Zod schemas, authorizes with a `require*` guard, calls a domain service, returns `{ success: true, data }`.
6. **Errors**: `handleRouteError` keeps `AppError` statuses (`{ success: false, error: { code, message } }`) and turns anything else into a logged, generic 500.
7. **Not found**: non-API `GET`/`HEAD` requests fall through to the SPA (`apps/api/src/lib/spa.ts`): hashed assets with a one-year immutable cache, `index.html` with `no-cache` for client routes, gzip for text assets.

The endpoint list is in [api.md](api.md).

## Authorization

`AuthorizationService` (`apps/api/src/domain/workspace/authorization.ts`) is the single place that decides access:

1. resolve the resource (task → project → workspace);
2. check workspace membership and role (`owner`, `admin`, `member`);
3. apply the project ACL: `projects.access` is `all` (every member), `members` (owners, admins and users in `project_members`) or `admin` (owners and admins);
4. check the role permission from `apps/api/src/auth/permissions.ts` (for example `task:update`, `project:manage_integrations`).

Results are discriminated unions carrying the loaded entities and role. Denials are `not_found` (the caller may not know the resource exists) or `forbidden`. Routes use the thin guards in `apps/api/src/lib/authorize.ts` (`requireWorkspace`, `requireProject`, `requireTask`, `requireSmartView`); the realtime hub and the agent tool context (`apps/api/src/lib/mcp/tool-context.ts`) use the same service, so the UI, SSE and MCP enforce identical rules. Role changes follow `apps/api/src/domain/workspace/role-policy.ts`: only owners grant, revoke or change the owner role.

App-level roles (`users.app_role`: `user`, `app_manager`) gate `/api/app/*` (user management).

## Domain events

Services emit typed events on an in-process bus (`apps/api/src/domain/events/bus.ts`) **after** their transaction commits. Listeners run asynchronously and in isolation: a failing listener is logged and never affects the write.

Events: `task.created`, `task.updated`, `task.moved`, `task.deleted`, `task.restored`, `tasks.rekeyed`, `comment.created`.

```
TaskService / CommentService ──emit after commit──> domainEvents
   │
   ├─ background/domain-bridges.ts
   │    ├─ SSE: task:created|updated|moved|deleted, tasks:rekeyed (task.restored is sent as task:created)
   │    ├─ Slack: task created, state changed, assigned, comment added  → job slack.notify_task_event
   │    └─ GitHub reverse sync (linked issues, not for origin 'github') → jobs github.reverse_sync.*
   ├─ domain/notification/subscriber.ts → inbox rows (assigned, mentioned, commented, status_changed)
   │    └─ onNotificationCreated → SSE user event notification:created
   └─ domain/webhook-out/subscriber.ts → job webhooks.deliver per matching outgoing webhook
```

Every write path (REST, bulk, trash, MCP and in-app agent tools, GitHub sync) goes through the services, so all of them produce the same side effects. Comment, project and member SSE events (`comment:*`, `project:updated`, `member:joined`, `member:left`) are the exception: the comment, project and workspace routes, the GitHub webhook processor and the agent tools publish them directly. Writes that come from GitHub carry `origin: 'github'` and are not pushed back to GitHub. `TaskService.transaction()` groups several task writes into one transaction and emits all their events once it commits.

## Jobs

The queue is the `jobs` table (`apps/api/src/domain/jobs/`):

- `enqueueJob(db, type, payload, { key, runAt })` works inside a transaction, so a job is only visible if the write that caused it commits. A `key` makes the job a singleton while pending.
- The runner (`runner.ts`) polls every second, claims up to its concurrency (4) with `FOR UPDATE SKIP LOCKED`, records `locked_by`, and reclaims locks older than 5 minutes. Failures retry with backoff `min(2^(n-1) × 5 s, 1 h)` ±20 %, up to `max_attempts` (default 5). Handlers can throw `JobRetryLater` to wait without spending an attempt.
- Recurring jobs reschedule themselves in the same transaction that completes them; `ensureRecurringJob` creates the first occurrence at boot on every replica (the unique pending key keeps one chain).

| Type                                                   | Schedule | What it does                                                                |
| ------------------------------------------------------ | -------- | --------------------------------------------------------------------------- |
| `notifications.due_scan`                               | hourly   | `due_soon` (within 24 h) and `overdue` inbox notifications                  |
| `tasks.trash_purge`                                    | daily    | deletes tasks trashed more than 30 days ago                                 |
| `webhooks.deliver`                                     | on event | signed POST to an outgoing webhook, logged in `outgoing_webhook_deliveries` |
| `webhooks.delivery_cleanup`                            | daily    | prunes old delivery rows                                                    |
| `jobs.cleanup`                                         | daily    | prunes finished jobs                                                        |
| `github.reverse_sync.task`, `.comment`, `.close_issue` | on event | FlowTask → GitHub                                                           |
| `slack.notify_task_event`                              | on event | posts to the project's Slack channel                                        |

`JOBS_DISABLED=true` stops the runner in a process; integration work then runs in-process with retries (`runInBackground`).

## Realtime

- Clients open `GET /api/events/stream?workspaceId=<id>` (EventSource, session cookie). The stream starts with `retry: 5000` and a `connected` event.
- The hub (`apps/api/src/sse/hub.ts`) stores each stream's user, session, role and accessible project ids. An event is written only to streams that can access its project (from an explicit `projectId`, `data.projectId`, `data.project.id`, or the task's project). User events go to every stream of that user.
- Every 60 s the hub re-checks sessions and memberships; removing a member or deleting a workspace closes the affected streams immediately; ACL, role and project changes refresh the access caches.
- Across instances, events go through Postgres `NOTIFY` on one channel and every instance `LISTEN`s on a dedicated connection (`apps/api/src/sse/postgres-transport.ts`), suppressing its own echoes. Payloads over about 7 KB are sent as ids only (NOTIFY's limit is 8 KB). A self-ping watchdog rebuilds a dead `LISTEN`. The transport is only created when `DATABASE_URL` is set; see the scaling note in [deploy.md](deploy.md#scaling).
- Slow consumers are dropped (more than 500 queued chunks).

## Positions

Task order inside a column is a string key from the `fractional-indexing` package (`packages/shared/src/utils/lexicographic.ts`): `positionAfter`, `positionBefore`, `positionBetween`, `generatePositions`, `comparePositions` (plain code-unit order).

- Keys are base-62 and case-sensitive, so they must compare byte-wise. `tasks.position` is `COLLATE "C"` (set by migration `0016_v2`; Drizzle cannot declare collations) and queries order by `position COLLATE "C"`, then `id`.
- Clients send `afterTaskId`/`beforeTaskId`; `TaskService` computes the key server-side under a transaction-scoped advisory lock on the column (`pg_advisory_xact_lock`, `apps/api/src/domain/task/positions.ts`), so concurrent moves cannot produce the same key.
- If a neighbour key is invalid (written by the v1 generator), the column is re-keyed in order and `tasks.rekeyed` tells clients to refetch it. The boot scan and `bun run db:rekey` (`apps/api/scripts/rekey-positions.ts`, with `--dry-run` and `--only-invalid`) re-key columns too.
- The Done column orders by `completed_at` instead.

## Integrations

- **GitHub App** (`apps/api/src/integrations/github/`): installation verified with a session-bound state nonce (`integration_oauth_states`) and the user's OAuth code checked against `GET /user/installations`. Webhooks are HMAC-verified, deduplicated on `X-GitHub-Delivery` (`webhook_deliveries`, 7 days) and applied to every project linked to the repository. Issues and PRs map to tasks through `external_links` (`owner/repo#N`); a content hash (`sync_hash`) prevents echo loops; `FLOW-123` references in PRs resolve to tasks. Reverse sync pushes title, description, state, priority, labels and comments of linked issues.
- **Slack** (`apps/api/src/integrations/slack/`): OAuth install per project (bot token encrypted with `INTEGRATION_ENCRYPTION_KEY`), notifications only.
- **AI** (`apps/api/src/routes/agents.ts`, `apps/api/src/integrations/openrouter/`): the in-app chat streams through the Vercel AI SDK with the workspace's provider key, using the tool set from `executeAgentTool`; mutating tools require approval.

## MCP

See [mcp.md](mcp.md). In short: Streamable HTTP at `/api/mcp`, OAuth 2.1 authorization server in `apps/api/src/services/mcp-oauth/`, one tool registry (`AGENT_TOOLS`) and one dispatcher (`executeAgentTool`) shared with the in-app chat.
