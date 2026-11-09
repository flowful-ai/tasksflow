# FlowTask

[![CI](https://github.com/flowful-ai/tasksflow/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/flowful-ai/tasksflow/actions/workflows/ci.yml)

**The kanban for small dev teams and their AI agents: GitHub in, Claude and Cursor on top, one container to self-host.**

FlowTask keeps your team's tasks next to your GitHub issues and pull requests, lets AI assistants read and update them over MCP, and runs as a single Bun container plus Postgres.

## Features

- **Kanban boards**: drag and drop, custom states, priorities, labels, due dates, list view.
- **Sub-tasks and relations**: parent/child tasks, plus `blocks`, `relates` and `duplicates` links.
- **Bulk actions**: select up to 200 tasks and change state, priority, assignees or labels, delete or restore them, in one go.
- **Inbox**: notifications for assignments, @mentions, comments, status changes and due dates.
- **Search**: ⌘K command palette with Postgres full-text search over titles and descriptions.
- **History**: every change to a task is recorded and shown on the task.
- **Trash**: deleted tasks can be restored for 30 days, then they are purged.
- **Smart Views**: saved filters (assignee, state, labels, dates, `{{current_user}}`, relative dates), shareable with teammates or publicly through a link with an optional password.
- **GitHub App, two-way**: issues and PRs sync into tasks; task edits and comments sync back to the linked issue.
- **Slack**: notifications in a channel per project (FlowTask → Slack only).
- **Outgoing webhooks**: task and comment events posted to your URL, HMAC-SHA256 signed.
- **MCP server**: Claude Code, Claude Desktop, Cursor and other MCP clients connect over OAuth and get 19 task tools.
- **In-app AI chat**: an assistant that uses the same tools with your workspace's OpenRouter key (OpenAI, Anthropic and Google keys work too); it asks before changing anything.
- **Realtime**: changes appear live in every open tab (Server-Sent Events).
- **Keyboard first**: shortcuts everywhere; press `?` for the list.
- **Workspaces and roles**: owner, admin and member roles, with per-project access (everyone, selected members, or admins only).

## Tech Stack

| Layer          | Technology                                         |
| -------------- | -------------------------------------------------- |
| Runtime        | Bun                                                |
| Frontend       | React, TypeScript, Vite, Tailwind CSS              |
| Backend        | Hono on Bun                                        |
| Database       | PostgreSQL 16 with Drizzle ORM                     |
| Jobs, realtime | Postgres (job queue table, `LISTEN/NOTIFY` to SSE) |
| Authentication | Better Auth (GitHub and Google sign-in)            |
| AI             | MCP (Streamable HTTP), Vercel AI SDK, OpenRouter   |

## Quick Start

Prerequisites: [Bun](https://bun.sh) 1.3 or newer, Docker (for Postgres), and a GitHub or Google OAuth app for signing in.

```bash
git clone https://github.com/flowful-ai/tasksflow.git
cd tasksflow

# 1. Postgres on 127.0.0.1:5432 (user, password and database: flowtask)
docker compose up -d

# 2. Dependencies
bun install

# 3. Environment
cp .env.example .env
#    - BETTER_AUTH_SECRET and API_KEY_ENCRYPTION_KEY: openssl rand -hex 32
#    - a sign-in provider: GITHUB_CLIENT_ID/GITHUB_CLIENT_SECRET (and
#      VITE_GITHUB_CLIENT_ID with the same client id), or the Google pair

# 4. API on :3001 (applies migrations on boot) and web app on :3000
bun run dev
```

Open http://localhost:3000. The web dev server proxies `/api` to the API.

Sign-up is through GitHub or Google only. For local GitHub sign-in, create an OAuth app at <https://github.com/settings/developers> with the callback URL `http://localhost:3001/api/auth/callback/github` (Google: `http://localhost:3001/api/auth/callback/google`). The first account becomes the app manager unless `APP_MANAGER_EMAILS` is set.

### Useful commands

```bash
bun run dev              # API + web app
bun run build            # shared package, web app, API bundle
bun run typecheck
bun run lint
bun run format:check
bun run test             # database suites skip without TEST_DATABASE_URL
bun run test:integration # with TEST_DATABASE_URL set (see CONTRIBUTING notes below)
bun run db:generate      # new migration after editing apps/api/src/db/schema.ts
bun run db:migrate       # apply migrations
bun run db:studio        # Drizzle Studio
```

## Configuration

Every variable lives in [`.env.example`](.env.example), with comments. "Required" means the API or `docker-compose.prod.yml` refuses to start without it.

| Variable                                                                              | Required               | Meaning                                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`                                                                        | one of these           | Postgres connection URL.                                                                                                                                 |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_HOST`, `POSTGRES_PORT` | one of these           | Used to build the URL when `DATABASE_URL` is unset (URL-encoded, so any password works). `POSTGRES_PASSWORD` is required by the production compose file. |
| `DB_POOL_MAX`                                                                         | no                     | Connections per API process (default 10).                                                                                                                |
| `RUN_MIGRATIONS`                                                                      | no                     | Apply migrations on boot under an advisory lock (default `true`).                                                                                        |
| `MIGRATIONS_DIR`                                                                      | no                     | Migrations folder (default `apps/api/drizzle`, `/app/drizzle` in the image).                                                                             |
| `BETTER_AUTH_SECRET`                                                                  | yes                    | Session signing secret, 32+ random characters.                                                                                                           |
| `BETTER_AUTH_URL`                                                                     | yes in production      | Public base URL of the app (`https://…`); OAuth callbacks are built from it.                                                                             |
| `PUBLIC_URL`                                                                          | no                     | Base URL for OAuth/MCP metadata when it differs from `BETTER_AUTH_URL`.                                                                                  |
| `MCP_ALLOWED_REDIRECT_SCHEMES`                                                        | no                     | Extra dotless MCP OAuth redirect schemes, comma-separated (defaults: `cursor`, `vscode`, `vscode-insiders`, `windsurf`).                                 |
| `WEB_URL`                                                                             | no                     | Public URL of the web app (default in production: `BETTER_AUTH_URL`). Trusted origin for CORS and auth.                                                  |
| `APP_MANAGER_EMAILS`                                                                  | no                     | Comma-separated emails promoted to app manager on sign-up or next login. Unset: the first account is promoted.                                           |
| `TRUSTED_PROXY_HOPS`                                                                  | no                     | Reverse proxies that append to `X-Forwarded-For` (`1` behind Dokploy's Traefik, `0` for none).                                                           |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`                                            | for GitHub sign-in     | GitHub OAuth app for login.                                                                                                                              |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`                                            | for Google sign-in     | Google OAuth client for login.                                                                                                                           |
| `VITE_GITHUB_CLIENT_ID`, `VITE_GOOGLE_CLIENT_ID`                                      | no                     | Web build flags: non-empty shows the sign-in button. The production compose file defaults them to the server values.                                     |
| `VITE_API_URL`                                                                        | no                     | Leave empty: the SPA calls the API on its own origin.                                                                                                    |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`                                             | for GitHub integration | GitHub App id and private key (PEM with `\n`, or base64).                                                                                                |
| `GITHUB_WEBHOOK_SECRET`                                                               | for GitHub integration | Verifies `POST /api/webhooks/github`; webhooks are rejected while unset.                                                                                 |
| `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`                                    | for GitHub integration | The App's OAuth client, used to verify the installing user.                                                                                              |
| `GITHUB_APP_SLUG`, `VITE_GITHUB_APP_SLUG`                                             | for GitHub integration | App slug for the install link (`github.com/apps/<slug>`).                                                                                                |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`                                              | for Slack              | Slack app OAuth credentials ("Add to Slack").                                                                                                            |
| `SLACK_SIGNING_SECRET`                                                                | for Slack              | Verifies `POST /api/webhooks/slack`.                                                                                                                     |
| `SLACK_REDIRECT_URI`                                                                  | no                     | Default `<BETTER_AUTH_URL>/api/webhooks/slack/oauth`.                                                                                                    |
| `SLACK_BOT_TOKEN`                                                                     | no                     | Fallback bot token for projects without their own Slack install.                                                                                         |
| `API_KEY_ENCRYPTION_KEY`                                                              | yes                    | Encrypts stored AI provider keys. 32 random bytes as hex or base64 (`openssl rand -hex 32`).                                                             |
| `INTEGRATION_ENCRYPTION_KEY`                                                          | no                     | Encrypts Slack bot tokens; defaults to `API_KEY_ENCRYPTION_KEY`.                                                                                         |
| `OPENROUTER_TIMEOUT_MS`                                                               | no                     | OpenRouter request timeout (default 120000).                                                                                                             |
| `NODE_ENV`                                                                            | no                     | `production` turns on HSTS and the production origin and URL rules.                                                                                      |
| `API_PORT`, `API_HOST`                                                                | no                     | Listen port and interface (defaults `3001`, `0.0.0.0`).                                                                                                  |
| `WEB_DIST_DIR`                                                                        | no                     | Built SPA to serve (default `apps/web/dist`, `/app/public` in the image).                                                                                |
| `SHUTDOWN_TIMEOUT_MS`                                                                 | no                     | Per-phase graceful shutdown timeout (default 10000).                                                                                                     |
| `JOBS_DISABLED`                                                                       | no                     | `true` disables the job runner in this process.                                                                                                          |
| `ALLOW_PRIVATE_WEBHOOK_TARGETS`                                                       | no                     | `true` allows outgoing webhooks to private addresses (development only).                                                                                 |
| `TEST_DATABASE_URL`                                                                   | tests only             | Database for integration tests; it is wiped.                                                                                                             |

## Connect an MCP client

The MCP endpoint is `https://<your-domain>/api/mcp` (Streamable HTTP; `/api/mcp/sse` is an alias for older configurations). There are no API tokens to copy: the client registers itself, opens a browser window, and you approve access.

**Claude Code**

```bash
claude mcp add --transport http flowtask https://<your-domain>/api/mcp
```

Then run `/mcp` in Claude Code and choose to authenticate.

**Claude Desktop**: Settings → Connectors → Add custom connector, URL `https://<your-domain>/api/mcp`. Claude connects from Anthropic's servers, so the URL must be reachable from the internet.

**Cursor**: add to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "flowtask": { "url": "https://<your-domain>/api/mcp" }
  }
}
```

**What happens on connect**

1. The client reads `/.well-known/oauth-protected-resource/api/mcp` and `/.well-known/oauth-authorization-server`, then registers with `POST /api/mcp/oauth/register`.
2. Your browser opens the FlowTask consent page (sign in first if needed). Pick the workspace and the tools to grant. Only workspace owners and admins can approve.
3. The client receives a 15-minute access token and a 30-day rotating refresh token, bound to this server's MCP resource.

Owners and admins can see, narrow and revoke connections under **Settings → MCP Connections**. Details, the tool list and scopes: [docs/mcp.md](docs/mcp.md).

## GitHub App setup

FlowTask uses a GitHub App (separate from the OAuth app used for sign-in).

1. Create an App at <https://github.com/settings/apps/new> (or under your organization).
2. **Callback URLs**: add `https://<your-domain>/api/github/callback` (and keep `https://<your-domain>/api/auth/callback/github` if this App also handles GitHub sign-in), and tick **Request user authorization (OAuth) during installation**. FlowTask refuses installations without this step: it checks that the installing user can access the installation.
3. **Webhook**: active, URL `https://<your-domain>/api/webhooks/github`, and a random **webhook secret** (`openssl rand -hex 32`).
4. **Repository permissions**: Issues: Read and write; Pull requests: Read-only; Metadata: Read-only.
5. **Subscribe to events**: Issues, Issue comment, Pull request.
6. Generate a private key and note the App ID, the Client ID, a new client secret and the App slug (from its public URL).
7. Set `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG` and `VITE_GITHUB_APP_SLUG`.

Then, in a project's settings, install the App and link repositories. Issues and PRs become tasks; changes to a linked task's title, description, state, priority and labels, and new comments, are written back to GitHub.

## Slack app setup

Slack gets notifications only (task created, state changed, assigned, comment added); FlowTask never creates tasks from Slack.

1. Create an app at <https://api.slack.com/apps>.
2. **OAuth & Permissions**: add the redirect URL `https://<your-domain>/api/webhooks/slack/oauth` and the bot scopes `chat:write`, `chat:write.public`, `channels:read`, `groups:read` and `incoming-webhook`.
3. Optional: a slash command or Event Subscriptions pointing at `https://<your-domain>/api/webhooks/slack` (slash commands answer with help text; events are acknowledged and ignored).
4. Set `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and `SLACK_SIGNING_SECRET` (from **Basic Information**).
5. In a project's settings, click **Add to Slack** and pick the channel. The bot token is stored per project, encrypted.

## Deployment

Production is one image (`apps/api/Dockerfile`: API bundle, built SPA and migrations) plus Postgres and a daily backup sidecar, described in [`docker-compose.prod.yml`](docker-compose.prod.yml). The reference setup is Dokploy: route your domain to `tasksflow-api` on port 3001, set the environment, deploy. Migrations run on boot.

- [docs/deploy.md](docs/deploy.md): Dokploy deployment, health checks, scaling, shutdown.
- [docs/backup-restore.md](docs/backup-restore.md): backups and a restore drill.
- [docs/v2-upgrade.md](docs/v2-upgrade.md): upgrading a v1 installation.

## Documentation

- [docs/architecture.md](docs/architecture.md): how requests, events, jobs and realtime fit together.
- [docs/api.md](docs/api.md): every HTTP endpoint.
- [docs/mcp.md](docs/mcp.md): MCP tools, scopes and security.
- [CHANGELOG.md](CHANGELOG.md) and [SECURITY.md](SECURITY.md).

## Contributing

1. Fork the repository and create a branch.
2. Read [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md): layout, conventions and the database rules (schema changes go through `bun run db:generate`).
3. Before opening a pull request, run `bun run format:check`, `bun run lint`, `bun run typecheck` and `bun run test`. For database code, also run the integration suites against a scratch database: `createdb flowtask_test` in the dev Postgres, then `TEST_DATABASE_URL=postgresql://flowtask:flowtask@localhost:5432/flowtask_test bun run test:integration`.
4. Open a pull request against `main`. CI runs format, lint, typecheck, unit and integration tests, a migration drift check, the build, a dependency audit and the Docker build.

Report security issues privately: see [SECURITY.md](SECURITY.md).

## License

MIT License. See [LICENSE](LICENSE) for details.
