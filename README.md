<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/assets/logo-dark.svg">
    <img src="docs/assets/logo.svg" alt="FlowTask" height="64">
  </picture>
</p>

<p align="center">
  <strong>The kanban for small dev teams and their AI agents: GitHub in, Claude and Cursor on top, one container to self-host.</strong>
</p>

<p align="center">
  <a href="https://github.com/flowful-ai/tasksflow/actions/workflows/ci.yml"><img src="https://github.com/flowful-ai/tasksflow/actions/workflows/ci.yml/badge.svg?branch=main" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/flowful-ai/tasksflow" alt="License: MIT"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-000000?logo=bun&logoColor=white" alt="Runtime: Bun"></a>
  <a href="https://www.typescriptlang.org/"><img src="https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white" alt="TypeScript: strict"></a>
  <a href="docs/mcp.md"><img src="https://img.shields.io/badge/MCP-compatible-6E56CF?logo=modelcontextprotocol&logoColor=white" alt="MCP compatible"></a>
  <a href="https://github.com/flowful-ai/tasksflow/commits/main"><img src="https://img.shields.io/github/last-commit/flowful-ai/tasksflow" alt="Last commit"></a>
</p>

<p align="center">
  <img src="docs/assets/screenshots/board.png" alt="A FlowTask board with Backlog, Todo, In Progress and In Review columns, labels, due dates and assignees" width="900">
</p>

## Why FlowTask

- **Your tasks live next to your code.** A GitHub App turns issues and pull requests into tasks, and edits on a linked task go back to the issue.
- **AI assistants are first-class users.** Claude Code, Claude Desktop, Cursor and other MCP clients sign in over OAuth and work on tasks with the same permissions as a teammate. The in-app chat asks before it changes anything.
- **It is small to run.** One Bun container serves the API, realtime updates, the MCP server and the web app. Postgres is the only other service: no Redis, no queue server, no websocket server.

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

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/task.png" alt="Task detail with description, sub-tasks, a blocking relation and comments with @mentions"><br><sub>Task detail: sub-tasks, relations, history and comments</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/inbox.png" alt="Inbox with assignment, mention and comment notifications next to a task preview"><br><sub>Inbox with a task preview, including its linked GitHub issue</sub></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/assets/screenshots/palette.png" alt="Command palette searching tasks for the word check"><br><sub>⌘K command palette with full-text search</sub></td>
    <td width="50%"><img src="docs/assets/screenshots/view.png" alt="Smart View listing open tasks due this week, grouped by project"><br><sub>A Smart View: open tasks due this week, across projects</sub></td>
  </tr>
</table>

The people, projects and tasks in these screenshots are made up (see [Demo data](#demo-data)).

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

### Demo data

To try FlowTask without an OAuth app, or to get a populated board, seed a fictional team into a fresh local database:

```bash
bun --env-file=.env apps/api/scripts/seed-demo.ts
```

It creates a workspace with two projects, tasks, comments, notifications and a Smart View, and prints a session cookie for the demo owner. Set it as `better-auth.session_token` on `localhost` in your browser's developer tools and reload. The script refuses to run against a database that is not on `localhost`.

### Useful commands

```bash
bun run dev              # API + web app
bun run build            # web app, then API bundle
bun run typecheck
bun run lint
bun run format:check
bun run test             # database suites skip without TEST_DATABASE_URL
bun run test:integration # with TEST_DATABASE_URL set (see Contributing below)
bun run db:generate      # new migration after editing apps/api/src/db/schema.ts
bun run db:migrate       # apply migrations
bun run db:studio        # Drizzle Studio
```

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

## Deployment

Production is one image (`apps/api/Dockerfile`: API bundle, built SPA and migrations) plus Postgres, described in [`docker-compose.prod.yml`](docker-compose.prod.yml). The reference setup is Dokploy: route your domain to `tasksflow-api` on port 3001, set the environment, deploy. Migrations run on boot.

The production compose file refuses to start without `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` and `API_KEY_ENCRYPTION_KEY`.

- [docs/deploy.md](docs/deploy.md): Dokploy deployment, health checks, scaling, shutdown.
- [docs/configuration.md](docs/configuration.md): every environment variable.
- [docs/integrations.md](docs/integrations.md): creating the GitHub App and the Slack app.
- [docs/backup-restore.md](docs/backup-restore.md): backing up from the host and a restore drill.

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

## Documentation

- [docs/architecture.md](docs/architecture.md): how requests, events, jobs and realtime fit together.
- [docs/api.md](docs/api.md): every HTTP endpoint.
- [docs/mcp.md](docs/mcp.md): MCP tools, scopes and security.
- [docs/configuration.md](docs/configuration.md) and [docs/integrations.md](docs/integrations.md): environment variables, GitHub App and Slack app setup.
- [CHANGELOG.md](CHANGELOG.md) and [SECURITY.md](SECURITY.md).

## Contributing

1. Fork the repository and create a branch.
2. Read [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md): layout, conventions and the database rules (schema changes go through `bun run db:generate`).
3. Before opening a pull request, run `bun run format:check`, `bun run lint`, `bun run typecheck` and `bun run test`. For database code, also run the integration suites against a scratch database: `createdb flowtask_test` in the dev Postgres, then `TEST_DATABASE_URL=postgresql://flowtask:flowtask@localhost:5432/flowtask_test bun run test:integration`.
4. Open a pull request against `main`. CI runs format, lint, typecheck, unit and integration tests, a migration drift check, the build, a dependency audit and the Docker build.

Report security issues privately: see [SECURITY.md](SECURITY.md).

## License

MIT License. See [LICENSE](LICENSE) for details.
