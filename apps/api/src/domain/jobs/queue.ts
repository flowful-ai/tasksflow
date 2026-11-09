import { sql } from 'drizzle-orm';
import { jobs } from '../../db/index.js';
import type { JsonObject } from '@flowtask/shared';
import type { JobExecutor } from './types.js';

export interface EnqueueJobOptions {
  /** Absolute time to run at (default: now). */
  runAt?: Date;
  /** Delay from now; ignored when runAt is set. */
  delayMs?: number;
  /** Default 5. */
  maxAttempts?: number;
  /**
   * Singleton key: while a job with this key is pending (not done/failed),
   * enqueueing another one is a no-op and returns null.
   */
  key?: string;
  /**
   * With `key`: instead of a no-op, fold this enqueue into the pending job.
   * Its payload is shallow-merged (`pending || new`), it runs no later than
   * this enqueue asked for, and a job waiting in retry backoff gets a fresh
   * attempt budget. When the pending job is already running, the runner sees
   * the payload changed and runs it once more after it finishes (see
   * runner.ts), so a change made mid-run is never lost.
   */
  coalesce?: boolean;
}

/**
 * Enqueue a job. Pass a transaction to make the enqueue part of a larger
 * atomic write. Returns the new job id, or null when a pending job with the
 * same `key` already exists (with `coalesce`, that pending job's id).
 */
export async function enqueueJob(
  db: JobExecutor,
  type: string,
  payload: JsonObject,
  opts: EnqueueJobOptions = {}
): Promise<string | null> {
  const runAt = opts.runAt ?? (opts.delayMs ? new Date(Date.now() + opts.delayMs) : undefined);
  const values = {
    type,
    payload,
    key: opts.key ?? null,
    maxAttempts: opts.maxAttempts ?? 5,
    ...(runAt ? { runAt } : {}),
  };

  const pendingKey = sql`${jobs.key} IS NOT NULL AND ${jobs.doneAt} IS NULL AND ${jobs.failedAt} IS NULL`;
  let rows: { id: string }[];
  if (opts.key && opts.coalesce) {
    rows = await db
      .insert(jobs)
      .values(values)
      .onConflictDoUpdate({
        target: jobs.key,
        targetWhere: pendingKey,
        set: {
          payload: sql`${jobs.payload} || excluded.payload`,
          runAt: sql`least(${jobs.runAt}, excluded.run_at)`,
          attempts: sql`CASE WHEN ${jobs.lockedAt} IS NULL THEN 0 ELSE ${jobs.attempts} END`,
        },
      })
      .returning({ id: jobs.id });
  } else if (opts.key) {
    rows = await db
      .insert(jobs)
      .values(values)
      .onConflictDoNothing({ target: jobs.key, where: pendingKey })
      .returning({ id: jobs.id });
  } else {
    rows = await db.insert(jobs).values(values).returning({ id: jobs.id });
  }

  return rows[0]?.id ?? null;
}
