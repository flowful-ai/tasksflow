/**
 * Single seam for fire-and-forget integration work (GitHub reverse sync,
 * issue close, comment sync, issue creation, Slack notifications).
 *
 * Today it retries in-process with exponential backoff. It is meant to be
 * swapped onto the Postgres jobs queue later without touching call sites.
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
