/**
 * Trash retention: soft-deleted tasks are hard-deleted after
 * TRASH_RETENTION_DAYS (cascades remove assignees, labels, events, relations,
 * notifications; sub-tasks keep living with parent_id set to NULL).
 */
import { and, isNotNull, lt } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { tasks } from '../../db/index.js';
import { TRASH_RETENTION_DAYS } from '@flowtask/shared';
import type { JobHandler } from '../jobs/types.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Hard-delete tasks soft-deleted more than `retentionDays` ago. Returns the count. */
export async function purgeTrash(
  db: Database,
  retentionDays = TRASH_RETENTION_DAYS,
  now: Date = new Date()
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const rows = await db
    .delete(tasks)
    .where(and(isNotNull(tasks.deletedAt), lt(tasks.deletedAt, cutoff)))
    .returning({ id: tasks.id });
  return rows.length;
}

export const trashPurgeHandler: JobHandler = async (_job, { db }) => {
  await purgeTrash(db);
};
