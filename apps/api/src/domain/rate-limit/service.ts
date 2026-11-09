import { sql } from 'drizzle-orm';
import { getDatabase } from '../../db/index.js';
import type { Database } from '../../db/index.js';

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetIn: number; // seconds until reset
}

type CounterRow = { count: number; reset_in: number };

/**
 * Fixed-window rate limiting on the UNLOGGED Postgres table rate_limit_counters
 * (key, bucket_start, count, expires_at; primary key (key, bucket_start)), so the
 * limits hold across API replicas without Redis. Used for the per-client-IP
 * minute limits on the MCP and OAuth endpoints (lib/mcp/rate-limit.ts).
 *
 * checkMinuteLimit fails open (allows) if the database errors.
 */
export class RateLimitService {
  private static readonly MINUTE_LIMIT_PREFIX = 'ratelimit:minute:';
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

  /** Count one request for `key` in the current minute and report whether it is within `limit`. */
  async checkMinuteLimit(key: string, limit: number): Promise<RateLimitResult> {
    const counterKey = `${RateLimitService.MINUTE_LIMIT_PREFIX}${key}`;
    try {
      const { count, reset_in } = await this.increment(counterKey, 60);
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
}
