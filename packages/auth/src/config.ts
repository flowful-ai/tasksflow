import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { getDatabase } from '@flowtask/database';
import * as schema from '@flowtask/database/schema';

export function createAuth(options?: { baseURL?: string }) {
  const db = getDatabase();

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: schema.users,
        session: schema.sessions,
        account: schema.accounts,
        verification: schema.verificationTokens,
      },
    }),
    baseURL: options?.baseURL || process.env.BETTER_AUTH_URL || 'http://localhost:3001',
    advanced: {
      database: {
        generateId: () => crypto.randomUUID(),
      },
    },
    secret: process.env.BETTER_AUTH_SECRET,
    emailAndPassword: {
      enabled: true,
      autoSignIn: true,
    },
    socialProviders: {
      github: {
        clientId: process.env.GITHUB_CLIENT_ID || '',
        clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
        enabled: Boolean(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      },
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        enabled: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
    },
    user: {
      fields: {
        image: 'avatarUrl',
      },
    },
    trustedOrigins: [
      'http://localhost:3000',
      'http://localhost:3001',
      process.env.WEB_URL || '',
    ].filter(Boolean),
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

// For testing - allows resetting the singleton
export function resetAuth(): void {
  authInstance = null;
}
