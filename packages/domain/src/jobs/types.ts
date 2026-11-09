import type { Database } from '@flowtask/database';
import type { JsonObject } from '@flowtask/shared';

/** A drizzle transaction handle (what `db.transaction(async (tx) => …)` passes). */
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0];

/** Anything jobs can be enqueued with: the database or an open transaction. */
export type JobExecutor = Database | DbTransaction;

/** Names of every job type handled in-process. */
export const JOB_TYPES = {
  webhookDeliver: 'webhooks.deliver',
  webhookDeliveryCleanup: 'webhooks.delivery_cleanup',
  jobsCleanup: 'jobs.cleanup',
  notificationsDueScan: 'notifications.due_scan',
  tasksTrashPurge: 'tasks.trash_purge',
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];

/** What a handler sees of a claimed job. `attempts` already counts this run. */
export interface ClaimedJob {
  id: string;
  type: string;
  payload: JsonObject;
  key: string | null;
  attempts: number;
  maxAttempts: number;
}

export interface JobContext {
  db: Database;
  workerId: string;
}

/**
 * Optional handler result. `reschedule` enqueues the next occurrence of a
 * keyed job atomically with marking this one done (used by `recurring()`).
 * `error` records a non-fatal error on the finished job.
 */
export interface JobOutcome {
  reschedule?: { runAt: Date };
  error?: string;
}

export type JobHandler = (job: ClaimedJob, ctx: JobContext) => Promise<void | JobOutcome>;

export type JobHandlers = Record<string, JobHandler>;

/** Throw from a handler to retry later without spending an attempt. */
export class JobRetryLater extends Error {
  readonly delayMs: number;

  constructor(delayMs: number, message = 'retry later') {
    super(message);
    this.name = 'JobRetryLater';
    this.delayMs = Math.max(0, delayMs);
  }
}
