import { describe, expect, it } from 'bun:test';
import { pickForwardedClientIp, readTrustedProxyHops } from './client-ip.js';

describe('pickForwardedClientIp', () => {
  it('takes the entry appended by the last trusted hop', () => {
    expect(pickForwardedClientIp('6.6.6.6, 1.2.3.4', 1)).toBe('1.2.3.4');
    expect(pickForwardedClientIp('6.6.6.6, 1.2.3.4, 10.0.0.2', 2)).toBe('1.2.3.4');
  });

  it('returns null when the header is shorter than the hop count', () => {
    expect(pickForwardedClientIp('1.2.3.4', 2)).toBeNull();
  });

  it('ignores the header with zero trusted hops', () => {
    expect(pickForwardedClientIp('1.2.3.4', 0)).toBeNull();
    expect(pickForwardedClientIp(undefined, 1)).toBeNull();
  });
});

describe('readTrustedProxyHops', () => {
  it('defaults to one hop', () => {
    expect(readTrustedProxyHops(undefined)).toBe(1);
    expect(readTrustedProxyHops('nope')).toBe(1);
    expect(readTrustedProxyHops('0')).toBe(0);
    expect(readTrustedProxyHops('3')).toBe(3);
  });
});
