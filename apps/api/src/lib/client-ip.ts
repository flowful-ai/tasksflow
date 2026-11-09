import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';
import { CLIENT_IP_HEADER } from '../auth/index.js';

export { CLIENT_IP_HEADER };

/**
 * Client IP resolution that cannot be spoofed through X-Forwarded-For.
 *
 * Each trusted reverse proxy in front of the API appends the address it
 * received the connection from to X-Forwarded-For. With N trusted hops the
 * real client is the N-th entry from the right; anything to the left of it
 * was supplied by the client and is ignored.
 *
 * `TRUSTED_PROXY_HOPS` (default 1: Dokploy's Traefik) sets N. 0 ignores
 * X-Forwarded-For entirely and uses the socket address.
 *
 * The Bun server resolves the IP once per request (`resolveClientIp`) and
 * overwrites the forwarded headers (`applyClientIp`), so route code reads the
 * trusted value through `getClientIp(c)`.
 */

export const DEFAULT_TRUSTED_PROXY_HOPS = 1;
const MAX_TRUSTED_PROXY_HOPS = 10;

export function parseTrustedProxyHops(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return DEFAULT_TRUSTED_PROXY_HOPS;
  const hops = Number(value);
  if (!Number.isInteger(hops) || hops < 0) return DEFAULT_TRUSTED_PROXY_HOPS;
  return Math.min(hops, MAX_TRUSTED_PROXY_HOPS);
}

/**
 * The X-Forwarded-For entry appended by the outermost trusted proxy (index
 * len - hops), falling back to the socket address. When the header is shorter
 * than `hops` the leftmost entry was still written by a trusted proxy.
 */
export function resolveClientIp(
  forwardedFor: string | null | undefined,
  socketIp: string | null | undefined,
  hops: number
): string | null {
  const fallback = socketIp && socketIp.length > 0 ? socketIp : null;
  if (hops <= 0 || !forwardedFor) return fallback;
  const entries = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  return entries[Math.max(0, entries.length - hops)] ?? fallback;
}

/**
 * Overwrite the client-IP headers on the incoming request so that everything
 * downstream (Better Auth, route rate limits, logs) sees the trusted value:
 * the dedicated header plus a single-entry X-Forwarded-For. X-Real-IP is
 * dropped because nothing in front of the API sets it.
 */
export function applyClientIp(headers: Headers, clientIp: string | null): void {
  headers.delete('x-real-ip');
  if (clientIp) {
    headers.set(CLIENT_IP_HEADER, clientIp);
    headers.set('x-forwarded-for', clientIp);
  } else {
    headers.delete(CLIENT_IP_HEADER);
    headers.delete('x-forwarded-for');
  }
}

function socketAddressOf(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    // Not running under Bun.serve (e.g. app.request() in tests).
    return undefined;
  }
}

/**
 * The trusted client IP for a request, or 'unknown'. Prefers the header the
 * server set; resolves from the raw headers when the app runs without the Bun
 * server wrapper (tests).
 */
export function getClientIp(
  c: Context,
  trustedHops: number = parseTrustedProxyHops(process.env.TRUSTED_PROXY_HOPS)
): string {
  const resolved = c.req.header(CLIENT_IP_HEADER);
  if (resolved) return resolved;
  return resolveClientIp(c.req.header('x-forwarded-for'), socketAddressOf(c), trustedHops) ?? 'unknown';
}
