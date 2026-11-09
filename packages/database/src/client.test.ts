import { describe, expect, it } from 'bun:test';
import { createConnection, resolveDatabaseUrl } from './client.js';

describe('resolveDatabaseUrl', () => {
  it('prefers DATABASE_URL', () => {
    expect(resolveDatabaseUrl({ DATABASE_URL: 'postgresql://a@b/c', POSTGRES_PASSWORD: 'x' })).toBe(
      'postgresql://a@b/c'
    );
  });

  it('builds a URL from POSTGRES_* with every part encoded', () => {
    const url = resolveDatabaseUrl({
      POSTGRES_USER: 'flow task',
      POSTGRES_PASSWORD: 'p@ss:w/rd#1?%',
      POSTGRES_HOST: 'postgres',
      POSTGRES_DB: 'db',
    });
    expect(url).toBe('postgresql://flow%20task:p%40ss%3Aw%2Frd%231%3F%25@postgres:5432/db');
    const parsed = new URL(url ?? '');
    expect(decodeURIComponent(parsed.password)).toBe('p@ss:w/rd#1?%');
    expect(parsed.hostname).toBe('postgres');
  });

  it('returns undefined without DATABASE_URL or POSTGRES_PASSWORD', () => {
    expect(resolveDatabaseUrl({ POSTGRES_USER: 'x' })).toBeUndefined();
  });
});

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('createConnection (Postgres)', () => {
  it('connects with a password full of URL metacharacters', async () => {
    const admin = createConnection(url);
    const role = `pw_test_${crypto.randomUUID().slice(0, 8)}`;
    const password = 'p@ss:w/rd#1?%';
    await admin.unsafe(`CREATE ROLE ${role} LOGIN PASSWORD '${password}'`);
    try {
      const base = new URL(url ?? '');
      const built = resolveDatabaseUrl({
        POSTGRES_USER: role,
        POSTGRES_PASSWORD: password,
        POSTGRES_HOST: base.hostname,
        POSTGRES_PORT: base.port || '5432',
        POSTGRES_DB: base.pathname.slice(1),
      });
      const client = createConnection(built);
      const [row] = await client`SELECT current_user AS who`;
      expect(row?.who).toBe(role);
      await client.end();
    } finally {
      await admin.unsafe(`DROP ROLE ${role}`);
      await admin.end();
    }
  });
});
