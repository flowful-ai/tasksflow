import type { Context, MiddlewareHandler } from 'hono';
import { Redis } from 'ioredis';
import { RateLimitService, type RateLimitResult } from '@flowtask/domain';
import { getClientIp } from './client-ip.js';

/**
 * Per-client-IP minute limits for the public OAuth endpoints and the MCP
 * transport. Only the RateLimitService public interface is used here, so the
 * Postgres reimplementation can be swapped in by changing createLimiter().
 */

type MinuteLimiter = Pick<RateLimitService, 'checkMinuteLimit'>;

let limiter: MinuteLimiter | null = null;

function createLimiter(): MinuteLimiter {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
  return new RateLimitService(new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 1 }));
}

function getLimiter(): MinuteLimiter {
  if (!limiter) {
    limiter = createLimiter();
  }
  return limiter;
}

/** Test hook: replace the limiter (pass null to restore the default). */
export function setMcpRateLimiter(next: MinuteLimiter | null): void {
  limiter = next;
}

export const MCP_RATE_LIMITS = {
  register: 10,
  token: 30,
  mcp: 120,
} as const;

async function checkLimit(key: string, limit: number): Promise<RateLimitResult> {
  try {
    return await getLimiter().checkMinuteLimit(key, limit);
  } catch (error) {
    // Fail open: an unavailable limiter must not take the MCP server down.
    console.error('MCP rate limiter unavailable', error instanceof Error ? error.message : error);
    return { allowed: true, remaining: limit, resetIn: 60 };
  }
}

export function ipRateLimit(bucket: keyof typeof MCP_RATE_LIMITS, onLimited: (c: Context, resetIn: number) => Response): MiddlewareHandler {
  return async (c, next) => {
    const limit = MCP_RATE_LIMITS[bucket];
    const result = await checkLimit(`mcp:${bucket}:${getClientIp(c)}`, limit);
    c.header('RateLimit-Limit', String(limit));
    c.header('RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      c.header('Retry-After', String(result.resetIn));
      return onLimited(c, result.resetIn);
    }
    await next();
  };
}
