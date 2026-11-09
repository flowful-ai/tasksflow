import type { MiddlewareHandler } from 'hono';

// Path segments that carry a secret: /share/<token>, /invitations/<token>,
// /invite/<token> (SPA). Matched anywhere in the path, so /api/public/share/x
// and /share/x are both covered.
const SECRET_SEGMENT = /\/(share|invitations|invite)\/[^/?#]+/g;

// Query parameters whose values must never reach the logs (OAuth codes and
// state, tokens, PKCE verifiers, passwords).
const SECRET_PARAMS = new Set([
  'code',
  'state',
  'token',
  'access_token',
  'refresh_token',
  'id_token',
  'client_secret',
  'code_verifier',
  'password',
  'secret',
]);

/** Path plus query with secrets replaced, safe to log. */
export function redactUrl(pathAndQuery: string): string {
  const queryStart = pathAndQuery.indexOf('?');
  const path = queryStart === -1 ? pathAndQuery : pathAndQuery.slice(0, queryStart);
  const redactedPath = path.replace(SECRET_SEGMENT, '/$1/:redacted');
  if (queryStart === -1) return redactedPath;

  const params = new URLSearchParams(pathAndQuery.slice(queryStart + 1));
  for (const key of [...params.keys()]) {
    if (SECRET_PARAMS.has(key.toLowerCase())) params.set(key, 'redacted');
  }
  const query = params.toString();
  return query ? `${redactedPath}?${query}` : redactedPath;
}

/** Access log line per request, with tokens in paths and query strings redacted. */
export function requestLogger(): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const url = new URL(c.req.url);
    const ms = Math.round(performance.now() - start);
    console.log(`${c.req.method} ${redactUrl(url.pathname + url.search)} ${c.res.status} ${ms}ms`);
  };
}
