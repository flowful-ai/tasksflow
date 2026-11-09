import { and, isNotNull, lt, or } from 'drizzle-orm';
import { jobs } from '../../db/index.js';
import type { JobHandler } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
export const DONE_JOB_RETENTION_DAYS = 7;
export const FAILED_JOB_RETENTION_DAYS = 30;

/** Delete done jobs older than 7 days and failed jobs older than 30 days. */
export const jobsCleanupHandler: JobHandler = async (_job, { db }) => {
  const now = Date.now();
  await db
    .delete(jobs)
    .where(
      or(
        and(
          isNotNull(jobs.doneAt),
          lt(jobs.doneAt, new Date(now - DONE_JOB_RETENTION_DAYS * DAY_MS))
        ),
        and(
          isNotNull(jobs.failedAt),
          lt(jobs.failedAt, new Date(now - FAILED_JOB_RETENTION_DAYS * DAY_MS))
        )
      )
    );
};
