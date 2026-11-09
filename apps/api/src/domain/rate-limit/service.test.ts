import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { createDatabase } from '../../db/index.js';
import type { Database } from '../../db/index.js';
import { RateLimitService } from './service.js';

const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('RateLimitService (Postgres)', () => {
  let db: Database;
  let service: RateLimitService;
  const suffix = crypto.randomUUID();

  beforeAll(async () => {
    db = createDatabase(url);
    // The table comes from a migration; create it here too so this suite also
    // runs against a database that predates it.
    await db.execute(sql`
      CREATE UNLOGGED TABLE IF NOT EXISTS rate_limit_counters (
        key text NOT NULL,
        bucket_start timestamptz NOT NULL,
        count integer NOT NULL,
        expires_at timestamptz NOT NULL,
        PRIMARY KEY (key, bucket_start)
      )
    `);
    service = new RateLimitService(db);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM rate_limit_counters WHERE key LIKE ${'%' + suffix}`);
    await db.$client.end();
  });

  it('counts requests per minute and blocks past the limit', async () => {
    const key = `key-${suffix}`;
    const results = [];
    for (let i = 0; i < 4; i++) results.push(await service.checkMinuteLimit(key, 3));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0, 0]);
    expect(results[0]?.resetIn).toBeGreaterThan(0);
    expect(results[0]?.resetIn).toBeLessThanOrEqual(60);
  });

  it('is atomic under concurrent increments', async () => {
    const key = `concurrent-${suffix}`;
    const results = await Promise.all(
      Array.from({ length: 25 }, () => service.checkMinuteLimit(key, 10))
    );
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
  });

  it('deletes expired rows', async () => {
    const key = `expired-${suffix}`;
    await db.execute(sql`
      INSERT INTO rate_limit_counters (key, bucket_start, count, expires_at)
      VALUES (${key}, now() - interval '2 hours', 1, now() - interval '1 hour')
    `);
    await service.deleteExpired();
    const rows = await db.execute(sql`SELECT 1 FROM rate_limit_counters WHERE key = ${key}`);
    expect(rows).toHaveLength(0);
  });
});
