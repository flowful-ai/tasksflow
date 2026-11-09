import { describe, expect, it } from 'bun:test';
import { applyClientIp, parseTrustedProxyHops, resolveClientIp } from './client-ip.js';
import { shouldRunMigrations } from './migrations.js';
import { redactUrl } from './request-logger.js';
import { isSpaPath } from './spa.js';

describe('resolveClientIp', () => {
  it('takes the entry appended by the trusted proxy, ignoring spoofed ones to its left', () => {
    expect(resolveClientIp('6.6.6.6, 203.0.113.7', '10.0.0.2', 1)).toBe('203.0.113.7');
    expect(resolveClientIp('6.6.6.6, 198.51.100.1, 203.0.113.7', '10.0.0.2', 2)).toBe(
      '198.51.100.1'
    );
  });

  it('falls back to the first entry when the chain is shorter than the hop count', () => {
    expect(resolveClientIp('203.0.113.7', '10.0.0.2', 2)).toBe('203.0.113.7');
  });

  it('uses the socket address with no header or with hops = 0', () => {
    expect(resolveClientIp(null, '10.0.0.2', 1)).toBe('10.0.0.2');
    expect(resolveClientIp('6.6.6.6', '10.0.0.2', 0)).toBe('10.0.0.2');
  });

  it('parses TRUSTED_PROXY_HOPS with a default of 1', () => {
    expect(parseTrustedProxyHops(undefined)).toBe(1);
    expect(parseTrustedProxyHops('0')).toBe(0);
    expect(parseTrustedProxyHops('2')).toBe(2);
    expect(parseTrustedProxyHops('-1')).toBe(1);
    expect(parseTrustedProxyHops('abc')).toBe(1);
  });

  it('overwrites client-sent IP headers', () => {
    const headers = new Headers({
      'x-forwarded-for': '6.6.6.6, 203.0.113.7',
      'x-real-ip': '6.6.6.6',
      'x-flowtask-client-ip': '6.6.6.6',
    });
    applyClientIp(headers, '203.0.113.7');
    expect(headers.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(headers.get('x-flowtask-client-ip')).toBe('203.0.113.7');
    expect(headers.has('x-real-ip')).toBe(false);
  });
});

describe('redactUrl', () => {
  it('redacts share and invitation tokens in paths', () => {
    expect(redactUrl('/api/public/share/abc123')).toBe('/api/public/share/:redacted');
    expect(redactUrl('/api/public/share/abc123/verify')).toBe('/api/public/share/:redacted/verify');
    expect(redactUrl('/api/invitations/tok/accept')).toBe('/api/invitations/:redacted/accept');
    expect(redactUrl('/invite/tok')).toBe('/invite/:redacted');
  });

  it('redacts OAuth codes and tokens in query strings', () => {
    expect(redactUrl('/api/auth/callback/github?code=secret&state=s2&x=1')).toBe(
      '/api/auth/callback/github?code=redacted&state=redacted&x=1'
    );
    expect(redactUrl('/api/tasks?limit=50')).toBe('/api/tasks?limit=50');
  });
});

describe('isSpaPath', () => {
  it('excludes API, discovery and health paths', () => {
    expect(isSpaPath('/dashboard')).toBe(true);
    expect(isSpaPath('/apiary')).toBe(true);
    expect(isSpaPath('/api')).toBe(false);
    expect(isSpaPath('/api/tasks')).toBe(false);
    expect(isSpaPath('/.well-known/oauth-authorization-server')).toBe(false);
    expect(isSpaPath('/health')).toBe(false);
    expect(isSpaPath('/ready')).toBe(false);
  });
});

describe('shouldRunMigrations', () => {
  it('defaults to true', () => {
    expect(shouldRunMigrations(undefined)).toBe(true);
    expect(shouldRunMigrations('true')).toBe(true);
    expect(shouldRunMigrations('false')).toBe(false);
    expect(shouldRunMigrations('0')).toBe(false);
  });
});
