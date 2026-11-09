import { describe, expect, it } from 'bun:test';
import { betterAuth } from 'better-auth';
import { memoryAdapter } from 'better-auth/adapters/memory';
import { buildAuthOptions, getTrustedOrigins, parseAppManagerEmails } from './config.js';

const SECRET = 'test-secret-that-is-at-least-32-characters-long';

describe('auth options', () => {
  const options = buildAuthOptions({ BETTER_AUTH_SECRET: SECRET, NODE_ENV: 'test' });

  it('disables email/password sign-up but keeps sign-in for existing accounts', () => {
    expect(options.emailAndPassword.enabled).toBe(true);
    expect(options.emailAndPassword.disableSignUp).toBe(true);
  });

  it('does not auto-link by provider name and never links a different email', () => {
    const linking = options.account.accountLinking;
    expect('trustedProviders' in linking).toBe(false);
    expect(linking.allowDifferentEmails).toBe(false);
    // requireLocalEmailVerified defaults to true in better-auth 1.7; it must not be turned off.
    expect('requireLocalEmailVerified' in linking).toBe(false);
  });

  it('rate limits in every environment with shared database storage', () => {
    expect(options.rateLimit.enabled).toBe(true);
    expect(options.rateLimit.storage).toBe('database');
    expect(options.rateLimit.customRules['/sign-in/*']).toEqual({ window: 60, max: 5 });
    expect(options.rateLimit.customRules['/callback/*']).toBeDefined();
    expect(options.advanced.ipAddress.ipAddressHeaders).toEqual(['x-flowtask-client-ip']);
  });

  it('rejects email sign-up at the API (and the same setup accepts it when enabled)', async () => {
    const makeAuth = (disableSignUp: boolean) =>
      betterAuth({
        ...options,
        emailAndPassword: { ...options.emailAndPassword, disableSignUp },
        rateLimit: { enabled: false },
        database: memoryAdapter({ user: [], session: [], account: [], verification: [] }),
      });
    const body = { email: 'someone@example.com', password: 'password-1234', name: 'x' };

    await expect(makeAuth(true).api.signUpEmail({ body })).rejects.toThrow(/sign ?up/i);
    const created = await makeAuth(false).api.signUpEmail({ body });
    expect(created.user.email).toBe(body.email);
  });
});

describe('getTrustedOrigins', () => {
  it('only allows the configured origins in production', () => {
    expect(
      getTrustedOrigins({
        NODE_ENV: 'production',
        WEB_URL: 'https://tasks.example.com/',
        BETTER_AUTH_URL: 'https://tasks.example.com',
      })
    ).toEqual(['https://tasks.example.com']);
  });

  it('adds localhost outside production', () => {
    const origins = getTrustedOrigins({
      NODE_ENV: 'development',
      WEB_URL: 'http://localhost:3000',
    });
    expect(origins).toContain('http://localhost:3000');
    expect(origins).toContain('http://localhost:5173');
  });

  it('ignores malformed URLs', () => {
    expect(getTrustedOrigins({ NODE_ENV: 'production', WEB_URL: 'not a url' })).toEqual([]);
  });
});

describe('parseAppManagerEmails', () => {
  it('splits, trims and lower-cases', () => {
    expect(parseAppManagerEmails(' Alice@Example.com, bob@example.com ,,')).toEqual([
      'alice@example.com',
      'bob@example.com',
    ]);
    expect(parseAppManagerEmails(undefined)).toEqual([]);
  });
});
