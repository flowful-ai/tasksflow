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
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '@flowtask/database';
import { tasks } from '@flowtask/database';
import { arePositionsHealthy, generatePositions } from '@flowtask/shared';
import { lockColumn } from './positions.js';

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

export async function rekeyTaskPositions(db: Database, options: RekeyOptions = {}): Promise<RekeyReport> {
  const columns = await db
    .selectDistinct({ projectId: tasks.projectId, stateId: tasks.stateId })
    .from(tasks)
    .orderBy(tasks.projectId, tasks.stateId);
  const report: RekeyReport = { columnsScanned: columns.length, columnsRekeyed: 0, tasksUpdated: 0 };

  for (const column of columns) {
    await db.transaction(async (tx) => {
      await lockColumn(tx, column.projectId, column.stateId);
      const rows = await tx
        .select({ id: tasks.id, position: tasks.position })
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, column.projectId),
            column.stateId === null ? isNull(tasks.stateId) : eq(tasks.stateId, column.stateId)
          )
        )
        .orderBy(sql`${tasks.position} COLLATE "C"`, asc(tasks.id));
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
      for (const change of changes) {
        await tx.update(tasks).set({ position: change.position }).where(eq(tasks.id, change.id));
      }
    });
  }
  return report;
}
