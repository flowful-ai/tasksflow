import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import {
  createDatabase,
  jobs,
  outgoingWebhookDeliveries,
  workspaces,
  type Database,
} from '@flowtask/database';
import type { ClaimedJob, JobContext } from '../jobs/types.js';
import { DomainEventBus } from '../events/bus.js';
import type { TaskWithRelations } from '../task/types.js';
import { createWebhookDeliveryHandler } from './deliver.js';
import { OutgoingWebhookService } from './service.js';
import { verifyWebhookSignature } from './signing.js';
import { registerOutgoingWebhookSubscribers, toWebhookTask } from './subscriber.js';

function fakeTask(): TaskWithRelations {
  const now = new Date('2026-11-09T10:00:00.000Z');
  return {
    id: randomUUID(),
    projectId: randomUUID(),
    stateId: null,
    sequenceNumber: 42,
    title: 'Ship it',
    description: null,
    priority: 'high',
    position: 'a0',
    parentId: null,
    dueDate: now,
    startDate: null,
    createdBy: null,
    agentId: null,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    completedAt: null,
    state: { id: 's1', projectId: 'p', name: 'Todo', category: 'backlog', position: 'a0', color: null },
    assignees: [
      {
        id: 'u1',
        email: 'secret@example.com',
        emailVerified: true,
        name: 'Jo',
        avatarUrl: null,
        appRole: 'user',
        createdAt: now,
        updatedAt: now,
      },
    ],
    labels: [{ id: 'l1', projectId: 'p', name: 'bug', color: '#f00' }],
    project: { id: 'p', identifier: 'TF', name: 'Flow' },
    agent: null,
    externalLinks: [],
  };
}

describe('toWebhookTask', () => {
  it('builds a compact payload without emails', () => {
    const payload = toWebhookTask(fakeTask());
    expect(payload.key).toBe('TF-42');
    expect(payload.assignees).toEqual([{ id: 'u1', name: 'Jo' }]);
    expect(JSON.stringify(payload)).not.toContain('secret@example.com');
    expect(payload.dueDate).toBe('2026-11-09T10:00:00.000Z');
    expect(payload.state).toEqual({ id: 's1', name: 'Todo', category: 'backlog' });
  });
});

