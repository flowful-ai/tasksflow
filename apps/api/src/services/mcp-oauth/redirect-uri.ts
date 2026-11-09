import { OAuthError } from './errors.js';

/**
 * Dynamic client registration policy for redirect URIs (RFC 6749 §3.1.2,
 * RFC 8252 §7). Accepted:
 * - https with a host;
 * - http on loopback only;
 * - reverse-domain private-use schemes (`com.example.app:`), which must
 *   contain a dot (RFC 8252 §7.1);
 * - an explicit allowlist of known MCP client schemes without a dot
 *   (DEFAULT_ALLOWED_REDIRECT_SCHEMES, extended by MCP_ALLOWED_REDIRECT_SCHEMES).
 * Everything else is rejected: OS protocol handlers (`ms-msdt:`,
 * `search-ms:`), remote schemes (`ftp:`, `ws:`, `wss:`), `javascript:`, ...
 */

export const MAX_REDIRECT_URIS = 10;
export const MAX_REDIRECT_URI_LENGTH = 2000;
export const MAX_CLIENT_NAME_LENGTH = 100;

/** Known MCP clients that register a dotless custom scheme. */
export const DEFAULT_ALLOWED_REDIRECT_SCHEMES: readonly string[] = [
  'cursor',
  'vscode',
  'vscode-insiders',
  'windsurf',
];

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const SCHEME_NAME = /^[a-z][a-z0-9+.-]*$/;
/** Never allowed, not even through MCP_ALLOWED_REDIRECT_SCHEMES. */
const FORBIDDEN_SCHEMES = new Set([
  'javascript',
  'data',
  'file',
  'vbscript',
  'blob',
  'about',
  'filesystem',
  'http',
  'https',
  'ftp',
  'ws',
  'wss',
  'search-ms',
]);

function isForbiddenScheme(scheme: string): boolean {
  return FORBIDDEN_SCHEMES.has(scheme) || scheme.startsWith('ms-');
}

/**
 * Parse MCP_ALLOWED_REDIRECT_SCHEMES (comma-separated scheme names, without
 * `:`) and add them to the defaults. Throws on an invalid or forbidden entry,
 * so a typo fails loudly instead of silently widening the policy.
 */
export function parseAllowedRedirectSchemes(raw: string | undefined): ReadonlySet<string> {
  const schemes = new Set(DEFAULT_ALLOWED_REDIRECT_SCHEMES);
  for (const entry of (raw ?? '').split(',')) {
    const scheme = entry.trim().toLowerCase();
    if (!scheme) continue;
    if (!SCHEME_NAME.test(scheme) || isForbiddenScheme(scheme)) {
      throw new Error(`MCP_ALLOWED_REDIRECT_SCHEMES: "${entry.trim()}" is not an allowed scheme`);
    }
    schemes.add(scheme);
  }
  return schemes;
}

let envAllowedSchemes: ReadonlySet<string> | null = null;

/** Allowlisted dotless schemes from the environment (parsed once). */
export function getAllowedRedirectSchemes(): ReadonlySet<string> {
  envAllowedSchemes ??= parseAllowedRedirectSchemes(process.env.MCP_ALLOWED_REDIRECT_SCHEMES);
  return envAllowedSchemes;
}

function invalid(message: string): OAuthError {
  return new OAuthError('invalid_redirect_uri', message);
}

export function validateRedirectUri(
  raw: string,
  allowedSchemes: ReadonlySet<string> = getAllowedRedirectSchemes()
): string {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > MAX_REDIRECT_URI_LENGTH) {
    throw invalid('redirect_uri must be a non-empty string under 2000 characters');
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw invalid(`redirect_uri is not an absolute URI: ${raw}`);
  }

  if (url.hash) {
    throw invalid('redirect_uri must not contain a fragment');
  }

  const scheme = url.protocol.toLowerCase().replace(/:$/, '');

  if (scheme === 'https') {
    if (!url.hostname) {
      throw invalid('https redirect_uri must include a host');
    }
    return raw;
  }

  if (scheme === 'http') {
    if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
      throw invalid('http redirect_uri is only allowed on loopback (127.0.0.1, localhost, [::1])');
    }
    return raw;
  }

  if (isForbiddenScheme(scheme)) {
    throw invalid(`redirect_uri scheme ${scheme}: is not allowed`);
  }

  // Reverse-domain private-use scheme (RFC 8252 §7.1), or an allowlisted MCP client.
  if ((SCHEME_NAME.test(scheme) && scheme.includes('.')) || allowedSchemes.has(scheme)) {
    return raw;
  }

  throw invalid(
    'redirect_uri must use https, loopback http, a reverse-domain private-use scheme ' +
      '(com.example.app:) or an allowlisted app scheme'
  );
}

export function validateRedirectUris(uris: unknown): string[] {
  if (!Array.isArray(uris) || uris.length === 0) {
    throw invalid('redirect_uris must contain at least one URI');
  }
  if (uris.length > MAX_REDIRECT_URIS) {
    throw invalid(`At most ${MAX_REDIRECT_URIS} redirect_uris may be registered`);
  }
  return Array.from(
    new Set(
      uris.map((uri) => {
        if (typeof uri !== 'string') {
          throw invalid('redirect_uris must be strings');
        }
        return validateRedirectUri(uri);
      })
    )
  );
}

export function sanitizeClientName(raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new OAuthError('invalid_client_metadata', 'client_name is required');
  }
  // Strip control characters so the consent page cannot be visually spoofed.
  const name = raw
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
  if (!name) {
    throw new OAuthError('invalid_client_metadata', 'client_name is required');
  }
  if (name.length > MAX_CLIENT_NAME_LENGTH) {
    throw new OAuthError(
      'invalid_client_metadata',
      `client_name must be at most ${MAX_CLIENT_NAME_LENGTH} characters`
    );
  }
  return name;
}

export function validateOptionalMetadataUrl(field: string, raw: unknown): string | undefined {
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  if (typeof raw !== 'string' || raw.length > MAX_REDIRECT_URI_LENGTH) {
    throw new OAuthError('invalid_client_metadata', `${field} must be a URL string`);
  }
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('bad scheme');
    }
  } catch {
    throw new OAuthError('invalid_client_metadata', `${field} must be an http(s) URL`);
  }
  return raw;
}

/** Human-readable destination shown on the consent page. */
export function describeRedirectTarget(redirectUri: string): string {
  try {
    const url = new URL(redirectUri);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.host;
    }
    return url.host
      ? `${url.protocol}//${url.host}${url.pathname}`
      : `${url.protocol}${url.pathname}`;
  } catch {
    return redirectUri;
  }
}
