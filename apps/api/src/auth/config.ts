import { betterAuth } from 'better-auth';
import type { BetterAuthOptions } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { sql } from 'drizzle-orm';
import { getDatabase } from '../db/index.js';
import * as schema from '../db/schema.js';

/**
 * Header the API server sets on every request with the client IP it resolved
 * from X-Forwarded-For and TRUSTED_PROXY_HOPS (see apps/api/src/lib/client-ip.ts).
 * Any client-sent value is overwritten before the request reaches Better Auth.
 */
export const CLIENT_IP_HEADER = 'x-flowtask-client-ip';

type Env = Record<string, string | undefined>;

const DEV_ORIGINS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173'];

function toOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Origins allowed to make credentialed requests (Better Auth trustedOrigins and CORS).
 * Production: only WEB_URL and BETTER_AUTH_URL. Localhost origins are added only
 * when NODE_ENV is not 'production'.
 */
export function getTrustedOrigins(env: Env = process.env): string[] {
  const origins = new Set<string>();
  for (const value of [env.WEB_URL, env.BETTER_AUTH_URL]) {
    const origin = toOrigin(value);
    if (origin) origins.add(origin);
  }
  if (env.NODE_ENV !== 'production') {
    for (const origin of DEV_ORIGINS) origins.add(origin);
  }
  return [...origins];
}

/** Lower-cased emails from APP_MANAGER_EMAILS (comma-separated). Empty when unset. */
export function parseAppManagerEmails(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

// Arbitrary constant key for the "first user becomes app manager" advisory lock.
const FIRST_APP_MANAGER_LOCK_KEY = 7_340_021;

/** Exported for tests: the static (non-database) part of the Better Auth options. */
export function buildAuthOptions(env: Env = process.env) {
  return {
    baseURL: env.BETTER_AUTH_URL || 'http://localhost:3001',
    secret: env.BETTER_AUTH_SECRET,
    // Social login only. Sign-up with email/password is disabled; sign-in stays
    // enabled so accounts created with a password before v2 are not locked out.
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      autoSignIn: true,
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID || '',
        clientSecret: env.GITHUB_CLIENT_SECRET || '',
        enabled: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
      },
      google: {
        clientId: env.GOOGLE_CLIENT_ID || '',
        clientSecret: env.GOOGLE_CLIENT_SECRET || '',
        enabled: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      },
    },
    account: {
      // Pre-registration takeover guard. With no trustedProviders, Better Auth links
      // an OAuth identity to an existing user implicitly only when the provider
      // reports the email as verified AND the existing user's own email is
      // verified (requireLocalEmailVerified, default true in 1.7). Explicit
      // linkSocial also requires a provider-verified email that matches.
      accountLinking: {
        enabled: true,
        allowDifferentEmails: false,
        updateUserInfoOnLink: true,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
    },
    verification: {
      fields: {
        value: 'token',
      },
    },
    user: {
      fields: {
        image: 'avatarUrl',
      },
      additionalFields: {
        // Declared so the create hook can set it; input: false keeps clients from doing so.
        appRole: { type: 'string', required: false, defaultValue: 'user', input: false },
      },
    },
    // Enabled in every environment and shared across replicas through Postgres.
    // Paths are relative to /api/auth.
    rateLimit: {
      enabled: true,
      storage: 'database',
      modelName: 'rateLimit',
      window: 60,
      max: 100,
      customRules: {
        '/sign-in/*': { window: 60, max: 5 },
        '/sign-up/*': { window: 60, max: 3 },
        '/callback/*': { window: 60, max: 10 },
        '/oauth2/*': { window: 60, max: 10 },
        '/link-social': { window: 60, max: 5 },
        '/request-password-reset': { window: 300, max: 3 },
      },
    },
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
      ipAddress: {
        // Set by the API server from TRUSTED_PROXY_HOPS; never trusted from clients.
        ipAddressHeaders: [CLIENT_IP_HEADER],
      },
    },
    trustedOrigins: getTrustedOrigins(env),
  } satisfies BetterAuthOptions;
}

export function createAuth(options?: { baseURL?: string }) {
  const db = getDatabase();
  const appManagerEmails = parseAppManagerEmails(process.env.APP_MANAGER_EMAILS);
  const isAppManagerEmail = (email: string): boolean =>
    appManagerEmails.includes(email.toLowerCase());

  const base = buildAuthOptions();

  return betterAuth({
    ...base,
    baseURL: options?.baseURL || base.baseURL,
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verificationTokens,
        rateLimit: schema.authRateLimits,
      },
    }),
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const current = 'appRole' in user ? user.appRole : undefined;
            const role = isAppManagerEmail(user.email)
              ? 'app_manager'
              : typeof current === 'string'
                ? current
                : 'user';
            return { data: { ...user, appRole: role } };
          },
          // Fallback when APP_MANAGER_EMAILS is unset: the first account created
          // while no app manager exists is promoted. The advisory lock serialises
          // concurrent sign-ups so exactly one of them wins.
          after: async (user) => {
            if (appManagerEmails.length > 0) return;
            await db.transaction(async (tx) => {
              await tx.execute(sql`SELECT pg_advisory_xact_lock(${FIRST_APP_MANAGER_LOCK_KEY})`);
              await tx.execute(sql`
                UPDATE users SET app_role = 'app_manager', updated_at = now()
                WHERE id = ${user.id}
                  AND NOT EXISTS (SELECT 1 FROM users WHERE app_role = 'app_manager')
              `);
            });
          },
        },
      },
      session: {
        create: {
          // Existing users listed in APP_MANAGER_EMAILS are promoted on login.
          after: async (session) => {
            if (appManagerEmails.length === 0) return;
            await db.execute(sql`
              UPDATE users SET app_role = 'app_manager', updated_at = now()
              WHERE id = ${session.userId}
                AND app_role <> 'app_manager'
                AND lower(email) IN (${sql.join(
                  appManagerEmails.map((email) => sql`${email}`),
                  sql`, `
                )})
            `);
          },
        },
      },
    },
  });
}

// Export the auth instance type
export type Auth = ReturnType<typeof createAuth>;

// Singleton instance
let authInstance: Auth | null = null;

export function getAuth(): Auth {
  if (!authInstance) {
    authInstance = createAuth();
  }
  return authInstance;
}
