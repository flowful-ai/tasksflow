/**
 * One-off: re-key every task column (project_id, state_id) with fresh
 * fractional-indexing keys, preserving the current byte-wise order
 * (position COLLATE "C", then id). Soft-deleted tasks are included so a
 * later restore lands back in a valid column.
 *
 * Usage:
 *   DATABASE_URL=postgres://… bun packages/database/scripts/rekey-positions.ts [--dry-run] [--only-invalid]
 *
 *   --only-invalid  skip columns whose keys are already valid and strictly ascending
 *   --dry-run       report what would change without writing
 *
 * Each column is rewritten in its own transaction under the same advisory
 * lock TaskService takes, so it is safe to run against a live database.
 */
import postgres from 'postgres';
import { arePositionsHealthy, generatePositions } from '@flowtask/shared';

const args = new Set(process.argv.slice(2));
const dryRun = args.has('--dry-run');
const onlyInvalid = args.has('--only-invalid');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(url, { max: 1 });

interface ColumnRow {
  project_id: string;
  state_id: string | null;
}

interface TaskRow {
  id: string;
  position: string;
}

async function main(): Promise<void> {
  const columns = await sql<ColumnRow[]>`SELECT DISTINCT project_id, state_id FROM tasks ORDER BY project_id, state_id`;
  let rewritten = 0;
  let tasksUpdated = 0;

  for (const column of columns) {
    await sql.begin(async (tx) => {
      const lockKey = `tasks-column:${column.project_id}:${column.state_id ?? 'none'}`;
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
      const rows = await tx<TaskRow[]>`
        SELECT id, position FROM tasks
        WHERE project_id = ${column.project_id}
          AND state_id IS NOT DISTINCT FROM ${column.state_id}
        ORDER BY position COLLATE "C", id`;
      if (rows.length === 0) return;
      if (onlyInvalid && arePositionsHealthy(rows.map((r) => r.position))) return;

      const keys = generatePositions(rows.length);
      const changes = rows.flatMap((row, i) => (row.position === keys[i] ? [] : [{ id: row.id, position: keys[i]! }]));
      rewritten++;
      tasksUpdated += changes.length;
      if (dryRun || changes.length === 0) return;
      for (const change of changes) {
        await tx`UPDATE tasks SET position = ${change.position} WHERE id = ${change.id}`;
      }
    });
  }

  console.log(
    `${dryRun ? '[dry-run] ' : ''}columns scanned: ${columns.length}, re-keyed: ${rewritten}, tasks updated: ${tasksUpdated}`
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