const TEST_DB = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DB)('outgoing webhooks (integration)', () => {
  let db: Database;
  let workspaceId: string;
  let server: ReturnType<typeof Bun.serve>;
  const received: { headers: Headers; body: string }[] = [];
  let failNext = 0;
  const service = () => new OutgoingWebhookService(db, { urlPolicy: { allowPrivate: true, production: false } });
  const ctx = (): JobContext => ({ db, workerId: 'test' });
  const job = (deliveryId: string, attempts: number, maxAttempts = 3): ClaimedJob => ({
    id: randomUUID(),
    type: 'webhooks.deliver',
    payload: { deliveryId },
    key: null,
    attempts,
    maxAttempts,
  });

  beforeAll(async () => {
    db = createDatabase(TEST_DB);
    const [ws] = await db
      .insert(workspaces)
      .values({ name: 'webhook test', slug: `wh-test-${randomUUID().slice(0, 8)}` })
      .returning();
    workspaceId = ws!.id;
    server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      async fetch(req) {
        received.push({ headers: req.headers, body: await req.text() });
        if (failNext > 0) {
          failNext--;
          return new Response('nope', { status: 500 });
        }
        return new Response('ok');
      },
    });
  });

  afterAll(async () => {
    server?.stop(true);
    const hooks = await service().list(workspaceId);
    if (hooks.ok && hooks.value.length) {
      const deliveries = await db
        .select({ id: outgoingWebhookDeliveries.id })
        .from(outgoingWebhookDeliveries)
        .where(inArray(outgoingWebhookDeliveries.webhookId, hooks.value.map((h) => h.id)));
      const ids = deliveries.map((d) => d.id);
      if (ids.length) await db.delete(jobs).where(inArray(sql`${jobs.payload}->>'deliveryId'`, ids));
    }
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
  });

  it('rejects private targets unless allowed', async () => {
    const strict = new OutgoingWebhookService(db, { urlPolicy: { allowPrivate: false } });
    const result = await strict.create({ workspaceId, url: 'http://127.0.0.1:1/x', events: ['*'], createdBy: null });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('PRIVATE_ADDRESS');
  });

  it('creates (secret once), masks on read, updates and rotates', async () => {
    const created = await service().create({
      workspaceId,
      url: `http://127.0.0.1:${server.port}/hook`,
      events: ['task.created', 'task.created'],
      createdBy: null,
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.secret).toStartWith('whsec_');
    expect(created.value.events).toEqual(['task.created']);

    const listed = await service().list(workspaceId);
    expect(listed.ok && listed.value[0]).toMatchObject({ secretPreview: `whsec_…${created.value.secret.slice(-4)}` });
    expect(JSON.stringify(listed)).not.toContain(created.value.secret);

    const rotated = await service().update(created.value.id, { rotateSecret: true, events: ['*'] });
    expect(rotated.ok).toBe(true);
    if (rotated.ok) {
      expect(rotated.value.secret).toBeString();
      expect(rotated.value.secret).not.toBe(created.value.secret);
      expect(rotated.value.events).toEqual(['*']);
    }
    expect((await service().getById(randomUUID())).ok).toBe(false);
  });

  it('dispatches events from the bus, delivers signed requests and retries on 500', async () => {
    const created = await service().create({
      workspaceId,
      url: `http://127.0.0.1:${server.port}/signed`,
      events: ['task.created'],
      createdBy: null,
    });
    if (!created.ok) throw created.error;
    const secret = created.value.secret;

    const bus = new DomainEventBus();
    const unsubscribe = registerOutgoingWebhookSubscribers(db, bus, service());
    const task = fakeTask();
    bus.emit('task.created', { task, workspaceId, projectId: task.projectId, actorId: null });
    await bus.idle();
    unsubscribe();

    const deliveries = await db
      .select()
      .from(outgoingWebhookDeliveries)
      .where(eq(outgoingWebhookDeliveries.webhookId, created.value.id));
    expect(deliveries).toHaveLength(1);
    const delivery = deliveries[0]!;
    const [queued] = await db.select().from(jobs).where(sql`${jobs.payload}->>'deliveryId' = ${delivery.id}`);
    expect(queued?.type).toBe('webhooks.deliver');

    const handler = createWebhookDeliveryHandler({ urlPolicy: { allowPrivate: true } });
    failNext = 1;
    const before = received.length;
    await expect(handler(job(delivery.id, 1), ctx())).rejects.toThrow('HTTP 500');
    let [row] = await db.select().from(outgoingWebhookDeliveries).where(eq(outgoingWebhookDeliveries.id, delivery.id));
    expect(row).toMatchObject({ status: 'pending', responseCode: 500, attempt: 1, error: 'HTTP 500' });

    await handler(job(delivery.id, 2), ctx());
    [row] = await db.select().from(outgoingWebhookDeliveries).where(eq(outgoingWebhookDeliveries.id, delivery.id));
    expect(row).toMatchObject({ status: 'success', responseCode: 200, attempt: 2, error: null });
    expect(row?.deliveredAt).not.toBeNull();

    expect(received.length).toBe(before + 2);
    const last = received[received.length - 1]!;
    const ts = Number(last.headers.get('x-flowtask-timestamp'));
    const sig = last.headers.get('x-flowtask-signature') ?? '';
    expect(verifyWebhookSignature(secret, ts, last.body, sig)).toBe(true);
    expect(last.headers.get('x-flowtask-event')).toBe('task.created');
    expect(last.headers.get('x-flowtask-delivery')).toBe(delivery.id);
    const body = JSON.parse(last.body);
    expect(body).toMatchObject({ id: delivery.id, event: 'task.created', workspaceId });
    expect(body.data.task.key).toBe('TF-42');

    // A later attempt on a delivered row is a no-op.
    await handler(job(delivery.id, 3), ctx());
    expect(received.length).toBe(before + 2);
  });

  it('marks the last failed attempt failed, and disabled hooks fail without sending', async () => {
    const created = await service().create({
      workspaceId,
      url: `http://127.0.0.1:${server.port}/last`,
      events: ['task.moved'],
      createdBy: null,
    });
    if (!created.ok) throw created.error;
    const test = await service().sendTest(created.value.id);
    if (!test.ok) throw test.error;
    const handler = createWebhookDeliveryHandler({ urlPolicy: { allowPrivate: true } });
    failNext = 1;
    await expect(handler(job(test.value.deliveryId, 1, 1), ctx())).rejects.toThrow();
    const [row] = await db
      .select()
      .from(outgoingWebhookDeliveries)
      .where(eq(outgoingWebhookDeliveries.id, test.value.deliveryId));
    expect(row?.status).toBe('failed');

    await service().update(created.value.id, { enabled: false });
    const dispatched = await service().dispatchEvent(workspaceId, 'task.moved', { x: 1 });
    expect(dispatched.ok).toBe(true);
    // Only the ping exists for the disabled hook (the '*' hook from earlier got the event).
    const page = await service().listDeliveries(created.value.id, { limit: 10 });
    expect(page.ok && page.value.items.map((d) => d.event)).toEqual(['ping']);
    const first = await service().listDeliveries(created.value.id, { limit: 1 });
    expect(first.ok && first.value.nextCursor).toBeNull();
  });

  it('refuses private targets at delivery time', async () => {
    const created = await service().create({
      workspaceId,
      url: `http://127.0.0.1:${server.port}/ssrf`,
      events: ['*'],
      createdBy: null,
    });
    if (!created.ok) throw created.error;
    const test = await service().sendTest(created.value.id);
    if (!test.ok) throw test.error;
    const before = received.length;
    const strictHandler = createWebhookDeliveryHandler({ urlPolicy: { allowPrivate: false } });
    await strictHandler(job(test.value.deliveryId, 1), ctx());
    const [row] = await db
      .select()
      .from(outgoingWebhookDeliveries)
      .where(eq(outgoingWebhookDeliveries.id, test.value.deliveryId));
    expect(row?.status).toBe('failed');
    expect(row?.error).toStartWith('PRIVATE_ADDRESS');
    expect(received.length).toBe(before);
  });
});
