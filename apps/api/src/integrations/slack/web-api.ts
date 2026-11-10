import { isJsonValue, type JsonValue } from '@flowtask/shared/json';
import { z } from 'zod';

/**
 * Minimal Slack Web API client on `fetch`, for the few methods FlowTask calls.
 * Every call is a form-encoded POST to https://slack.com/api/<method>.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

/** Form values; objects and arrays (e.g. `blocks`) are sent as JSON strings. */
export type SlackApiArgs = Record<string, JsonValue | undefined>;

const SLACK_API_BASE = 'https://slack.com/api/';
const REQUEST_TIMEOUT_MS = 15_000;
/** A 429 asking to wait longer than this is thrown instead of waited out. */
const MAX_RATE_LIMIT_WAIT_SECONDS = 30;
const MAX_RATE_LIMIT_RETRIES = 2;

/** Slack answered `ok: false` (channel_not_found, not_in_channel, invalid_auth, ...). */
export class SlackApiError extends Error {
  constructor(
    readonly method: string,
    /** Slack's error code, e.g. `channel_not_found`. */
    readonly code: string
  ) {
    super(`Slack ${method} failed: ${code}`);
    this.name = 'SlackApiError';
  }
}

/** HTTP-level failure: a non-2xx status or a body that isn't a Slack response. */
export class SlackHttpError extends Error {
  constructor(
    readonly method: string,
    readonly status: number,
    message: string
  ) {
    super(message);
    this.name = 'SlackHttpError';
  }
}

/** Slack kept answering 429. `status` stays 429 so background retries treat it as transient. */
export class SlackRateLimitedError extends SlackHttpError {
  constructor(
    method: string,
    readonly retryAfterSeconds: number
  ) {
    super(method, 429, `Slack ${method} rate limited (retry after ${retryAfterSeconds}s)`);
    this.name = 'SlackRateLimitedError';
  }
}

const SlackEnvelopeSchema = z.object({ ok: z.boolean(), error: z.string().optional() });

export interface SlackWebApiOptions {
  /** Bot token sent as a bearer token; omitted for `oauth.v2.access`. */
  token?: string;
  fetchImpl?: FetchLike;
  /** Injected in tests to skip real waits. */
  sleep?: (ms: number) => Promise<void>;
}

function encodeArgs(args: SlackApiArgs): URLSearchParams {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    form.set(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
  }
  return form;
}

/** Retry-After in seconds; Slack always sends an integer, default to 1 when missing. */
function retryAfterSeconds(response: Response): number {
  const seconds = Number.parseInt(response.headers.get('retry-after') ?? '', 10);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : 1;
}

async function readJson(response: Response): Promise<JsonValue> {
  try {
    const body: unknown = await response.json();
    return isJsonValue(body) ? body : null;
  } catch {
    return null;
  }
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

export class SlackWebApi {
  private readonly token: string | undefined;
  private readonly fetchImpl: FetchLike;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: SlackWebApiOptions = {}) {
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init));
    this.sleep = options.sleep ?? defaultSleep;
  }

  /**
   * Call `method` and parse the response with `schema`. Short 429s are waited
   * out (up to MAX_RATE_LIMIT_RETRIES times); longer ones throw
   * SlackRateLimitedError. `ok: false` throws SlackApiError.
   */
  async call<T>(method: string, args: SlackApiArgs, schema: z.ZodType<T>): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const body = encodeArgs(args).toString();

    for (let attempt = 0; ; attempt++) {
      const response = await this.fetchImpl(`${SLACK_API_BASE}${method}`, {
        method: 'POST',
        headers,
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (response.status === 429) {
        const wait = retryAfterSeconds(response);
        await response.body?.cancel();
        if (attempt >= MAX_RATE_LIMIT_RETRIES || wait > MAX_RATE_LIMIT_WAIT_SECONDS) {
          throw new SlackRateLimitedError(method, wait);
        }
        await this.sleep(wait * 1000);
        continue;
      }

      const json = await readJson(response);
      const envelope = SlackEnvelopeSchema.safeParse(json);
      if (envelope.success && !envelope.data.ok) {
        throw new SlackApiError(method, envelope.data.error ?? 'unknown_error');
      }
      if (!response.ok) {
        throw new SlackHttpError(
          method,
          response.status,
          `Slack ${method} HTTP ${response.status}`
        );
      }
      const parsed = schema.safeParse(json);
      if (!envelope.success || !parsed.success) {
        throw new SlackHttpError(
          method,
          response.status,
          `Slack ${method} returned an unexpected response`
        );
      }
      return parsed.data;
    }
  }
}
