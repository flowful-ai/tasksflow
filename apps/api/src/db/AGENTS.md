# Database Agent Instructions

## Scope
- Applies to all files under `packages/database`.
- This file overrides broader repo instructions for this directory.

## Canonical Schema/Migration Workflow
1. Update schema in `src/schema.ts`.
2. Update relationships in `src/relations.ts` when required.
3. Generate migration with `bun run db:generate`.
4. Apply migration with `bun run db:migrate`.

## Prohibited Actions
- Do not create hand-written SQL migration files in `drizzle/*.sql`.
- Do not manually modify `drizzle/meta/*`.
- Do not use direct `psql` schema mutations as a replacement for migrations.
- Do not bypass Drizzle migration generation for persistent schema changes.

## Required Checks After DB Changes
- Verify generated migration files were produced by Drizzle.
- Run impacted checks (minimum):
  - `bun run --filter @flowtask/database typecheck`
  - `bun run --filter @flowtask/database build`
- Run broader checks when DB contracts affect consumers:
  - `bun run typecheck`

## PR Checklist (Keep Short)
- [ ] `schema.ts` updated
- [ ] migration generated (`bun run db:generate`)
- [ ] migration applied locally (`bun run db:migrate`)
- [ ] downstream code/contracts updated
