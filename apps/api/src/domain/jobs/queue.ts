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
}

/**
 * Enqueue a job. Pass a transaction to make the enqueue part of a larger
 * atomic write. Returns the new job id, or null when a pending job with the
 * same `key` already exists.
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

  const rows = opts.key
    ? await db
        .insert(jobs)
        .values(values)
        .onConflictDoNothing({
          target: jobs.key,
          where: sql`${jobs.key} IS NOT NULL AND ${jobs.doneAt} IS NULL AND ${jobs.failedAt} IS NULL`,
        })
        .returning({ id: jobs.id })
    : await db.insert(jobs).values(values).returning({ id: jobs.id });

  return rows[0]?.id ?? null;
}
