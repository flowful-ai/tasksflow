# Web Agent Instructions

## Scope
- Applies to all files under `apps/web`.
- Use with root `AGENTS.md`; this file is authoritative for web-specific work.

## Placement And Naming
- Route-level pages: `src/routes`.
- Reusable UI: `src/components`.
- API client code: `src/api`.
- State and hooks: `src/stores`, `src/hooks`.
- Keep existing file naming/style conventions (`PascalCase` components, route patterns).

## Data Access Patterns
- Use existing API client abstractions in `src/api` instead of duplicating fetch logic.
- Reuse current state patterns (stores/hooks) before introducing new global state paths.
- Keep type contracts aligned with shared types from `@flowtask/shared`.

## UI Change Boundaries
- Scope visual changes to the requested area.
- Avoid broad restyling, design-system churn, or large CSS rewrites unless requested.
- Preserve current interaction patterns and accessibility behavior when modifying UI.

## Minimal Validation Commands
- For web-local changes:
  - `bun run --filter @flowtask/web typecheck`
  - `bun run --filter @flowtask/web build`
- For cross-package contract changes:
  - `bun run typecheck`
