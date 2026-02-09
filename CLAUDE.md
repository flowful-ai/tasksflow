# FlowTask - Claude Code Context

This document provides context for Claude Code when working on the FlowTask codebase.

## Project Overview

FlowTask is a task management platform similar to Linear, built as a TypeScript monorepo running on **Bun**. It features:

- **Kanban-style task management** with drag-and-drop
- **Smart Views** - saved filtered views with complex query conditions
- **Public sharing** - share views externally with optional password protection
- **GitHub integration** - one-way sync (GitHub issues/PRs → FlowTask tasks)
- **Slack integration** - one-way notifications (FlowTask → Slack)
- **AI agents via MCP** - tools for AI assistants to manage tasks

## Runtime: Bun

This project uses **Bun** as its primary runtime. Key implications:

- Use `bun` instead of `node` or `npm`
- TypeScript runs directly without transpilation in development
- Native WebSocket support via `Bun.serve()`
- No need for `tsx`, `ts-node`, or similar tools
- The `@types/bun` package provides type definitions

```bash
# Install dependencies
bun install

# Run development servers
bun run dev

# Run a specific script
bun run --filter @flowtask/api dev
```

## Architecture

### Monorepo Structure

```
flowtask/
├── apps/
│   ├── api/          # Hono API server (port 3001) + WebSocket (port 3002)
│   └── web/          # React + Vite frontend (port 5173)
├── packages/
│   ├── shared/       # Types, utilities, constants
│   ├── database/     # Drizzle ORM schema and client
│   ├── auth/         # Better Auth configuration
│   ├── domain/       # Business logic services
│   └── integrations/ # GitHub, Slack, OpenRouter clients
```

### Package Dependencies

```
apps/api
├── @flowtask/database
├── @flowtask/domain
├── @flowtask/auth
├── @flowtask/integrations
└── @flowtask/shared

apps/web
└── @flowtask/shared

packages/domain
├── @flowtask/database
└── @flowtask/shared

packages/integrations
├── @flowtask/database
└── @flowtask/shared

packages/auth
├── @flowtask/database
└── @flowtask/shared

packages/database
└── @flowtask/shared
```

## Key Design Decisions

### One-Way Sync Pattern

External systems are the source of truth:
- **GitHub → FlowTask**: Issues/PRs sync to tasks, but changes in FlowTask don't push back
- **FlowTask → Slack**: Notifications only, no task creation from Slack

This simplifies conflict resolution and keeps the integration logic manageable.

### Lexicographic Ordering

Tasks use lexicographic (fractional) positioning for drag-and-drop ordering:
- Positions are strings like "a0", "a1", "aV" that sort lexicographically
- When inserting between "a0" and "a1", generate "a0V" (midpoint)
- Utility in `packages/shared/src/utils/lexicographic.ts`

### Filter Engine

Smart Views use a JSON-based filter configuration:
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

The filter engine (`packages/domain/src/smart-view/filter-engine.ts`) converts this to SQL.

### Real-time Updates

- Bun's native WebSocket server in `apps/api/src/websocket/handler.ts`
- Uses Redis pub/sub for horizontal scaling
- Clients subscribe to workspace channels
- Events: `task.created`, `task.updated`, `task.moved`, `task.deleted`
- API runs on port 3001, WebSocket on port 3002

## Database Schema

Key tables (defined in `packages/database/src/schema.ts`):

| Table | Purpose |
|-------|---------|
| `users` | User accounts |
| `workspaces` | Top-level organization |
| `workspace_members` | User-workspace membership with roles |
| `projects` | Projects within workspaces |
| `task_states` | Kanban columns (Backlog, In Progress, Done) |
| `tasks` | Task items with title, description, priority |
| `task_assignees` | Many-to-many task-user assignments |
| `labels` | Project-level labels |
| `task_labels` | Many-to-many task-label assignments |
| `task_events` | Audit log of all task changes |
| `comments` | Task comments |
| `smart_views` | Saved filtered views |
| `public_shares` | Public share tokens for smart views |
| `project_integrations` | GitHub/Slack integration configs |
| `external_links` | Links between tasks and GitHub issues/PRs |
| `agents` | AI agent configurations |
| `user_api_keys` | Encrypted OpenRouter API keys |

## Code Conventions

### TypeScript

- Strict mode enabled
- **NEVER use `unknown` or `any` types** - always use proper typed interfaces, type guards, or generics
- Use Zod for runtime validation (schemas in `packages/shared`)
- Prefer explicit types over inference for function signatures
- Use `type` for object shapes, `interface` for extendable contracts
- Import from `.js` extensions for ES module compatibility
- When narrowing types, use type guards (`function isX(val): val is X`) instead of type assertions

### Bun-Specific Patterns

```typescript
// Server startup (apps/api/src/index.ts)
const server = Bun.serve({
  port: 3001,
  fetch: app.fetch,  // Hono app
});

// WebSocket server (apps/api/src/websocket/handler.ts)
Bun.serve({
  port: 3002,
  fetch(req, server) {
    if (url.pathname === '/ws') {
      server.upgrade(req, { data: { userId: '', workspaceIds: new Set() } });
    }
  },
  websocket: {
    open(ws) { /* ... */ },
    message(ws, message) { /* ... */ },
    close(ws) { /* ... */ },
  },
});
```

### API Routes

Routes are organized in `apps/api/src/routes/`:
- Use Hono's router with method chaining
- Validate input with Zod schemas
- Return consistent response format: `{ data: T }` or `{ error: string }`
- Use middleware for auth: `authMiddleware` injects `c.get('user')`

Example:
```typescript
// apps/api/src/routes/tasks.ts
app.post('/', authMiddleware, async (c) => {
  const user = c.get('user');
  const body = await c.req.json();
  const validated = createTaskSchema.parse(body);
  const task = await taskService.create(validated, user.id);
  return c.json({ data: task });
});
```

