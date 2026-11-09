/**
 * Everything that runs beside request handling: domain-event bridges (SSE,
 * Slack, GitHub reverse sync), notification/webhook subscribers and the
 * Postgres job runner. Integration background work (GitHub reverse sync,
 * issue creation, Slack delivery) runs as durable jobs on that runner.
 */
import type { Database } from '../db/index.js';
import { enqueueJob, startBackgroundServices, type JobHandlers } from '../domain/index.js';
import {
  getBackgroundJobRunners,
  isNonRetryableBackgroundError,
  useDurableJobQueue,
} from '../integrations/index.js';
import { registerDomainEventBridges } from './domain-bridges.js';

export interface ApiBackground {
  stop(): Promise<void>;
}

/** Wrap integration job runners as job-queue handlers; non-retryable failures finish the job with an error. */
function integrationJobHandlers(): JobHandlers {
  const handlers: JobHandlers = {};
  for (const [type, run] of getBackgroundJobRunners()) {
    handlers[type] = async (job) => {
      try {
        await run(job.payload);
      } catch (error) {
        if (isNonRetryableBackgroundError(error)) {
          return { error: error instanceof Error ? error.message : 'Non-retryable failure' };
        }
        throw error;
      }
    };
  }
  return handlers;
}

export function startApiBackground(db: Database): ApiBackground {
  const offBridges = registerDomainEventBridges(db);
  const runJobs = process.env.JOBS_DISABLED !== 'true';

  // Only route integration work through the queue when this process runs it;
  // otherwise it would sit unprocessed. Without the queue it runs in-process.
  if (runJobs) {
    useDurableJobQueue({
      enqueue: async (type, payload) => {
        await enqueueJob(db, type, payload);
      },
    });
  }
  const services = startBackgroundServices(db, {
    runJobs,
    extraHandlers: integrationJobHandlers(),
  });

  let stopped: Promise<void> | null = null;
  return {
    stop() {
      stopped ??= (async () => {
        offBridges();
        useDurableJobQueue(null);
        await services.stop();
      })();
      return stopped;
    },
  };
}
