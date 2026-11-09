import { describe, expect, test } from 'bun:test';
import { createHmac } from 'crypto';
import {
  SLACK_MAX_REQUEST_AGE_SECONDS,
  verifyGitHubSignature,
  verifySlackRequest,
} from './signatures.js';

const SECRET = 'test-secret';

function githubSignature(body: string, secret = SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function slackSignature(body: string, timestamp: string, secret = SECRET): string {
  return `v0=${createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')}`;
}

describe('verifyGitHubSignature', () => {
  const body = JSON.stringify({ action: 'opened', issue: { number: 1 } });

  test('accepts a valid signature', () => {
    expect(verifyGitHubSignature(body, githubSignature(body), SECRET)).toBe(true);
  });

  test('rejects a tampered body', () => {
    expect(
      verifyGitHubSignature(body.replace('opened', 'closed'), githubSignature(body), SECRET)
    ).toBe(false);
  });

  test('rejects a signature made with another secret', () => {
    expect(verifyGitHubSignature(body, githubSignature(body, 'other'), SECRET)).toBe(false);
  });

  test('rejects wrong-length signatures without throwing', () => {
    expect(verifyGitHubSignature(body, 'sha256=abc', SECRET)).toBe(false);
    expect(verifyGitHubSignature(body, '', SECRET)).toBe(false);
    expect(verifyGitHubSignature(body, `${githubSignature(body)}00`, SECRET)).toBe(false);
  });
});

describe('verifySlackRequest', () => {
  const body = 'command=%2Fflowtask&text=&team_id=T1';
  const now = 1_800_000_000;
  const timestamp = String(now);

  test('accepts a valid, fresh request', () => {
    expect(
      verifySlackRequest({
        body,
        timestamp,
        signature: slackSignature(body, timestamp),
        secret: SECRET,
        nowSeconds: now,
      })
    ).toEqual({ ok: true });
  });

  test('rejects a tampered body', () => {
    const result = verifySlackRequest({
      body: `${body}&extra=1`,
      timestamp,
      signature: slackSignature(body, timestamp),
      secret: SECRET,
      nowSeconds: now,
    });
    expect(result).toEqual({ ok: false, reason: 'invalid_signature' });
  });

  test('rejects wrong-length signatures without throwing', () => {
    expect(
      verifySlackRequest({
        body,
        timestamp,
        signature: 'v0=short',
        secret: SECRET,
        nowSeconds: now,
      })
    ).toEqual({
      ok: false,
      reason: 'invalid_signature',
    });
  });

  test('rejects replays outside the 5-minute window, even with a valid signature', () => {
    const old = String(now - SLACK_MAX_REQUEST_AGE_SECONDS - 1);
    expect(
      verifySlackRequest({
        body,
        timestamp: old,
        signature: slackSignature(body, old),
        secret: SECRET,
        nowSeconds: now,
      })
    ).toEqual({ ok: false, reason: 'stale_timestamp' });

    const future = String(now + SLACK_MAX_REQUEST_AGE_SECONDS + 1);
    expect(
      verifySlackRequest({
        body,
        timestamp: future,
        signature: slackSignature(body, future),
        secret: SECRET,
        nowSeconds: now,
      })
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });

  test('accepts a request at the edge of the window', () => {
    const edge = String(now - SLACK_MAX_REQUEST_AGE_SECONDS);
    expect(
      verifySlackRequest({
        body,
        timestamp: edge,
        signature: slackSignature(body, edge),
        secret: SECRET,
        nowSeconds: now,
      })
    ).toEqual({ ok: true });
  });

  test('rejects a non-numeric timestamp', () => {
    expect(
      verifySlackRequest({
        body,
        timestamp: 'abc',
        signature: slackSignature(body, 'abc'),
        secret: SECRET,
        nowSeconds: now,
      })
    ).toEqual({ ok: false, reason: 'stale_timestamp' });
  });
});
