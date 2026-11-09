import { describe, expect, it } from 'bun:test';
import { assertSafeWebhookUrl, isPrivateAddress, parseIPv6, WebhookUrlError } from './ssrf.js';

describe('isPrivateAddress', () => {
  const cases: [string, boolean][] = [
    ['0.0.0.0', true],
    ['0.1.2.3', true],
    ['10.0.0.1', true],
    ['10.255.255.255', true],
    ['100.64.0.1', true],
    ['100.127.255.255', true],
    ['100.128.0.1', false],
    ['127.0.0.1', true],
    ['127.255.0.1', true],
    ['169.254.169.254', true],
    ['172.15.255.255', false],
    ['172.16.0.1', true],
    ['172.31.255.255', true],
    ['172.32.0.1', false],
    ['192.0.0.8', true],
    ['192.168.1.1', true],
    ['198.18.0.1', true],
    ['198.19.255.255', true],
    ['198.20.0.1', false],
    ['224.0.0.1', true],
    ['239.255.255.250', true],
    ['240.0.0.1', true],
    ['255.255.255.255', true],
    ['8.8.8.8', false],
    ['1.1.1.1', false],
    ['93.184.216.34', false],
    ['::', true],
    ['::1', true],
    ['fc00::1', true],
    ['fd12:3456::1', true],
    ['fe80::1', true],
    ['fe80::1%eth0', true],
    ['febf::1', true],
    ['ff02::1', true],
    ['::ffff:127.0.0.1', true],
    ['::ffff:7f00:1', true],
    ['::ffff:8.8.8.8', false],
    ['64:ff9b::10.0.0.1', true],
    ['64:ff9b::8.8.8.8', false],
    ['2002:c0a8:0101::1', true],
    ['2606:4700:4700::1111', false],
    ['2001:4860:4860::8888', false],
    ['not-an-ip', true],
    ['999.1.1.1', true],
  ];

  it.each(cases)('%s → private=%p', (address, expected) => {
    expect(isPrivateAddress(address)).toBe(expected);
  });

  it('parses IPv6 forms', () => {
    expect(parseIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(parseIPv6('2001:db8::')).toEqual([0x2001, 0xdb8, 0, 0, 0, 0, 0, 0]);
    expect(parseIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(parseIPv6('1:2:3:4:5:6:7:8:9')).toBeNull();
    expect(parseIPv6('1::2::3')).toBeNull();
  });
});

describe('assertSafeWebhookUrl', () => {
  const publicLookup = async () => ['93.184.216.34'];
  const privateLookup = async () => ['93.184.216.34', '10.0.0.5'];

  async function code(url: string, opts: Parameters<typeof assertSafeWebhookUrl>[1]): Promise<string | null> {
    try {
      await assertSafeWebhookUrl(url, opts);
      return null;
    } catch (error) {
      return error instanceof WebhookUrlError ? error.code : 'OTHER';
    }
  }

  it('accepts public https URLs', async () => {
    const result = await assertSafeWebhookUrl('https://hooks.example.com/x', { production: true, lookup: publicLookup });
    expect(result.addresses).toEqual(['93.184.216.34']);
  });

  it('enforces https in production only', async () => {
    expect(await code('http://hooks.example.com', { production: true, lookup: publicLookup })).toBe('HTTPS_REQUIRED');
    expect(await code('http://hooks.example.com', { production: false, lookup: publicLookup })).toBeNull();
  });

  it('rejects bad schemes, credentials and garbage', async () => {
    const opts = { production: false, lookup: publicLookup };
    expect(await code('ftp://example.com', opts)).toBe('INVALID_URL');
    expect(await code('https://user:pw@example.com', opts)).toBe('INVALID_URL');
    expect(await code('not a url', opts)).toBe('INVALID_URL');
  });

  it('blocks private resolutions and IP literals', async () => {
    expect(await code('https://evil.example.com', { lookup: privateLookup, allowPrivate: false })).toBe('PRIVATE_ADDRESS');
    expect(await code('https://127.0.0.1:8080/', { allowPrivate: false })).toBe('PRIVATE_ADDRESS');
    expect(await code('https://[::1]/', { allowPrivate: false })).toBe('PRIVATE_ADDRESS');
    expect(await code('https://[::ffff:169.254.169.254]/', { allowPrivate: false })).toBe('PRIVATE_ADDRESS');
    expect(await code('https://evil.example.com', { lookup: privateLookup, allowPrivate: true })).toBeNull();
  });

  it('reports DNS failures', async () => {
    const failing = async (): Promise<string[]> => {
      throw new Error('ENOTFOUND');
    };
    expect(await code('https://nope.invalid', { lookup: failing })).toBe('DNS_FAILED');
    expect(await code('https://empty.example', { lookup: async () => [] })).toBe('DNS_FAILED');
  });
});