### Frontend Components

- React functional components with hooks
- Zustand for global state (`apps/web/src/stores/`)
- TanStack Query for server state
- Tailwind CSS for styling
- Component files use PascalCase: `KanbanBoard.tsx`

### Services (Domain Layer)

Business logic lives in `packages/domain/src/`:
- Services are classes instantiated with database client
- Methods handle validation, authorization, and database operations
- Emit events for real-time updates

Example:
```typescript
// packages/domain/src/task/service.ts
class TaskService {
  constructor(private db: DrizzleClient) {}

  async create(data: CreateTaskInput, userId: string): Promise<Task> {
    // Validation, position calculation, database insert, event logging
  }
}
```

## Common Tasks

### Adding a New API Endpoint

1. Define Zod schema in `packages/shared/src/types.ts`
2. Add route handler in `apps/api/src/routes/`
3. Implement service method in `packages/domain/src/`
4. Update API client in `apps/web/src/api/client.ts`

### Adding a Database Table

1. Define table in `packages/database/src/schema.ts`
2. Add relations in `packages/database/src/relations.ts`
3. Run `bun run db:generate` to create migration
4. Run `bun run db:migrate` to apply

### Adding a New Integration

1. Create provider in `packages/integrations/src/{name}/`
2. Implement `IntegrationProvider` interface
3. Register in `packages/integrations/src/registry.ts`
4. Add webhook handler in `apps/api/src/routes/webhooks.ts`
5. Add UI in `apps/web/src/routes/settings.tsx`

### Adding a Smart View Filter Field

1. Add field mapping in `packages/domain/src/smart-view/filter-engine.ts`
2. Update filter UI in `apps/web/src/components/smart-views/`

### Adding a New MCP Tool

1. Add tool name to `AgentToolSchema` enum in `packages/shared/src/types/agent.ts`
2. Add tool definition to `AGENT_TOOLS` array in `packages/domain/src/agent/types.ts`
3. Implement tool handler in `apps/api/src/routes/mcp-sse.ts` (switch case in `executeMcpTool`)
4. Implement tool handler in `apps/api/src/routes/mcp.ts` (for REST API compatibility)
5. **Add permission to frontend UI** in `apps/web/src/components/settings/AgentSettings.tsx` (`AVAILABLE_PERMISSIONS` array)

### MCP OAuth Notes

- MCP endpoints are OAuth-only (Authorization Code + PKCE + dynamic client registration).
- OAuth metadata endpoints:
  - `/.well-known/oauth-protected-resource/api/mcp/sse`
  - `/api/mcp/.well-known/oauth-authorization-server`
- Only workspace `owner` and `admin` roles can authorize MCP OAuth access.

## Testing

```bash
# Run all tests
bun test

# Run tests for specific package
bun test packages/domain

# Run with watch mode
bun test --watch

# Run with coverage
bun test --coverage
```

Test files are colocated with source: `service.ts` → `service.test.ts`

## Debugging

### API Issues

1. Check logs: `docker-compose logs -f api`
2. Use Drizzle Studio: `bun run db:studio`
3. Check Redis: `docker-compose exec redis redis-cli`

### Frontend Issues

1. React DevTools for component state
2. Network tab for API calls
3. Check Zustand stores in React DevTools

### WebSocket Issues

1. Check browser console for connection errors
2. Verify Redis is running: `docker-compose ps`
3. Check API logs for subscription messages
4. Note: WebSocket runs on port 3002 (separate from API port 3001)

## Environment Setup

Required for development:
```env
DATABASE_URL=postgresql://flowtask:flowtask@localhost:5432/flowtask
REDIS_URL=redis://localhost:6379
BETTER_AUTH_SECRET=dev-secret-min-32-characters-long
BETTER_AUTH_URL=http://localhost:3001
```

Start infrastructure and dev servers:
```bash
docker-compose up -d
bun run db:migrate
bun run dev
```

## Important Files

| File | Purpose |
|------|---------|
| `packages/database/src/schema.ts` | All database table definitions |
| `packages/domain/src/task/service.ts` | Core task business logic |
| `packages/domain/src/smart-view/filter-engine.ts` | JSON filter → SQL conversion |
| `apps/api/src/index.ts` | API server entry point (Bun.serve) |
| `apps/api/src/websocket/handler.ts` | Bun WebSocket handling |
| `apps/web/src/components/kanban/KanbanBoard.tsx` | Main kanban UI |
| `apps/web/src/stores/workspace.ts` | Workspace/project state management |

## Performance Considerations

- Task queries are paginated (default 50 per request)
- Smart View filters compile to indexed SQL queries
- WebSocket connections are pooled per workspace
- Static assets are cached with 1-year expiry in production
- Bun's native performance is significantly faster than Node.js

## Security Notes

- User API keys (OpenRouter) are encrypted at rest using `ENCRYPTION_KEY`
- GitHub webhooks are verified using `GITHUB_WEBHOOK_SECRET`
- Slack requests are verified using `SLACK_SIGNING_SECRET`
- Public shares use UUID tokens, optionally with bcrypt-hashed passwords
- CORS is restricted to `CORS_ORIGIN` in production

## Quick Reference

```bash
# Development
bun install          # Install dependencies
bun run dev          # Start all services
bun run build        # Build all packages
bun run typecheck    # Type check
bun test             # Run tests

# Database
bun run db:generate  # Generate migration
bun run db:migrate   # Apply migrations
bun run db:studio    # Open Drizzle Studio

# Docker
docker-compose up -d              # Start infrastructure
docker-compose logs -f            # View logs
docker-compose down               # Stop infrastructure
```
