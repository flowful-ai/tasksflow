/**
 * One-call boot wiring for workstream-B background work: domain-event
 * subscribers (notifications, outgoing webhooks), the job runner and the
 * recurring jobs. `stop()` unsubscribes, stops the runner and waits for
 * in-flight work.
 */
import type { Database } from '@flowtask/database';
import { domainEvents } from '../events/bus.js';
import { dueDateReminderHandler } from '../notification/reminders.js';
import { registerNotificationSubscribers } from '../notification/subscriber.js';
import { trashPurgeHandler } from '../task/trash.js';
import { createOutgoingWebhookJobHandlers } from '../webhook-out/deliver.js';
import { registerOutgoingWebhookSubscribers } from '../webhook-out/subscriber.js';
import { jobsCleanupHandler } from './cleanup.js';
import { ensureRecurringJob, recurring } from './recurring.js';
import { startJobRunner } from './runner.js';
import { JOB_TYPES, type JobHandlers } from './types.js';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface BackgroundServicesOptions {
  /** Disable the job runner (subscribers still run). Default: JOBS_DISABLED=true disables. */
  runJobs?: boolean;
  concurrency?: number;
  pollMs?: number;
  /** Additional job handlers (e.g. integration jobs registered by the API). */
  extraHandlers?: JobHandlers;
}

export interface BackgroundServices {
  stop(): Promise<void>;
}

export function createBackgroundJobHandlers(): JobHandlers {
  return {
    // webhooks.deliver + webhooks.delivery_cleanup (already recurring, daily)
    ...createOutgoingWebhookJobHandlers(),
    [JOB_TYPES.jobsCleanup]: recurring(DAY_MS, jobsCleanupHandler),
    [JOB_TYPES.notificationsDueScan]: recurring(HOUR_MS, dueDateReminderHandler),
    [JOB_TYPES.tasksTrashPurge]: recurring(DAY_MS, trashPurgeHandler),
  };
}

export function startBackgroundServices(db: Database, opts: BackgroundServicesOptions = {}): BackgroundServices {
  const unsubscribe = [registerNotificationSubscribers(db), registerOutgoingWebhookSubscribers(db)];
  const runJobs = opts.runJobs ?? process.env.JOBS_DISABLED !== 'true';
  const runner = runJobs
    ? startJobRunner(db, { ...opts.extraHandlers, ...createBackgroundJobHandlers() }, { concurrency: opts.concurrency, pollMs: opts.pollMs })
    : null;

  if (runJobs) {
    const recurringTypes = [
      JOB_TYPES.notificationsDueScan,
      JOB_TYPES.tasksTrashPurge,
      JOB_TYPES.webhookDeliveryCleanup,
      JOB_TYPES.jobsCleanup,
    ];
    void Promise.all(recurringTypes.map((type) => ensureRecurringJob(db, type))).catch((error: unknown) => {
      console.error('[jobs] failed to schedule recurring jobs:', error);
    });
  }

  let stopped: Promise<void> | null = null;
  return {
    stop() {
      stopped ??= (async () => {
        for (const off of unsubscribe) off();
        await runner?.stop();
        await domainEvents.idle();
      })();
      return stopped;
    },
  };
}
