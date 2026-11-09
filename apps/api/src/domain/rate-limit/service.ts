import { sql } from 'drizzle-orm';
import { getDatabase } from '../../db/index.js';
import type { Database } from '../../db/index.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds until reset
}

export interface FailedAttemptResult {
  allowed: boolean;
  attemptsRemaining: number;
  lockoutSeconds: number;
}

type CounterRow = { count: number; reset_in: number };

/**
 * Fixed-window rate limiting on the UNLOGGED Postgres table rate_limit_counters
 * (key, bucket_start, count, expires_at; primary key (key, bucket_start)), so the
 * limits hold across API replicas without Redis. Used for per-minute API token
 * limits and failed-attempt lockouts.
 *
 * Every method fails open (allows) if the database errors.
 */
export class RateLimitService {
  private static readonly MINUTE_LIMIT_PREFIX = 'ratelimit:token:minute:';
  private static readonly FAILED_ATTEMPT_PREFIX = 'ratelimit:failed:';
  private static readonly DAILY_USAGE_PREFIX = 'ratelimit:token:daily:';
  private static readonly FAILED_ATTEMPT_LIMIT = 10;
  private static readonly FAILED_ATTEMPT_WINDOW = 300; // 5 minutes
  /** Roughly one write in CLEANUP_EVERY also deletes expired rows. */
  private static readonly CLEANUP_EVERY = 50;

  private readonly explicitDb: Database | null;

  constructor(db?: Database) {
    this.explicitDb = db ?? null;
  }

  private get db(): Database {
    return this.explicitDb ?? getDatabase();
  }

  /**
   * Increment the counter for `key` in the current fixed window of `windowSeconds`
   * and return the new count and the seconds left in the window.
   */
  private async increment(key: string, windowSeconds: number): Promise<CounterRow> {
    const result = await this.db.execute<CounterRow>(sql`
      WITH bucket AS (
        SELECT to_timestamp(floor(extract(epoch FROM now()) / ${windowSeconds}::int) * ${windowSeconds}::int) AS start
      )
      INSERT INTO rate_limit_counters (key, bucket_start, count, expires_at)
      SELECT ${key}::text, bucket.start, 1, bucket.start + make_interval(secs => ${windowSeconds}::int)
      FROM bucket
      ON CONFLICT (key, bucket_start)
        DO UPDATE SET count = rate_limit_counters.count + 1
      RETURNING count,
        greatest(1, ceil(extract(epoch FROM expires_at - now())))::int AS reset_in
    `);
    this.maybeCleanup();
    const row = result[0];
    if (!row) throw new Error('rate_limit_counters upsert returned no row');
    return row;
  }

  private maybeCleanup(): void {
    if (Math.random() * RateLimitService.CLEANUP_EVERY >= 1) return;
    void this.deleteExpired().catch((error: Error) => {
      console.error('Rate limit cleanup failed:', error.message);
    });
  }

  /** Delete expired counters. Exposed for a periodic job; writes also call it opportunistically. */
  async deleteExpired(): Promise<void> {
    await this.db.execute(sql`
      DELETE FROM rate_limit_counters
      WHERE ctid IN (SELECT ctid FROM rate_limit_counters WHERE expires_at < now() LIMIT 1000)
    `);
  }

  /**
   * Check and increment per-minute rate limit for a token.
   * @param tokenId The token ID to rate limit
   * @param limit Maximum requests per minute
   * @returns Whether the request is allowed and remaining quota
   */
  async checkMinuteLimit(tokenId: string, limit: number): Promise<RateLimitResult> {
    const key = `${RateLimitService.MINUTE_LIMIT_PREFIX}${tokenId}`;
    try {
      const { count, reset_in } = await this.increment(key, 60);
      return {
        allowed: count <= limit,
        remaining: Math.max(0, limit - count),
        resetIn: reset_in,
      };
    } catch (error) {
      console.error('Rate limit check failed:', error);
      return { allowed: true, remaining: limit, resetIn: 60 };
    }
  }

