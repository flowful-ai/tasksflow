import { hmacSha256Hex, safeEqual } from './crypto.js';

/** Verify GitHub's `X-Hub-Signature-256` header against the raw body. */
export function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  return safeEqual(signature, `sha256=${hmacSha256Hex(secret, payload)}`);
}

/** Slack rejects requests older than five minutes to prevent replays. */
export const SLACK_MAX_REQUEST_AGE_SECONDS = 60 * 5;

export type SlackVerificationResult =
  | { ok: true }
  | { ok: false; reason: 'stale_timestamp' | 'invalid_signature' };

/**
 * Verify a Slack request (`X-Slack-Request-Timestamp` + `X-Slack-Signature`):
 * the timestamp must be within five minutes of now and the v0 HMAC must match.
 */
export function verifySlackRequest(params: {
  body: string;
  timestamp: string;
  signature: string;
  secret: string;
  nowSeconds?: number;
}): SlackVerificationResult {
  const ts = Number(params.timestamp);
  const now = params.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (
    !/^\d+$/.test(params.timestamp) ||
    !Number.isSafeInteger(ts) ||
    Math.abs(now - ts) > SLACK_MAX_REQUEST_AGE_SECONDS
  ) {
    return { ok: false, reason: 'stale_timestamp' };
  }
  const expected = `v0=${hmacSha256Hex(params.secret, `v0:${params.timestamp}:${params.body}`)}`;
  return safeEqual(params.signature, expected)
    ? { ok: true }
    : { ok: false, reason: 'invalid_signature' };
}
