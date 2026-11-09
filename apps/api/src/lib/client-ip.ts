import { CLIENT_IP_HEADER } from '@flowtask/auth';

export { CLIENT_IP_HEADER };

/**
 * Number of reverse proxies in front of the API that append to X-Forwarded-For.
 * Default 1: Dokploy's Traefik appends the address it received the request from.
 * 0 ignores X-Forwarded-For entirely and uses the socket address.
 */
export function parseTrustedProxyHops(value: string | undefined): number {
  if (value === undefined || value.trim() === '') return 1;
  const hops = Number(value);
  return Number.isInteger(hops) && hops >= 0 ? hops : 1;
}

/**
 * The client IP: the X-Forwarded-For entry appended by the outermost trusted
 * proxy (index len - hops), falling back to the socket address. Entries to the
 * left of it are client-controlled and ignored. When the header is shorter than
 * `hops` the request skipped an outer proxy, and its first entry is the peer the
 * inner proxy saw.
 */
export function resolveClientIp(
  forwardedFor: string | null,
  socketIp: string | null,
  hops: number
): string | null {
  if (hops > 0 && forwardedFor) {
    const entries = forwardedFor
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0);
    const picked = entries[Math.max(0, entries.length - hops)];
    if (picked) return picked;
  }
  return socketIp;
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
