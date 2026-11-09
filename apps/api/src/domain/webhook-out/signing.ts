/**
 * Webhook signatures.
 *
 * Every delivery carries:
 *   X-FlowTask-Timestamp: <unix seconds>
 *   X-FlowTask-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
 * Receivers should recompute the HMAC over the raw body, compare in constant
 * time, and reject timestamps older than a few minutes (replay protection).
 */
import { randomToken, safeEqual } from '../../integrations/crypto.js';
import { createHmac } from 'node:crypto';

export const SIGNATURE_HEADER = 'X-FlowTask-Signature';
export const TIMESTAMP_HEADER = 'X-FlowTask-Timestamp';
export const EVENT_HEADER = 'X-FlowTask-Event';
export const DELIVERY_HEADER = 'X-FlowTask-Delivery';

export function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  const hmac = createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  return `sha256=${hmac}`;
}

export interface VerifyOptions {
  /** Reject timestamps further than this from now (default 300 s). */
  toleranceSeconds?: number;
  /** Current time in unix seconds (tests). */
  now?: number;
}

export function verifyWebhookSignature(
  secret: string,
  timestamp: number,
  body: string,
  signature: string,
  opts: VerifyOptions = {}
): boolean {
  const tolerance = opts.toleranceSeconds ?? 300;
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  if (!Number.isFinite(timestamp) || Math.abs(now - timestamp) > tolerance) return false;
  return safeEqual(signWebhookPayload(secret, timestamp, body), signature);
}

export function generateWebhookSecret(): string {
  return `whsec_${randomToken(32)}`;
}

/** "whsec_…AbCd" — safe to show after creation. */
export function maskWebhookSecret(secret: string): string {
  return `whsec_…${secret.slice(-4)}`;
}
