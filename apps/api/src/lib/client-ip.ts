import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';

/**
 * Client IP resolution that cannot be spoofed through X-Forwarded-For.
 *
 * Each trusted reverse proxy in front of the API appends the address it
 * received the connection from to X-Forwarded-For. With N trusted hops the
 * real client is therefore the N-th entry from the right; anything to the
 * left of it was supplied by the client and is ignored.
 *
 * `TRUSTED_PROXY_HOPS` (default 1: Traefik in front of the API) sets N. Set
 * it to 0 when the API is exposed directly; X-Forwarded-For is then ignored
 * and the socket address is used.
 */

export const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 10;

export function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return DEFAULT_TRUSTED_PROXY_HOPS;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return DEFAULT_TRUSTED_PROXY_HOPS;
  return Math.min(parsed, MAX_TRUSTED_PROXY_HOPS);
}

/** Pure resolution from the raw header, the socket address and the hop count. */
export function resolveClientIp(
  forwardedFor: string | null | undefined,
  socketAddress: string | null | undefined,
  trustedHops: number
): string {
  const fallback = socketAddress && socketAddress.length > 0 ? socketAddress : 'unknown';
  if (trustedHops <= 0 || !forwardedFor) return fallback;

  const entries = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  if (entries.length === 0) return fallback;

  // Fewer entries than trusted hops: the leftmost one was still written by a
  // trusted proxy, so it is the best available client address.
  const index = Math.max(0, entries.length - trustedHops);
  return entries[index] ?? fallback;
}

function socketAddressOf(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // Not running under Bun.serve (e.g. app.request() in tests).
    return undefined;
  }
}

export function getClientIp(c: Context, trustedHops = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS)): string {
  return resolveClientIp(c.req.header('x-forwarded-for'), socketAddressOf(c), trustedHops);
}
