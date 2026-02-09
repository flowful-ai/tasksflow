# FlowTask Agent Instructions

## Project Snapshot
- Monorepo runtime/package manager: Bun.
- Apps: `apps/api` (Hono API), `apps/web` (React + Vite).
- Shared packages: `packages/database`, `packages/domain`, `packages/shared`, `packages/auth`, `packages/integrations`.

## Scope And Precedence
- Follow the nearest `AGENTS.md` to the files you edit.
- If multiple apply, the more specific (deeper) file wins.

## Global Execution Rules
- Use Bun commands only (`bun run ...`, `bun --filter ...`).
- Keep edits minimal and local to the requested change.
- Preserve existing architecture and conventions.
- Do not perform speculative refactors or broad cleanup unless explicitly requested.

## Database Hard Rules (Non-Optional)
- Database schema source of truth: `packages/database/src/schema.ts`.
- Relations live in: `packages/database/src/relations.ts`.
- Do not hand-write or manually edit SQL migration files in `packages/database/drizzle/*.sql`.
- Do not manually edit Drizzle metadata in `packages/database/drizzle/meta/*`.
- For schema changes:
  1. Edit `packages/database/src/schema.ts` (and `relations.ts` when needed).
  2. Run `bun run db:generate`.
  3. Run `bun run db:migrate`.

## Change Routing Table
- API routes/HTTP handlers: `apps/api/src/routes`.
- Business/domain logic: `packages/domain/src`.
- Shared types/schemas/contracts: `packages/shared/src/types`.
- Database tables/relations/client config: `packages/database/src`.

## MCP OAuth Rules
- MCP auth is OAuth-only for runtime MCP endpoints (`/api/mcp/sse`, `/api/mcp/sse/stream`, `/api/mcp/sse/message`, and MCP tool execution routes).
- Do not introduce or re-enable static bearer token (`ft_v1_*`) auth for MCP runtime routes.
- Workspace role gate for MCP OAuth authorization/management is `owner` or `admin` only.
- Legacy workspace agent token routes are deprecated and should remain hard-disabled with explicit deprecation responses.
- Settings page at `/settings/agents` is for MCP OAuth connection management (list/edit scopes/revoke), not token creation/regeneration.

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
  - `bun run lint` (if configured)
  - package-scoped commands when changes are localized
