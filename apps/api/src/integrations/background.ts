import type { JsonObject } from '@flowtask/shared';

/**
 * Single seam for fire-and-forget integration work (GitHub reverse sync,
 * issue close, comment sync, issue creation, Slack notifications).
 *
 * `runInBackground` retries in-process with exponential backoff.
 * `scheduleBackgroundJob` (below) runs named jobs through the durable Postgres
 * queue when the API has installed it, and falls back to `runInBackground`.
 */

export type BackgroundLogContext = Record<string, string | number | boolean | null | undefined>;

export interface BackgroundTaskOptions {
  /** Total attempts, including the first one. Default 3. */
  attempts?: number;
  /** Delay before the first retry; doubles on each retry. Default 500ms. */
  baseDelayMs?: number;
  /** Extra fields included in structured log lines. */
  context?: BackgroundLogContext;
  /** Return false to stop retrying for errors that won't succeed on retry. */
  isRetryable?: (error: unknown) => boolean;
}

export interface BackgroundTaskResult {
  ok: boolean;
  attempts: number;
}

/** An error that retrying won't fix (bad config, missing link, 4xx from the API). */
export class NonRetryableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NonRetryableError';
  }
}

function errorFields(error: unknown): { error: string; errorName?: string; status?: number } {
  if (error instanceof Error) {
    const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined;
    return { error: error.message, errorName: error.name, status };
  }
  return { error: String(error) };
}

function defaultIsRetryable(error: unknown): boolean {
  if (error instanceof NonRetryableError) return false;
  // Octokit/HTTP errors carry a status. 4xx (except 408/429) won't fix themselves.
  if (error instanceof Error && 'status' in error && typeof error.status === 'number') {
    const status = error.status;
    if (status >= 400 && status < 500 && status !== 408 && status !== 429) return false;
  }
  return true;
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `fn` in the background with retries. The returned promise never rejects,
 * so callers may ignore it (`void runInBackground(...)`) or await it in tests.
 */
export async function runInBackground(
  name: string,
  fn: () => Promise<void>,
  options: BackgroundTaskOptions = {}
): Promise<BackgroundTaskResult> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const baseDelayMs = options.baseDelayMs ?? 500;
  const isRetryable = options.isRetryable ?? defaultIsRetryable;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      await fn();
      return { ok: true, attempts: attempt };
    } catch (error) {
      const retryable = attempt < attempts && isRetryable(error);
      console.error(
        JSON.stringify({
          level: retryable ? 'warn' : 'error',
          msg: retryable ? 'background_task_retry' : 'background_task_failed',
          task: name,
          attempt,
          maxAttempts: attempts,
          ...options.context,
          ...errorFields(error),
        })
      );
      if (!retryable) {
        return { ok: false, attempts: attempt };
      }
      await sleep(baseDelayMs * 2 ** (attempt - 1));
    }
  }
  return { ok: false, attempts };
}

// ============ Durable queue seam ============
//
// Background work is described as a named job with a JSON payload. When a
// durable queue is installed (the API installs the Postgres jobs queue at
// boot), scheduling enqueues a row and the job runner executes the registered
// handler, so the work survives restarts and gets the queue's retry/backoff.
// Without a queue (tests, scripts) it falls back to in-process runInBackground.

export type BackgroundJobPayload = JsonObject;

export interface DurableEnqueueOptions {
  /** One pending job per key. */
  key?: string;
  /** With `key`: merge into the pending job instead of skipping (see enqueueJob). */
  coalesce?: boolean;
}

export interface DurableJobQueue {
  enqueue(
    type: string,
    payload: BackgroundJobPayload,
    options?: DurableEnqueueOptions
  ): Promise<void>;
}

export type ScheduleBackgroundJobOptions = BackgroundTaskOptions & DurableEnqueueOptions;

export type BackgroundJobRunner = (payload: BackgroundJobPayload) => Promise<void>;

let durableQueue: DurableJobQueue | null = null;
const jobRunners = new Map<string, BackgroundJobRunner>();

/** Install (or remove, with null) the durable queue used by scheduleBackgroundJob. */
export function useDurableJobQueue(queue: DurableJobQueue | null): void {
  durableQueue = queue;
}

/**
 * Register how a background job type runs. Registration is idempotent per type
 * (the last registration wins), so service instances can register on construction.
 */
export function registerBackgroundJob(type: string, run: BackgroundJobRunner): void {
  jobRunners.set(type, run);
}

/** Every registered job type with its runner (the API turns these into job-queue handlers). */
export function getBackgroundJobRunners(): ReadonlyMap<string, BackgroundJobRunner> {
  return jobRunners;
}

/**
 * Schedule a registered job. Never throws: an enqueue failure falls back to
 * running in-process so the work isn't silently dropped.
 */
export function scheduleBackgroundJob(
  type: string,
  payload: BackgroundJobPayload,
  options: ScheduleBackgroundJobOptions = {}
): void {
  const run = jobRunners.get(type);
  if (!run) {
    console.error(
      JSON.stringify({ level: 'error', msg: 'background_job_unregistered', task: type })
    );
    return;
  }
  const inProcess = () => void runInBackground(type, () => run(payload), options);
  if (!durableQueue) {
    inProcess();
    return;
  }
  durableQueue
    .enqueue(type, payload, { key: options.key, coalesce: options.coalesce })
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          level: 'warn',
          msg: 'background_job_enqueue_failed',
          task: type,
          ...options.context,
          ...errorFields(error),
        })
      );
      inProcess();
    });
}

/** True when an error should not be retried by a durable queue either. */
export function isNonRetryableBackgroundError(error: unknown): boolean {
  return !defaultIsRetryable(error);
}
