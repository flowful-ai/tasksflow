/**
 * Single source of truth for the public base URL of the API (used for OAuth
 * metadata, WWW-Authenticate challenges and RFC 8707 resource URIs).
 *
 * - `PUBLIC_URL` always wins when set.
 * - In production, `BETTER_AUTH_URL` is the fallback. Forwarded headers are
 *   never trusted there: a spoofed `X-Forwarded-Host` would otherwise let an
 *   attacker mint OAuth metadata pointing at their own host.
 * - Outside production, `X-Forwarded-Proto`/`X-Forwarded-Host` are honoured so
 *   the Vite dev proxy and local tunnels keep working.
 */

export interface BaseUrlEnv {
  NODE_ENV?: string;
  PUBLIC_URL?: string;
  BETTER_AUTH_URL?: string;
}

let warnedMissingProductionUrl = false;

function normalizeConfiguredUrl(value: string | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return null;
  }
}

function firstHeaderValue(value: string | null): string | null {
  const first = value?.split(',')[0]?.trim();
  return first ? first : null;
}

export function resolveBaseUrl(
  requestUrl: string,
  headers: Headers,
  env: BaseUrlEnv = process.env
): string {
  const publicUrl = normalizeConfiguredUrl(env.PUBLIC_URL);
  if (publicUrl) {
    return publicUrl;
  }

  const requestOrigin = new URL(requestUrl).origin;

  if (env.NODE_ENV === 'production') {
    const authUrl = normalizeConfiguredUrl(env.BETTER_AUTH_URL);
    if (authUrl) {
      return authUrl;
    }
    if (!warnedMissingProductionUrl) {
      warnedMissingProductionUrl = true;
      console.warn(
        'PUBLIC_URL / BETTER_AUTH_URL is not set; falling back to the request origin for OAuth metadata.'
      );
    }
    return requestOrigin;
  }

  const forwardedProto = firstHeaderValue(headers.get('x-forwarded-proto'));
  const forwardedHost = firstHeaderValue(headers.get('x-forwarded-host'));
  if (!forwardedProto && !forwardedHost) {
    return requestOrigin;
  }

  const url = new URL(requestUrl);
  const protocol =
    forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : url.protocol.replace(':', '');
  const host = forwardedHost ?? url.host;
  return `${protocol}://${host}`;
}

/** Convenience wrapper for a Fetch API request. */
export function getBaseUrl(request: Request): string {
  return resolveBaseUrl(request.url, request.headers);
}
