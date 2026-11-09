import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { inArray, eq } from 'drizzle-orm';
import { getDatabase } from '../db/index.js';
import { users } from '../db/schema.js';
import { createAuth } from './config.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('app manager bootstrap (Postgres)', () => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const emails: string[] = [];
  const email = (name: string): string => {
    const value = `${name}-${suffix}@example.test`;
    emails.push(value);
    return value;
  };

  beforeAll(() => {
    process.env.DATABASE_URL = url;
    process.env.BETTER_AUTH_SECRET = 'test-secret-that-is-at-least-32-characters-long';
  });

  afterAll(async () => {
    await getDatabase().delete(users).where(inArray(users.email, emails));
  });

  async function roleOf(address: string): Promise<string | undefined> {
    const [row] = await getDatabase()
      .select({ appRole: users.appRole })
      .from(users)
      .where(eq(users.email, address));
    return row?.appRole;
  }

  it('promotes exactly one of several concurrent first sign-ups when APP_MANAGER_EMAILS is unset', async () => {
    delete process.env.APP_MANAGER_EMAILS;
    const db = getDatabase();
    const before = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.appRole, 'app_manager'));

    const ctx = await createAuth().$context;
    const batch = Array.from({ length: 5 }, (_, i) => email(`first${i}`));
    await Promise.all(
      batch.map((address) =>
        ctx.internalAdapter.createUser(
          { email: address, name: address, emailVerified: true },
          { method: 'admin' }
        )
      )
    );
    const roles = await Promise.all(batch.map(roleOf));
    const promoted = roles.filter((role) => role === 'app_manager').length;
    // With an app manager already present nobody new is promoted; otherwise exactly one is.
    expect(promoted).toBe(before.length > 0 ? 0 : 1);
  });

  it('promotes APP_MANAGER_EMAILS on sign-up and on login, and nobody else', async () => {
    const listed = email('listed');
    const existing = email('existing');
    const other = email('other');
    process.env.APP_MANAGER_EMAILS = `${listed.toUpperCase()}, ${existing}`;

    // "existing" signed up before the variable was set.
    const [existingRow] = await getDatabase()
      .insert(users)
      .values({ email: existing, name: 'existing' })
      .returning({ id: users.id });
    if (!existingRow) throw new Error('insert returned no row');

    const ctx = await createAuth().$context;
    await ctx.internalAdapter.createUser(
      { email: listed, name: 'l', emailVerified: true },
      { method: 'admin' }
    );
    const otherUser = await ctx.internalAdapter.createUser(
      { email: other, name: 'o', emailVerified: true },
      { method: 'admin' }
    );
    expect(await roleOf(listed)).toBe('app_manager');
    expect(await roleOf(other)).toBe('user');

    expect(await roleOf(existing)).toBe('user');
    await ctx.internalAdapter.createSession(existingRow.id);
    await ctx.internalAdapter.createSession(otherUser.id);
    expect(await roleOf(existing)).toBe('app_manager');
    expect(await roleOf(other)).toBe('user');

    delete process.env.APP_MANAGER_EMAILS;
  });
});
