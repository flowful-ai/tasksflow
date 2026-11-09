import { describe, expect, it } from 'bun:test';
import { parseTrustedProxyHops, resolveClientIp } from './client-ip.js';

describe('parseTrustedProxyHops', () => {
  it('defaults to 1', () => {
    expect(parseTrustedProxyHops(undefined)).toBe(1);
    expect(parseTrustedProxyHops('')).toBe(1);
  });

  it('accepts non-negative integers', () => {
    expect(parseTrustedProxyHops('0')).toBe(0);
    expect(parseTrustedProxyHops('2')).toBe(2);
  });

  it('falls back to the default on garbage or negative values', () => {
    expect(parseTrustedProxyHops('abc')).toBe(1);
    expect(parseTrustedProxyHops('-1')).toBe(1);
    expect(parseTrustedProxyHops('1.5')).toBe(1);
  });
});

describe('resolveClientIp', () => {
  it('takes the entry appended by the single trusted proxy', () => {
    expect(resolveClientIp('203.0.113.7', '10.0.0.2', 1)).toBe('203.0.113.7');
  });

  it('ignores entries a client prepended to spoof its address', () => {
    expect(resolveClientIp('1.1.1.1, 2.2.2.2, 203.0.113.7', '10.0.0.2', 1)).toBe('203.0.113.7');
  });

  it('counts hops from the right', () => {
    expect(resolveClientIp('1.1.1.1, 203.0.113.7, 10.0.0.5', '10.0.0.2', 2)).toBe('203.0.113.7');
  });

  it('uses the leftmost entry when there are fewer entries than hops', () => {
    expect(resolveClientIp('203.0.113.7', '10.0.0.2', 3)).toBe('203.0.113.7');
  });

  it('ignores X-Forwarded-For entirely with zero trusted hops', () => {
    expect(resolveClientIp('1.1.1.1', '198.51.100.4', 0)).toBe('198.51.100.4');
  });

  it('falls back to the socket address, then "unknown"', () => {
    expect(resolveClientIp(undefined, '198.51.100.4', 1)).toBe('198.51.100.4');
    expect(resolveClientIp(' , ', '198.51.100.4', 1)).toBe('198.51.100.4');
    expect(resolveClientIp(null, undefined, 1)).toBe('unknown');
  });
});
