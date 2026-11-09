import { describe, expect, it } from 'bun:test';
import { resolveBaseUrl } from './base-url.js';

const spoofedHeaders = new Headers({
  'x-forwarded-proto': 'https',
  'x-forwarded-host': 'evil.example',
});

describe('resolveBaseUrl', () => {
  it('prefers PUBLIC_URL in every environment', () => {
    expect(resolveBaseUrl('http://api:3001/x', spoofedHeaders, { PUBLIC_URL: 'https://tasks.example.com/' })).toBe(
      'https://tasks.example.com'
    );
    expect(
      resolveBaseUrl('http://api:3001/x', spoofedHeaders, {
        NODE_ENV: 'production',
        PUBLIC_URL: 'https://tasks.example.com',
        BETTER_AUTH_URL: 'https://other.example.com',
      })
    ).toBe('https://tasks.example.com');
  });

  it('never trusts forwarded headers in production', () => {
    expect(
      resolveBaseUrl('http://api:3001/x', spoofedHeaders, {
        NODE_ENV: 'production',
        BETTER_AUTH_URL: 'https://tasks.example.com',
      })
    ).toBe('https://tasks.example.com');

    expect(resolveBaseUrl('http://api:3001/x', spoofedHeaders, { NODE_ENV: 'production' })).toBe('http://api:3001');
  });

  it('honours forwarded headers outside production', () => {
    expect(resolveBaseUrl('http://localhost:3001/x', spoofedHeaders, { NODE_ENV: 'development' })).toBe(
      'https://evil.example'
    );
  });

  it('falls back to the request origin without headers', () => {
    expect(resolveBaseUrl('http://localhost:3001/api/mcp', new Headers(), {})).toBe('http://localhost:3001');
  });

  it('ignores unknown forwarded protocols', () => {
    const headers = new Headers({ 'x-forwarded-proto': 'javascript', 'x-forwarded-host': 'example.com' });
    expect(resolveBaseUrl('http://localhost:3001/', headers, {})).toBe('http://example.com');
  });
});
