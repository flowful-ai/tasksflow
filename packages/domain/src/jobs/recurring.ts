import type { JsonObject } from '@flowtask/shared';
import { enqueueJob } from './queue.js';
import type { JobExecutor, JobHandler } from './types.js';

/** Singleton key used for a recurring job type. */
export function recurringJobKey(type: string): string {
  return `recurring:${type}`;
}

/**
 * Make sure one pending occurrence of a recurring job exists (call at boot;
 * safe on every replica thanks to the pending-key unique index).
 * Returns the job id when one was created, null when one was already pending.
 */
export async function ensureRecurringJob(
  db: JobExecutor,
  type: string,
  payload: JsonObject = {},
  opts: { runAt?: Date; maxAttempts?: number } = {}
): Promise<string | null> {
  return enqueueJob(db, type, payload, {
    key: recurringJobKey(type),
    runAt: opts.runAt,
    maxAttempts: opts.maxAttempts ?? 3,
  });
}

/**
 * Wrap a handler so it runs every `intervalMs`.
 *
 * After the handler finishes the runner marks the job done and, in the same
 * transaction, enqueues the next occurrence (same type, payload and key) at
 * now + interval. A failing run is not retried with backoff: the error is
 * recorded on the job and the next occurrence still gets scheduled, so a
 * periodic scan never silently stops. Enqueue the first occurrence with
 * `ensureRecurringJob` (the key is what makes the chain unique across replicas).
 */
export function recurring(intervalMs: number, handler: JobHandler): JobHandler {
  return async (job, ctx) => {
    const reschedule = { runAt: new Date(Date.now() + intervalMs) };
    try {
      const outcome = await handler(job, ctx);
      return { ...(outcome ?? {}), reschedule };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[jobs] recurring ${job.type} failed:`, error);
      return { reschedule, error: message };
    }
  };
}
