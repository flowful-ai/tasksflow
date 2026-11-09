import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, like, sql } from 'drizzle-orm';
import { createDatabase, jobs, type Database, type Job } from '../../db/index.js';
import { enqueueJob } from './queue.js';
import { recurring, ensureRecurringJob, recurringJobKey } from './recurring.js';
import { computeBackoffMs, createJobRunner } from './runner.js';
import { JobRetryLater, type JobHandlers } from './types.js';

describe('computeBackoffMs', () => {
  it('grows exponentially from 5 s and caps at 1 h', () => {
    const mid = () => 0.5; // jitter factor 1.0
    expect(computeBackoffMs(1, mid)).toBe(5_000);
    expect(computeBackoffMs(2, mid)).toBe(10_000);
    expect(computeBackoffMs(5, mid)).toBe(80_000);
    expect(computeBackoffMs(20, mid)).toBe(3_600_000);
    expect(computeBackoffMs(1000, mid)).toBe(3_600_000);
  });

  it('applies ±20% jitter', () => {
    expect(computeBackoffMs(1, () => 0)).toBe(4_000);
    expect(computeBackoffMs(1, () => 1)).toBe(6_000);
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)('job queue (integration)', () => {
  let db: Database;
  const prefix = `test.${randomUUID().slice(0, 8)}`;
  const t = (name: string) => `${prefix}.${name}`;

  async function getJob(id: string): Promise<Job> {
    const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
    if (!row) throw new Error(`job ${id} missing`);
    return row;
  }

  beforeAll(() => {
    db = createDatabase(TEST_DB);
  });

  afterAll(async () => {
    await db.delete(jobs).where(like(jobs.type, `${prefix}.%`));
  });

  it('enqueues, dedupes by key, and accepts a transaction', async () => {
    const key = `${prefix}:singleton`;
    const first = await enqueueJob(db, t('dedupe'), { n: 1 }, { key });
    const second = await enqueueJob(db, t('dedupe'), { n: 2 }, { key });
    expect(first).toBeString();
    expect(second).toBeNull();

    const inTx = await db.transaction(async (tx) => enqueueJob(tx, t('tx'), { ok: true }));
    expect(inTx).toBeString();
  });

  it('claims, runs and marks jobs done; leaves unknown types alone', async () => {
    const seen: string[] = [];
    const id = await enqueueJob(db, t('ok'), { value: 'x' });
    const other = await enqueueJob(db, t('nohandler'), {});
    const handlers: JobHandlers = {
      [t('ok')]: async (job) => {
        seen.push(String(job.payload.value));
        expect(job.attempts).toBe(1);
      },
    };
    const runner = createJobRunner(db, handlers, { concurrency: 4 });
    expect(await runner.runOnce()).toBe(1);
    expect(seen).toEqual(['x']);
    const done = await getJob(id!);
    expect(done.doneAt).not.toBeNull();
    expect(done.lockedAt).toBeNull();
    expect((await getJob(other!)).attempts).toBe(0);
  });

  it('retries with backoff and fails after max attempts', async () => {
    const id = await enqueueJob(db, t('fail'), {}, { maxAttempts: 2 });
    const runner = createJobRunner(db, { [t('fail')]: async () => { throw new Error('boom'); } }, { onError: () => {} });

    expect(await runner.runOnce()).toBe(1);
    const afterFirst = await getJob(id!);
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.lastError).toBe('boom');
    expect(afterFirst.failedAt).toBeNull();
    expect(afterFirst.runAt.getTime()).toBeGreaterThan(Date.now() + 3_000);

    // Not due yet → nothing claimed.
    expect(await runner.runOnce()).toBe(0);
    await db.update(jobs).set({ runAt: sql`now()` }).where(eq(jobs.id, id!));
    expect(await runner.runOnce()).toBe(1);
    const afterSecond = await getJob(id!);
    expect(afterSecond.attempts).toBe(2);
    expect(afterSecond.failedAt).not.toBeNull();
  });

  it('JobRetryLater reschedules without spending an attempt', async () => {
    const id = await enqueueJob(db, t('later'), {});
    const runner = createJobRunner(db, { [t('later')]: async () => { throw new JobRetryLater(60_000); } });
    await runner.runOnce();
    const job = await getJob(id!);
    expect(job.attempts).toBe(0);
    expect(job.failedAt).toBeNull();
    expect(job.runAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
  });

  it('reclaims stale locks but not fresh ones', async () => {
    const id = await enqueueJob(db, t('stale'), {});
    await db.update(jobs).set({ lockedAt: new Date(Date.now() - 60_000), lockedBy: 'dead-worker', attempts: 1 }).where(eq(jobs.id, id!));
    let runs = 0;
    const handlers: JobHandlers = { [t('stale')]: async () => { runs++; } };

    const strict = createJobRunner(db, handlers, { lockTimeoutMs: 120_000 });
    expect(await strict.runOnce()).toBe(0);

    const lenient = createJobRunner(db, handlers, { lockTimeoutMs: 30_000 });
    expect(await lenient.runOnce()).toBe(1);
    expect(runs).toBe(1);
    const job = await getJob(id!);
    expect(job.attempts).toBe(2);
    expect(job.doneAt).not.toBeNull();
  });

  it('two runners never run the same job twice (SKIP LOCKED)', async () => {
    const ids = await Promise.all(Array.from({ length: 20 }, (_, i) => enqueueJob(db, t('race'), { i })));
    const counts = new Map<string, number>();
    const handlers: JobHandlers = {
      [t('race')]: async (job) => {
        counts.set(job.id, (counts.get(job.id) ?? 0) + 1);
        await Bun.sleep(5);
      },
    };
    const a = createJobRunner(db, handlers, { concurrency: 5, workerId: 'a' });
    const b = createJobRunner(db, handlers, { concurrency: 5, workerId: 'b' });
    let total = 0;
    for (let i = 0; i < 10 && total < 20; i++) {
      const [x, y] = await Promise.all([a.runOnce(), b.runOnce()]);
      total += x + y;
    }
    expect(total).toBe(20);
    expect(ids.every((id) => counts.get(id!) === 1)).toBe(true);
  });

  it('recurring jobs reschedule themselves, also after a failure', async () => {
    const type = t('recurring');
    const created = await ensureRecurringJob(db, type, { scan: true });
    expect(created).toBeString();
    expect(await ensureRecurringJob(db, type)).toBeNull();

    let calls = 0;
    const handlers: JobHandlers = {
      [type]: recurring(60_000, async () => {
        calls++;
        if (calls === 2) throw new Error('scan failed');
      }),
    };
    const runner = createJobRunner(db, handlers);
    expect(await runner.runOnce()).toBe(1);

    const pending = await db.select().from(jobs).where(eq(jobs.key, recurringJobKey(type)));
    const next = pending.find((j) => j.doneAt === null);
    expect(next).toBeDefined();
    expect(next!.runAt.getTime()).toBeGreaterThan(Date.now() + 50_000);
    expect(next!.payload).toEqual({ scan: true });

    await db.update(jobs).set({ runAt: sql`now()` }).where(eq(jobs.id, next!.id));
    expect(await runner.runOnce()).toBe(1);
    const all = await db.select().from(jobs).where(eq(jobs.key, recurringJobKey(type)));
    expect(all.filter((j) => j.doneAt === null && j.failedAt === null)).toHaveLength(1);
    expect(all.find((j) => j.id === next!.id)?.lastError).toBe('scan failed');
  });

  it('start/stop polls and waits for in-flight jobs', async () => {
    let finished = 0;
    const handlers: JobHandlers = {
      [t('loop')]: async () => {
        await Bun.sleep(100);
        finished++;
      },
    };
    const runner = createJobRunner(db, handlers, { pollMs: 20, concurrency: 2 });
    runner.start();
    await enqueueJob(db, t('loop'), {});
    await enqueueJob(db, t('loop'), {});
    const deadline = Date.now() + 3000;
    while (Date.now() < deadline) {
      const [row] = await db
        .select({ n: sql<number>`count(*)::int` })
        .from(jobs)
        .where(sql`${jobs.type} = ${t('loop')} AND ${jobs.lockedAt} IS NOT NULL`);
      if ((row?.n ?? 0) > 0 || finished > 0) break;
      await Bun.sleep(10);
    }
    await runner.stop();
    await runner.stop(); // idempotent
    const left = await db.select().from(jobs).where(sql`${jobs.type} = ${t('loop')} AND ${jobs.lockedAt} IS NOT NULL`);
    expect(left).toHaveLength(0);
    expect(finished).toBeGreaterThanOrEqual(1);
  });
});
