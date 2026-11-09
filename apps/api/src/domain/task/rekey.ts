/**
 * Re-key task columns (project_id, state_id) with fresh fractional-indexing
 * keys, preserving the current byte-wise order (position COLLATE "C", then id).
 * Soft-deleted tasks are included so a later restore lands in a valid column.
 *
 * Each column is rewritten in its own transaction under the same advisory
 * lock TaskService takes (lockColumn), so it is safe on a live database.
 * The API runs it with `onlyInvalid` after migrations, which repairs keys
 * written by the pre-v2 generator and is a read-only scan otherwise.
 */
import type { Database } from '../../db/index.js';
import { tasks } from '../../db/index.js';
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

export async function rekeyTaskPositions(
  db: Database,
  options: RekeyOptions = {}
): Promise<RekeyReport> {
  const columns = await db
    .selectDistinct({ projectId: tasks.projectId, stateId: tasks.stateId })
    .from(tasks)
    .orderBy(tasks.projectId, tasks.stateId);
  const report: RekeyReport = {
    columnsScanned: columns.length,
    columnsRekeyed: 0,
    tasksUpdated: 0,
  };

  for (const column of columns) {
    await db.transaction(async (tx) => {
      await lockColumn(tx, column.projectId, column.stateId);
      const rows = await loadColumn(tx, column.projectId, column.stateId);
      if (rows.length === 0) return;
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
