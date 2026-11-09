/**
 * SSRF guard for outgoing webhook URLs.
 *
 * - Production requires https; elsewhere http and https are allowed.
 * - Credentials in the URL are rejected.
 * - The host is resolved (or taken as an IP literal) and every address must be
 *   public: loopback, private, link-local, CGNAT, multicast, reserved and
 *   IPv6 equivalents (including IPv4-mapped/NAT64/6to4 embeddings) are blocked,
 *   unless ALLOW_PRIVATE_WEBHOOK_TARGETS=true.
 *
 * Known limit: fetch() resolves the host again, so a DNS-rebinding attacker
 * with a very short TTL could still race the check. The deliver handler checks
 * again right before every attempt and never follows redirects.
 */
import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export type WebhookUrlErrorCode = 'INVALID_URL' | 'HTTPS_REQUIRED' | 'PRIVATE_ADDRESS' | 'DNS_FAILED';

export class WebhookUrlError extends Error {
  readonly code: WebhookUrlErrorCode;

  constructor(code: WebhookUrlErrorCode, message: string) {
    super(message);
    this.name = 'WebhookUrlError';
    this.code = code;
  }
}

export type HostLookup = (hostname: string) => Promise<string[]>;

export interface SafeUrlOptions {
  /** Require https (default: NODE_ENV === 'production'). */
  production?: boolean;
  /** Skip the private-address check (default: ALLOW_PRIVATE_WEBHOOK_TARGETS === 'true'). */
  allowPrivate?: boolean;
  /** DNS resolver (default: node:dns lookup with all: true). */
  lookup?: HostLookup;
}

export interface SafeUrl {
  url: URL;
  addresses: string[];
}

const defaultLookup: HostLookup = async (hostname) => {
  const results = await dnsLookup(hostname, { all: true, verbatim: true });
  return results.map((r) => r.address);
};

// ---------- IPv4 ----------

/** Parse dotted-quad IPv4 into an unsigned 32-bit number, or null. */
export function parseIPv4(address: string): number | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const n = Number(part);
    if (n > 255) return null;
    value = value * 256 + n;
  }
  return value;
}

const BLOCKED_V4: readonly (readonly [string, number])[] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

function inV4Range(value: number, base: string, prefix: number): boolean {
  const baseValue = parseIPv4(base);
  if (baseValue === null) return false;
  const size = 2 ** (32 - prefix);
  return Math.floor(value / size) === Math.floor(baseValue / size);
}

export function isPrivateIPv4(value: number): boolean {
  return BLOCKED_V4.some(([base, prefix]) => inV4Range(value, base, prefix));
}

// ---------- IPv6 ----------

/** Parse an IPv6 address (with optional embedded IPv4 tail / zone id) into 8 hextets, or null. */
export function parseIPv6(address: string): number[] | null {
  let input = address.trim();
  const zone = input.indexOf('%');
  if (zone !== -1) input = input.slice(0, zone);
  if (input.startsWith('[') && input.endsWith(']')) input = input.slice(1, -1);
  if (!input.includes(':')) return null;

  let tail: number[] = [];
  const lastColon = input.lastIndexOf(':');
  const last = input.slice(lastColon + 1);
  if (last.includes('.')) {
    const v4 = parseIPv4(last);
    if (v4 === null) return null;
    tail = [Math.floor(v4 / 65536), v4 % 65536];
    input = `${input.slice(0, lastColon + 1)}x`;
  }

  const halves = input.split('::');
  if (halves.length > 2) return null;
  const parseGroups = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const group of part.split(':')) {
      if (group === 'x') {
        groups.push(...tail);
        continue;
      }
      if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
      groups.push(parseInt(group, 16));
    }
    return groups;
  };
  const head = parseGroups(halves[0]!);
  const rest = halves.length === 2 ? parseGroups(halves[1]!) : [];
  if (!head || !rest) return null;

  if (halves.length === 2) {
    const missing = 8 - head.length - rest.length;
    if (missing < 1) return null;
    return [...head, ...new Array<number>(missing).fill(0), ...rest];
  }
  return head.length === 8 ? head : null;
}

function embeddedV4(hextets: number[], hi: number): number {
  return hextets[hi]! * 65536 + hextets[hi + 1]!;
}

export function isPrivateIPv6(hextets: number[]): boolean {
  const [h0 = 0, h1 = 0, h2 = 0, h3 = 0, h4 = 0, h5 = 0] = hextets;
  // ::/96 (unspecified, loopback, deprecated IPv4-compatible) and ::ffff:0:0/96 (IPv4-mapped)
  if (h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0 && h4 === 0 && (h5 === 0 || h5 === 0xffff)) {
    return isPrivateIPv4(embeddedV4(hextets, 6));
  }
  // 64:ff9b::/96 NAT64
  if (h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0) {
    return isPrivateIPv4(embeddedV4(hextets, 6));
  }
  // 2002::/16 6to4: IPv4 in hextets 1-2
  if (h0 === 0x2002) return isPrivateIPv4(embeddedV4(hextets, 1));
  if ((h0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((h0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((h0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((h0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (h0 === 0x0100 && h1 === 0 && h2 === 0 && h3 === 0) return true; // 100::/64 discard
  if (h0 === 0x2001 && h1 === 0x0db8) return true; // 2001:db8::/32 documentation
  return false;
}

/** True when the address is not publicly routable (or unparseable — fail closed). */
export function isPrivateAddress(address: string): boolean {
  const v4 = parseIPv4(address);
  if (v4 !== null) return isPrivateIPv4(v4);
  const v6 = parseIPv6(address);
  if (v6 !== null) return isPrivateIPv6(v6);
  return true;
}

/**
 * Validate a webhook URL and resolve its host. Throws WebhookUrlError.
 */
export async function assertSafeWebhookUrl(rawUrl: string, opts: SafeUrlOptions = {}): Promise<SafeUrl> {
  const production = opts.production ?? process.env.NODE_ENV === 'production';
  const allowPrivate = opts.allowPrivate ?? process.env.ALLOW_PRIVATE_WEBHOOK_TARGETS === 'true';
  const lookup = opts.lookup ?? defaultLookup;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new WebhookUrlError('INVALID_URL', 'Webhook URL is not a valid URL');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new WebhookUrlError('INVALID_URL', 'Webhook URL must use http or https');
  }
  if (production && url.protocol !== 'https:') {
    throw new WebhookUrlError('HTTPS_REQUIRED', 'Webhook URL must use https');
  }
  if (url.username || url.password) {
    throw new WebhookUrlError('INVALID_URL', 'Webhook URL must not contain credentials');
  }

  const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
  if (!host) throw new WebhookUrlError('INVALID_URL', 'Webhook URL has no host');

  let addresses: string[];
  if (isIP(host)) {
    addresses = [host];
  } else {
    try {
      addresses = await lookup(host);
    } catch {
      throw new WebhookUrlError('DNS_FAILED', `Could not resolve ${host}`);
    }
    if (addresses.length === 0) throw new WebhookUrlError('DNS_FAILED', `Could not resolve ${host}`);
  }

  if (!allowPrivate) {
    const blocked = addresses.find(isPrivateAddress);
    if (blocked) {
      throw new WebhookUrlError('PRIVATE_ADDRESS', `Webhook host ${host} resolves to a private or reserved address`);
    }
  }

  return { url, addresses };
}
