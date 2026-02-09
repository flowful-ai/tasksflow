# API Agent Instructions

## Scope
- Applies to all files under `apps/api`.
- Use these rules with the root `AGENTS.md`; local rules win on conflict.

## Route Placement And Patterns
- Add/modify HTTP endpoints in `src/routes`.
- Keep route handlers thin: parse/validate/auth, then delegate.
- Use existing auth middleware patterns (`c.get('user')` etc.) consistently.

## Validation Expectations
- Reuse shared Zod schemas/types from `@flowtask/shared` where possible.
- For new API contracts, update shared schemas first, then route usage.
- Return response shapes consistent with existing routes.

## Service Boundary
- Put business logic in `packages/domain/src`.
- Avoid embedding orchestration-heavy logic directly in route files.

## Database Access Rule
- Prefer domain services for DB operations.
- Avoid route-level ad hoc query sprawl unless there is a proven local-only need.

## Minimal Validation Commands
- For API-local changes:
  - `bun run --filter @flowtask/api typecheck`
  - `bun run --filter @flowtask/api build`
- When contracts/shared types changed:
  - `bun run typecheck`
