import { OAuthError } from './errors.js';

/**
 * Dynamic client registration policy for redirect URIs (RFC 6749 §3.1.2,
 * RFC 8252 §7): https anywhere, http only on loopback, or a private-use
 * reverse-domain scheme such as `com.example.app:/callback`.
 */

export const MAX_REDIRECT_URIS = 10;
export const MAX_REDIRECT_URI_LENGTH = 2000;
export const MAX_CLIENT_NAME_LENGTH = 100;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const FORBIDDEN_SCHEMES = new Set(['javascript:', 'data:', 'file:', 'vbscript:', 'blob:', 'about:', 'filesystem:']);
const PRIVATE_USE_SCHEME = /^[a-z][a-z0-9+.-]*\.[a-z0-9+.-]+:$/;

function invalid(message: string): OAuthError {
  return new OAuthError('invalid_redirect_uri', message);
}

export function validateRedirectUri(raw: string): string {
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

  const scheme = url.protocol.toLowerCase();
  if (FORBIDDEN_SCHEMES.has(scheme)) {
    throw invalid(`redirect_uri scheme ${scheme} is not allowed`);
  }

  if (scheme === 'https:') {
    if (!url.hostname) {
      throw invalid('https redirect_uri must include a host');
    }
    return raw;
  }

  if (scheme === 'http:') {
    if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase())) {
      throw invalid('http redirect_uri is only allowed on loopback (127.0.0.1, localhost, [::1])');
    }
    return raw;
  }

  if (PRIVATE_USE_SCHEME.test(scheme)) {
    return raw;
  }

  throw invalid('redirect_uri must use https, loopback http, or a reverse-domain private-use scheme');
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
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  const name = raw.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '').trim();
  if (!name) {
    throw new OAuthError('invalid_client_metadata', 'client_name is required');
  }
  if (name.length > MAX_CLIENT_NAME_LENGTH) {
    throw new OAuthError('invalid_client_metadata', `client_name must be at most ${MAX_CLIENT_NAME_LENGTH} characters`);
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
    return url.host ? `${url.protocol}//${url.host}${url.pathname}` : `${url.protocol}${url.pathname}`;
  } catch {
    return redirectUri;
  }
}
