# Database Agent Instructions

## Scope

- Applies to all files under `apps/api/src/db` and to the migrations in `apps/api/drizzle`.
- This file overrides broader repo instructions for this directory.

## Canonical Schema/Migration Workflow

1. Update schema in `apps/api/src/db/schema.ts`.
2. Update relationships in `apps/api/src/db/relations.ts` when required.
3. Generate the migration with `bun run db:generate` (drizzle-kit, config in `apps/api/drizzle.config.ts`).
4. Apply it with `bun run db:migrate`, or restart the API: it applies pending migrations on boot under an advisory lock.

One schema change, one generated migration: commit the new `apps/api/drizzle/NNNN_*.sql` together with its `apps/api/drizzle/meta/` snapshot and journal entry.

## Prohibited Actions

- Do not create hand-written SQL migration files in `apps/api/drizzle/*.sql`.
- Do not manually modify `apps/api/drizzle/meta/*`.
- Do not use direct `psql` schema mutations as a replacement for migrations.
- Do not bypass Drizzle migration generation for persistent schema changes.
- Do not edit migrations that have shipped (`0000`–`0016`). `0016_v2.sql` is the v2 cutover: generated DDL wrapped in one-off data steps; it is not a template for new migrations.

## Things Drizzle Cannot Declare

- `tasks.position` is `COLLATE "C"` and `rate_limit_counters` is `UNLOGGED`; both were set by `0016_v2.sql`. Keep them when touching those tables, and order positions with an explicit `COLLATE "C"`.
- `tasks.search_vector` is a generated column (full-text search): Postgres computes it, so never write it, and keep it out of TaskService selects.

## Required Checks After DB Changes

- Verify generated migration files were produced by Drizzle.
- Run `bunx drizzle-kit generate` again from `apps/api`: it must produce nothing (this is CI's migration drift check).
- Run impacted checks (minimum):
  - `bun run --filter @flowtask/api typecheck`
  - `bun run --filter @flowtask/api build`
- Run integration suites against a scratch database when queries changed:
  - `TEST_DATABASE_URL=postgresql://flowtask:flowtask@localhost:5432/flowtask_test bun run test:integration`
- Run broader checks when DB contracts affect consumers:
  - `bun run typecheck`

## PR Checklist (Keep Short)

- [ ] `schema.ts` updated
- [ ] migration generated (`bun run db:generate`) and committed with its snapshot
- [ ] migration applied locally (`bun run db:migrate`)
- [ ] no drift (`bunx drizzle-kit generate` produces nothing)
- [ ] downstream code/contracts updated
