/**
 * Re-key task columns (project_id, state_id) with fresh fractional-indexing
 * keys, preserving the current byte-wise order (position COLLATE "C", then id).
 * Soft-deleted tasks are included so a later restore lands in a valid column.
 *
 * Each column is rewritten in its own transaction under the same advisory
 * lock TaskService takes (lockColumn), so it is safe on a live database.
 * The API runs it with `onlyInvalid` after migrations, which repairs keys
 * written by the pre-v2 generator: one SQL scan finds the columns holding an
 * invalid or duplicate key, and only those are loaded and rewritten.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { arePositionsHealthy, generatePositions } from '@flowtask/shared';
import { loadColumn, lockColumn, writePositions } from './positions.js';

export interface RekeyOptions {
  /** Skip columns whose keys are already valid and strictly ascending. */
  onlyInvalid?: boolean;
  /** Report what would change without writing. */
  dryRun?: boolean;
}

export interface RekeyReport {
  columnsScanned: number;
  columnsRekeyed: number;
  tasksUpdated: number;
}

/**
 * SQL twin of isValidPosition (packages/shared/src/utils/lexicographic.ts):
 * base-62 characters, an A-Z/a-z head whose implied integer part fits in the
 * key, no trailing '0' in the fractional part, and not the reserved smallest
 * integer "A" + 26 zeros.
 */
export function validPositionSql(position: SQL): SQL {
  const head = sql`ascii(left(${position}, 1))`;
  const intLength = sql`(CASE WHEN ${head} >= 97 THEN ${head} - 95 ELSE 92 - ${head} END)`;
  return sql`(
    ${position} COLLATE "C" ~ '^[A-Za-z][0-9A-Za-z]*$'
    AND length(${position}) >= ${intLength}
    AND NOT (length(${position}) > ${intLength} AND right(${position}, 1) = '0')
    AND ${position} <> ${`A${'0'.repeat(26)}`}
  )`;
}

interface ColumnHealth extends Record<string, string | boolean | null> {
  project_id: string;
  state_id: string | null;
  healthy: boolean;
}

/** Every column with a flag: all keys valid and strictly ascending (one scan of tasks). */
async function scanColumns(db: Database): Promise<ColumnHealth[]> {
  return db.execute<ColumnHealth>(sql`
    SELECT project_id, state_id, bool_and(ok) AS healthy
    FROM (
      SELECT project_id, state_id,
        ${validPositionSql(sql`position`)}
          AND (prev IS NULL OR prev COLLATE "C" < position COLLATE "C") AS ok
      FROM (
        SELECT project_id, state_id, position,
          lag(position) OVER (
            PARTITION BY project_id, state_id ORDER BY position COLLATE "C", id
          ) AS prev
        FROM tasks
      ) keyed
    ) checked
    GROUP BY project_id, state_id
    ORDER BY project_id, state_id`);
}

export async function rekeyTaskPositions(
  db: Database,
  options: RekeyOptions = {}
): Promise<RekeyReport> {
  const columns = await scanColumns(db);
  const report: RekeyReport = {
    columnsScanned: columns.length,
    columnsRekeyed: 0,
    tasksUpdated: 0,
  };

  for (const column of columns) {
    if (options.onlyInvalid && column.healthy) continue;
    await db.transaction(async (tx) => {
      await lockColumn(tx, column.project_id, column.state_id);
      const rows = await loadColumn(tx, column.project_id, column.state_id);
      if (rows.length === 0) return;
      // Re-check under the lock: a concurrent write may have re-keyed it already.
      if (options.onlyInvalid && arePositionsHealthy(rows.map((r) => r.position))) return;

      const keys = generatePositions(rows.length);
      const changes = rows.flatMap((row, i) => {
        const key = keys[i];
        return key === undefined || row.position === key ? [] : [{ id: row.id, position: key }];
      });
      report.columnsRekeyed++;
      report.tasksUpdated += changes.length;
      if (options.dryRun) return;
      await writePositions(tx, changes);
    });
  }
  return report;
}
