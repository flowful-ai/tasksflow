import type { Context } from 'hono';
import { getConnInfo } from 'hono/bun';

/**
 * Private copy of the client-IP logic (A1 owns the canonical
 * apps/api/src/lib/client-ip.ts; dedupe once it lands).
 *
 * Each trusted reverse proxy appends one X-Forwarded-For entry, so with N
 * trusted hops the client address is the entry at position len - N. Entries to
 * the left of it are client-controlled and must not be trusted.
 */

const DEFAULT_TRUSTED_PROXY_HOPS = 1;

export function readTrustedProxyHops(raw: string | undefined = process.env.TRUSTED_PROXY_HOPS): number {
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_TRUSTED_PROXY_HOPS;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_TRUSTED_PROXY_HOPS;
}

export function pickForwardedClientIp(forwardedFor: string | null | undefined, trustedHops: number): string | null {
  if (!forwardedFor || trustedHops <= 0) {
    return null;
  }
  const entries = forwardedFor
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
  const index = entries.length - trustedHops;
  if (index < 0) {
    return null;
  }
  return entries[index] ?? null;
}

function readSocketAddress(c: Context): string | null {
  try {
    return getConnInfo(c).remote.address ?? null;
  } catch {
    // app.request() in tests and non-Bun adapters have no socket info.
    return null;
  }
}

export function getClientIp(c: Context): string {
  const forwarded = pickForwardedClientIp(c.req.header('x-forwarded-for'), readTrustedProxyHops());
  return forwarded ?? readSocketAddress(c) ?? 'unknown';
}
