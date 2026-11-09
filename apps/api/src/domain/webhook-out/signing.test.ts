import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'bun:test';
import {
  generateWebhookSecret,
  maskWebhookSecret,
  signWebhookPayload,
  verifyWebhookSignature,
} from './signing.js';

describe('webhook signing', () => {
  const secret = 'whsec_test';
  const body = '{"event":"task.created"}';

  it('signs timestamp.body with HMAC-SHA256', () => {
    const expected = createHmac('sha256', secret).update(`1700000000.${body}`).digest('hex');
    expect(signWebhookPayload(secret, 1700000000, body)).toBe(`sha256=${expected}`);
  });

  it('verifies, rejecting tampering, wrong secret and stale timestamps', () => {
    const ts = 1700000000;
    const sig = signWebhookPayload(secret, ts, body);
    expect(verifyWebhookSignature(secret, ts, body, sig, { now: ts + 10 })).toBe(true);
    expect(verifyWebhookSignature(secret, ts, `${body} `, sig, { now: ts })).toBe(false);
    expect(verifyWebhookSignature('whsec_other', ts, body, sig, { now: ts })).toBe(false);
    expect(verifyWebhookSignature(secret, ts, body, sig, { now: ts + 301 })).toBe(false);
    expect(verifyWebhookSignature(secret, ts, body, 'sha256=short', { now: ts })).toBe(false);
  });

  it('generates distinct prefixed secrets and masks them', () => {
    const a = generateWebhookSecret();
    const b = generateWebhookSecret();
    expect(a).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(maskWebhookSecret(a)).toBe(`whsec_…${a.slice(-4)}`);
  });
});
