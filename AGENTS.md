# FlowTask Agent Instructions

## Progress report

- If you have access to the TasksFlow MCP create tasks in the taskflow project first when executing the project and then move state as you progress

## Project Snapshot

- Monorepo runtime/package manager: Bun (no turbo; root scripts use `bun run --filter`).
- Apps: `apps/api` (Hono API on Bun; also serves the built SPA), `apps/web` (React + Vite).
- Shared package: `packages/shared` (Zod schemas, types, constants, utils). It is the only package.
- The database, domain, auth and integration code lives inside the API: `apps/api/src/{db,domain,auth,integrations}`.
- Background context for coding agents: `CLAUDE.md`. Architecture: `docs/architecture.md`.

## Scope And Precedence

- Follow the nearest `AGENTS.md` to the files you edit.
- If multiple apply, the more specific (deeper) file wins.

## Global Execution Rules

- Use Bun commands only (`bun run ...`, `bun run --filter ...`).
- Keep edits minimal and local to the requested change.
- Preserve existing architecture and conventions.
- Do not perform speculative refactors or broad cleanup unless explicitly requested.
- Never use `any` or `unknown`; ESLint enforces `no-explicit-any` (`bun run lint`).

## Database Hard Rules (Non-Optional)

- Database schema source of truth: `apps/api/src/db/schema.ts`.
- Relations live in: `apps/api/src/db/relations.ts`.
- Do not hand-write or manually edit SQL migration files in `apps/api/drizzle/*.sql`.
- Do not manually edit Drizzle metadata in `apps/api/drizzle/meta/*`.
- For schema changes:
  1. Edit `apps/api/src/db/schema.ts` (and `relations.ts` when needed).
  2. Run `bun run db:generate` and commit the one generated migration with its snapshot.
  3. Run `bun run db:migrate` (the API also applies pending migrations on boot).
- CI's migration drift job fails when `schema.ts` and `apps/api/drizzle` disagree.

## Change Routing Table

- API routes/HTTP handlers: `apps/api/src/routes` (mounted in `apps/api/src/app.ts`).
- Business/domain logic: `apps/api/src/domain`.
- Authorization guards: `apps/api/src/lib/authorize.ts` over `AuthorizationService` (`apps/api/src/domain/workspace/authorization.ts`).
- Agent/MCP tools: definitions in `apps/api/src/domain/agent/tools.ts`, handlers in `apps/api/src/services/agent-tools/`, dispatcher `apps/api/src/services/agent-tool-runtime.ts`.
- Integrations (GitHub App, Slack): `apps/api/src/integrations`.
- Realtime (SSE): `apps/api/src/sse`; side effects of domain events: `apps/api/src/background`.
- Shared types/schemas/contracts: `packages/shared/src/types`.
- Database tables/relations/client config: `apps/api/src/db`.

## Side Effects Rule

- Task, comment, project and membership writes go through the domain services, which emit domain events after commit.
- Realtime events, access refreshes, Slack, GitHub reverse sync, notifications and outgoing webhooks subscribe to those events (`apps/api/src/background/domain-bridges.ts`). Do not publish SSE events or call Slack/GitHub directly from routes, tools or integrations.

## MCP OAuth Rules

- MCP auth is OAuth-only for the MCP endpoint (`/api/mcp`, alias `/api/mcp/sse`) and `/api/mcp/tools`.
- Do not introduce static bearer token auth for MCP runtime routes.
- Workspace role gate for MCP OAuth authorization/management is `owner` or `admin` only.
- The settings page at `/settings/workspace/mcp-connections` is for MCP OAuth connection management (list/edit scopes/revoke), not token creation/regeneration.
- Tool output must wrap user- or GitHub-authored text with `untrusted()` (`{ untrusted_text }`).

## Agent Output Contract (Token-Efficient)

- Response order: Plan, Edits, Validation.
- Keep summaries short and actionable.
- Always include:
  - changed file paths
  - commands run
  - key validation result(s)

## Validation Baseline

- Prefer targeted checks first, then broader checks as needed:
  - `bun run typecheck`
  - `bun run lint`
  - `bun run format:check`
  - `bun run test` (database suites need `TEST_DATABASE_URL`; see `CLAUDE.md`)
  - package-scoped commands when changes are localized (`bun run --filter @flowtask/api typecheck`)
- `packages/shared` publishes a `dist` that the web build reads. After changing it, run `bun run --filter @flowtask/shared build` before building `apps/web` on its own (`bun run build` does this first).
