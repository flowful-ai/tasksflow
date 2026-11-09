import { and, asc, eq, inArray, isNull, lte, or, sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { jobs, type Database, type Job } from '../../db/index.js';
import { toJsonObject } from '@flowtask/shared';
import { JobRetryLater, type ClaimedJob, type JobHandlers, type JobOutcome } from './types.js';

export interface JobRunnerOptions {
  /** Max jobs running at once in this process (default 4). */
  concurrency?: number;
  /** Idle poll interval (default 1000 ms). */
  pollMs?: number;
  /** A lock older than this is considered stale and the job is reclaimed (default 5 min). */
  lockTimeoutMs?: number;
  /** Identifies this worker in jobs.locked_by (default host:pid:random). */
  workerId?: string;
  /** Called when a handler fails (default: console.error). */
  onError?: (job: ClaimedJob, error: Error) => void;
  /** stop() waits at most this long for in-flight jobs (default 30 s). */
  stopTimeoutMs?: number;
}

export interface JobRunner {
  /** Start the polling loop (no-op when already running). */
  start(): void;
  /** Stop polling and wait for in-flight jobs (bounded by stopTimeoutMs). Idempotent. */
  stop(): Promise<void>;
  /** Claim one batch, run it to completion and return how many jobs ran (tests, CLIs). */
  runOnce(): Promise<number>;
}

const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 60 * 60 * 1000;
const MAX_ERROR_LENGTH = 2000;

/**
 * Retry delay after the given (1-based) failed attempt:
 * min(2^(attempts-1) * 5 s, 1 h), with ±20 % jitter.
 */
export function computeBackoffMs(attempts: number, rand: () => number = Math.random): number {
  const exponent = Math.max(0, attempts - 1);
  const base = Math.min(BACKOFF_BASE_MS * 2 ** Math.min(exponent, 30), BACKOFF_MAX_MS);
  const jitter = 0.8 + 0.4 * rand();
  return Math.round(base * jitter);
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function truncate(message: string): string {
  return message.length > MAX_ERROR_LENGTH ? `${message.slice(0, MAX_ERROR_LENGTH - 1)}…` : message;
}

function toClaimedJob(row: Job): ClaimedJob {
  return {
    id: row.id,
    type: row.type,
    payload: toJsonObject(row.payload),
    key: row.key,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
  };
}

/** Create a runner without starting it. */
export function createJobRunner(
  db: Database,
  handlers: JobHandlers,
  opts: JobRunnerOptions = {}
): JobRunner {
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const pollMs = Math.max(10, opts.pollMs ?? 1000);
  const lockTimeoutMs = opts.lockTimeoutMs ?? 5 * 60 * 1000;
  const stopTimeoutMs = opts.stopTimeoutMs ?? 30_000;
  const workerId = opts.workerId ?? `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;
  const onError =
    opts.onError ??
    ((job: ClaimedJob, error: Error) =>
      console.error(`[jobs] ${job.type} ${job.id} failed (attempt ${job.attempts}):`, error));
  const types = Object.keys(handlers);

  const inFlight = new Set<Promise<void>>();
  // Payload of each claimed keyed job as stored, to detect a change while it runs.
  const claimedPayloads = new Map<string, string>();
  let running = false;
  let stopping: Promise<void> | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let polling = false;

  async function claim(limit: number): Promise<ClaimedJob[]> {
    if (limit <= 0 || types.length === 0) return [];
    const staleBefore = sql`now() - ${`${lockTimeoutMs} milliseconds`}::interval`;
    const candidates = db
      .select({ id: jobs.id })
      .from(jobs)
      .where(
        and(
          isNull(jobs.doneAt),
          isNull(jobs.failedAt),
          lte(jobs.runAt, sql`now()`),
          inArray(jobs.type, types),
          or(isNull(jobs.lockedAt), sql`${jobs.lockedAt} < ${staleBefore}`)
        )
      )
      .orderBy(asc(jobs.runAt), asc(jobs.id))
      .limit(limit)
      .for('update', { skipLocked: true });

    const rows = await db
      .update(jobs)
      .set({ lockedAt: sql`now()`, lockedBy: workerId, attempts: sql`${jobs.attempts} + 1` })
      .where(inArray(jobs.id, candidates))
      .returning();
    for (const row of rows) {
      if (row.key) claimedPayloads.set(row.id, JSON.stringify(row.payload));
    }
    return rows.map(toClaimedJob);
  }

  async function finishSuccess(job: ClaimedJob, outcome: JobOutcome | void): Promise<void> {
    await db.transaction(async (tx) => {
      const owned = and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId));
      // A keyed job whose payload changed while it ran (a coalescing enqueue,
      // see queue.ts) is not done: it runs again right away with the new payload.
      const claimedPayload = claimedPayloads.get(job.id);
      const unchanged =
        job.key && claimedPayload !== undefined
          ? sql`${jobs.payload} = ${claimedPayload}::jsonb`
          : undefined;
      const finished = await tx
        .update(jobs)
        .set({
          doneAt: sql`now()`,
          lockedAt: null,
          lockedBy: null,
          lastError: outcome?.error ? truncate(outcome.error) : null,
        })
        .where(and(owned, unchanged))
        .returning({ id: jobs.id });

      if (finished.length === 0 && unchanged) {
        await tx
          .update(jobs)
          .set({
            runAt: sql`now()`,
            attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
            lockedAt: null,
            lockedBy: null,
          })
          .where(owned);
        return;
      }

      if (outcome?.reschedule && job.key) {
        await tx
          .insert(jobs)
          .values({
            type: job.type,
            payload: job.payload,
            key: job.key,
            maxAttempts: job.maxAttempts,
            runAt: outcome.reschedule.runAt,
          })
          .onConflictDoNothing({
            target: jobs.key,
            where: sql`${jobs.key} IS NOT NULL AND ${jobs.doneAt} IS NULL AND ${jobs.failedAt} IS NULL`,
          });
      }
    });
  }

  async function finishFailure(job: ClaimedJob, error: Error): Promise<void> {
    const message = truncate(error.message || error.name);
    const owned = and(eq(jobs.id, job.id), eq(jobs.lockedBy, workerId));

    if (error instanceof JobRetryLater) {
      await db
        .update(jobs)
        .set({
          runAt: new Date(Date.now() + error.delayMs),
          attempts: sql`greatest(${jobs.attempts} - 1, 0)`,
          lockedAt: null,
          lockedBy: null,
        })
        .where(owned);
      return;
    }

    if (job.attempts >= job.maxAttempts) {
      await db
        .update(jobs)
        .set({ failedAt: sql`now()`, lastError: message, lockedAt: null, lockedBy: null })
        .where(owned);
      return;
    }

    await db
      .update(jobs)
      .set({
        runAt: new Date(Date.now() + computeBackoffMs(job.attempts)),
        lastError: message,
        lockedAt: null,
        lockedBy: null,
      })
      .where(owned);
  }

  async function execute(job: ClaimedJob): Promise<void> {
    try {
      await executeClaimed(job);
    } finally {
      claimedPayloads.delete(job.id);
    }
  }

  async function executeClaimed(job: ClaimedJob): Promise<void> {
    const handler = handlers[job.type];
    try {
      if (!handler) throw new Error(`No handler for job type "${job.type}"`);
      const outcome = await handler(job, { db, workerId });
      await finishSuccess(job, outcome);
    } catch (caught) {
      const error = toError(caught);
      if (!(error instanceof JobRetryLater)) onError(job, error);
      try {
        await finishFailure(job, error);
      } catch (finishError) {
        // The lock will go stale and the job will be reclaimed.
        console.error(`[jobs] could not record failure of ${job.id}:`, finishError);
      }
    }
  }

  function track(job: ClaimedJob): Promise<void> {
    const run = execute(job);
    inFlight.add(run);
    void run.finally(() => {
      inFlight.delete(run);
      if (running && !stopping) schedule(0);
    });
    return run;
  }

  function schedule(delayMs: number): void {
    if (!running || stopping) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, delayMs);
  }

  async function poll(): Promise<void> {
    if (polling || !running || stopping) return;
    polling = true;
    let next = pollMs;
    try {
      const free = concurrency - inFlight.size;
      if (free > 0) {
        const claimed = await claim(free);
        for (const job of claimed) void track(job);
        // A full batch suggests more work is waiting.
        if (claimed.length === free) next = 0;
      }
    } catch (error) {
      console.error('[jobs] poll failed:', error);
    } finally {
      polling = false;
      schedule(next);
    }
  }

  return {
    start() {
      if (running) return;
      running = true;
      stopping = null;
      schedule(0);
    },

    stop() {
      if (stopping) return stopping;
      running = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      stopping = (async () => {
        if (inFlight.size === 0) return;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        await Promise.race([
          Promise.allSettled([...inFlight]),
          new Promise<void>((resolve) => {
            timeout = setTimeout(resolve, stopTimeoutMs);
          }),
        ]);
        if (timeout) clearTimeout(timeout);
      })();
      return stopping;
    },

    async runOnce() {
      const claimed = await claim(concurrency);
      await Promise.all(claimed.map((job) => track(job)));
      return claimed.length;
    },
  };
}

/** Create and start a job runner. Call `stop()` on shutdown. */
export function startJobRunner(
  db: Database,
  handlers: JobHandlers,
  opts: JobRunnerOptions = {}
): JobRunner {
  const runner = createJobRunner(db, handlers, opts);
  runner.start();
  return runner;
}
