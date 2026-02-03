import type { Redis } from 'ioredis';

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

/**
 * Rate limiting service using Redis for distributed rate limiting.
 * Used for per-minute API token rate limits and failed attempt tracking.
 */
export class RateLimitService {
  private static readonly MINUTE_LIMIT_PREFIX = 'ratelimit:token:minute:';
  private static readonly FAILED_ATTEMPT_PREFIX = 'ratelimit:failed:';
  private static readonly FAILED_ATTEMPT_LIMIT = 10;
  private static readonly FAILED_ATTEMPT_WINDOW = 300; // 5 minutes

  constructor(private redis: Redis) {}

  /**
   * Check and increment per-minute rate limit for a token.
   * @param tokenId The token ID to rate limit
   * @param limit Maximum requests per minute
   * @returns Whether the request is allowed and remaining quota
   */
  async checkMinuteLimit(tokenId: string, limit: number): Promise<RateLimitResult> {
    const key = `${RateLimitService.MINUTE_LIMIT_PREFIX}${tokenId}`;

    // Use Redis MULTI for atomic increment and TTL check
    const multi = this.redis.multi();
    multi.incr(key);
    multi.ttl(key);

    const results = await multi.exec();
    if (!results) {
      // Redis error - fail open (allow) but log
      console.error('Redis MULTI failed for rate limit check');
      return { allowed: true, remaining: limit, resetIn: 60 };
    }

    const [[incrErr, current], [ttlErr, ttl]] = results as [[Error | null, number], [Error | null, number]];

    if (incrErr || ttlErr) {
      console.error('Redis rate limit error:', incrErr || ttlErr);
      return { allowed: true, remaining: limit, resetIn: 60 };
    }

    // Set expiry on first request
    if (current === 1) {
      await this.redis.expire(key, 60);
    }

    const resetIn = ttl > 0 ? ttl : 60;

    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      resetIn,
    };
  }

  /**
   * Track failed authentication attempt for a token prefix.
   * Used to implement lockout after repeated failures.
   * @param tokenPrefix The 12-char token prefix being tested
   * @returns Whether more attempts are allowed
   */
  async trackFailedAttempt(tokenPrefix: string): Promise<FailedAttemptResult> {
    const key = `${RateLimitService.FAILED_ATTEMPT_PREFIX}${tokenPrefix}`;

    const multi = this.redis.multi();
    multi.incr(key);
    multi.ttl(key);

    const results = await multi.exec();
    if (!results) {
      console.error('Redis MULTI failed for failed attempt tracking');
      return { allowed: true, attemptsRemaining: RateLimitService.FAILED_ATTEMPT_LIMIT, lockoutSeconds: 0 };
    }

    const [[incrErr, count], [ttlErr, ttl]] = results as [[Error | null, number], [Error | null, number]];

    if (incrErr || ttlErr) {
      console.error('Redis failed attempt error:', incrErr || ttlErr);
      return { allowed: true, attemptsRemaining: RateLimitService.FAILED_ATTEMPT_LIMIT, lockoutSeconds: 0 };
    }

    // Set expiry on first failure
    if (count === 1) {
      await this.redis.expire(key, RateLimitService.FAILED_ATTEMPT_WINDOW);
    }

    const lockoutSeconds = ttl > 0 ? ttl : RateLimitService.FAILED_ATTEMPT_WINDOW;
    const allowed = count <= RateLimitService.FAILED_ATTEMPT_LIMIT;

    return {
      allowed,
      attemptsRemaining: Math.max(0, RateLimitService.FAILED_ATTEMPT_LIMIT - count),
      lockoutSeconds: allowed ? 0 : lockoutSeconds,
    };
  }

  /**
   * Check if a token prefix is currently locked out.
   * @param tokenPrefix The 12-char token prefix
   * @returns Whether the prefix is locked out and when it resets
   */
  async isLockedOut(tokenPrefix: string): Promise<{ lockedOut: boolean; resetIn: number }> {
    const key = `${RateLimitService.FAILED_ATTEMPT_PREFIX}${tokenPrefix}`;

    const multi = this.redis.multi();
    multi.get(key);
    multi.ttl(key);

    const results = await multi.exec();
    if (!results) {
      return { lockedOut: false, resetIn: 0 };
    }

    const [[getErr, countStr], [ttlErr, ttl]] = results as [[Error | null, string | null], [Error | null, number]];

    if (getErr || ttlErr || !countStr) {
      return { lockedOut: false, resetIn: 0 };
    }

    const count = parseInt(countStr, 10);
    const lockedOut = count > RateLimitService.FAILED_ATTEMPT_LIMIT;

    return {
      lockedOut,
      resetIn: lockedOut && ttl > 0 ? ttl : 0,
    };
  }

  /**
   * Clear failed attempts for a token prefix (e.g., after successful auth).
   * @param tokenPrefix The 12-char token prefix
   */
  async clearFailedAttempts(tokenPrefix: string): Promise<void> {
    const key = `${RateLimitService.FAILED_ATTEMPT_PREFIX}${tokenPrefix}`;
    await this.redis.del(key);
  }

  /**
   * Update the last used timestamp and check daily token limit.
   * Returns whether the daily limit is exceeded.
   * Note: Daily token tracking is still done in the database for persistence.
   * This method is just for checking/caching the current state.
   */
  async getDailyUsageCache(tokenId: string): Promise<{ cached: boolean; tokensUsed: number } | null> {
    const key = `ratelimit:token:daily:${tokenId}`;
    const cached = await this.redis.get(key);

    if (cached === null) {
      return null;
    }

    return { cached: true, tokensUsed: parseInt(cached, 10) };
  }

  /**
   * Update daily usage cache.
   */
  async setDailyUsageCache(tokenId: string, tokensUsed: number): Promise<void> {
    const key = `ratelimit:token:daily:${tokenId}`;
    // Cache expires at midnight UTC
    const now = new Date();
    const midnight = new Date(now);
    midnight.setUTCHours(24, 0, 0, 0);
    const ttl = Math.ceil((midnight.getTime() - now.getTime()) / 1000);

    await this.redis.set(key, tokensUsed.toString(), 'EX', ttl);
  }
}
