import type { MiddlewareHandler } from 'hono';
import { secureHeaders } from 'hono/secure-headers';

/**
 * CSP for the SPA (index.html). Matches what the built app loads: its own
 * hashed bundles, Google Fonts and Fontshare stylesheets and fonts, GitHub and
 * Google avatars, and same-origin API/SSE calls. Markdown images from other
 * hosts are blocked on purpose (they are an exfiltration channel).
 */
export const SPA_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' https://fonts.googleapis.com https://api.fontshare.com",
  "font-src 'self' data: https://fonts.gstatic.com https://cdn.fontshare.com",
  "img-src 'self' data: https://avatars.githubusercontent.com https://lh3.googleusercontent.com",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

/**
 * Baseline for everything else (JSON, and server-rendered pages such as the
 * MCP consent screen that still use inline styles and scripts).
 */
export const DEFAULT_CSP = "frame-ancestors 'none'; base-uri 'self'; object-src 'none'";

/** nosniff, X-Frame-Options DENY, Referrer-Policy, HSTS in production, and a CSP. */
export function securityHeaders(isProduction: boolean): MiddlewareHandler {
  const base = secureHeaders({
    xFrameOptions: 'DENY',
    xContentTypeOptions: 'nosniff',
    referrerPolicy: 'strict-origin-when-cross-origin',
    strictTransportSecurity: isProduction ? 'max-age=31536000; includeSubDomains' : false,
  });
  return async (c, next) => {
    await base(c, async () => {
      await next();
      if (!c.res.headers.has('Content-Security-Policy')) {
        c.res.headers.set('Content-Security-Policy', DEFAULT_CSP);
      }
    });
  };
}