  /**
   * Track failed authentication attempt for a token prefix.
   * Used to implement lockout after repeated failures.
   * @param tokenPrefix The 12-char token prefix being tested
   * @returns Whether more attempts are allowed
   */
  async trackFailedAttempt(tokenPrefix: string): Promise<FailedAttemptResult> {
    const key = `${RateLimitService.FAILED_ATTEMPT_PREFIX}${tokenPrefix}`;
    try {
      const { count, reset_in } = await this.increment(key, RateLimitService.FAILED_ATTEMPT_WINDOW);
      const allowed = count <= RateLimitService.FAILED_ATTEMPT_LIMIT;
      return {
        allowed,
        attemptsRemaining: Math.max(0, RateLimitService.FAILED_ATTEMPT_LIMIT - count),
        lockoutSeconds: allowed ? 0 : reset_in,
      };
    } catch (error) {
      console.error('Failed attempt tracking failed:', error);
      return {
        allowed: true,
        attemptsRemaining: RateLimitService.FAILED_ATTEMPT_LIMIT,
        lockoutSeconds: 0,
      };
    }
  }

  /**
   * Check if a token prefix is currently locked out.
   * @param tokenPrefix The 12-char token prefix
   * @returns Whether the prefix is locked out and when it resets
   */
  async isLockedOut(tokenPrefix: string): Promise<{ lockedOut: boolean; resetIn: number }> {
    const key = `${RateLimitService.FAILED_ATTEMPT_PREFIX}${tokenPrefix}`;
    try {
      const rows = await this.db.execute<CounterRow>(sql`
        SELECT count,
          greatest(0, ceil(extract(epoch FROM expires_at - now())))::int AS reset_in
        FROM rate_limit_counters
        WHERE key = ${key} AND expires_at > now()
        ORDER BY bucket_start DESC
        LIMIT 1
      `);
      const row = rows[0];
      if (!row) return { lockedOut: false, resetIn: 0 };
      const lockedOut = row.count > RateLimitService.FAILED_ATTEMPT_LIMIT;
      return { lockedOut, resetIn: lockedOut ? row.reset_in : 0 };
    } catch (error) {
      console.error('Lockout check failed:', error);
      return { lockedOut: false, resetIn: 0 };
    }
  }

  /**
   * Clear failed attempts for a token prefix (e.g., after successful auth).
   * @param tokenPrefix The 12-char token prefix
   */
  async clearFailedAttempts(tokenPrefix: string): Promise<void> {
    const key = `${RateLimitService.FAILED_ATTEMPT_PREFIX}${tokenPrefix}`;
    await this.db.execute(sql`DELETE FROM rate_limit_counters WHERE key = ${key}`);
  }

  /**
   * Read the cached daily token usage for a token (valid until midnight UTC).
   * Note: Daily token tracking is still done in the database for persistence.
   * This method is just for checking/caching the current state.
   */
  async getDailyUsageCache(
    tokenId: string
  ): Promise<{ cached: boolean; tokensUsed: number } | null> {
    const key = `${RateLimitService.DAILY_USAGE_PREFIX}${tokenId}`;
    const rows = await this.db.execute<{ count: number }>(sql`
      SELECT count FROM rate_limit_counters
      WHERE key = ${key} AND expires_at > now()
      ORDER BY bucket_start DESC
      LIMIT 1
    `);
    const row = rows[0];
    return row ? { cached: true, tokensUsed: row.count } : null;
  }

  /**
   * Update daily usage cache. The entry expires at the next midnight UTC.
   */
  async setDailyUsageCache(tokenId: string, tokensUsed: number): Promise<void> {
    const key = `${RateLimitService.DAILY_USAGE_PREFIX}${tokenId}`;
    await this.db.execute(sql`
      WITH bucket AS (
        SELECT date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' AS start
      )
      INSERT INTO rate_limit_counters (key, bucket_start, count, expires_at)
      SELECT ${key}::text, bucket.start, ${tokensUsed}::int, bucket.start + interval '1 day'
      FROM bucket
      ON CONFLICT (key, bucket_start) DO UPDATE SET count = excluded.count
    `);
    this.maybeCleanup();
  }
}
