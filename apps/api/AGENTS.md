# API Agent Instructions

## Scope

- Applies to all files under `apps/api`.
- Use these rules with the root `AGENTS.md`; local rules win on conflict.

## Route Placement And Patterns

- Add/modify HTTP endpoints in `src/routes`; mount new routers in `src/app.ts`.
- Keep route handlers thin: parse/validate/auth, then delegate.
- Authorize with the guards in `src/lib/authorize.ts` (`requireUser`, `requireWorkspace`, `requireProject`, `requireTask`, `requireSmartView`) instead of ad hoc role checks.
- Routers mounted before `app.use('/api/*', authMiddleware)` in `src/app.ts` must handle their own auth.

## Validation Expectations

- Reuse shared Zod schemas/types from `@flowtask/shared` where possible.
- For new API contracts, update shared schemas first, then route usage.
- Return response shapes consistent with existing routes: `{ success: true, data, meta? }` or `{ success: false, error: { code, message } }`.

## Service Boundary

- Put business logic in `src/domain`.
- Avoid embedding orchestration-heavy logic directly in route files.
- Task side effects (task SSE events, Slack, GitHub reverse sync, notifications, outgoing webhooks) follow domain events; see `src/background/domain-bridges.ts`.

## Database Access Rule

- Prefer domain services for DB operations.
- Avoid route-level ad hoc query sprawl unless there is a proven local-only need.
- Schema and migration rules: `src/db/AGENTS.md`.

## Minimal Validation Commands

- For API-local changes:
  - `bun run --filter @flowtask/api typecheck`
  - `bun run --filter @flowtask/api build`
  - `bun test apps/api/src/<area>` (from the repo root, so `bunfig.toml` applies)
- The API reads `@flowtask/shared` from source; no build step is needed for API checks.
- When routes change, regenerate the route table for `docs/api.md`: `bun apps/api/scripts/list-routes.ts`.
- When contracts/shared types changed:
  - `bun run typecheck`
