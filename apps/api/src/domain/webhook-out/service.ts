import { and, desc, eq, lt, or, sql } from 'drizzle-orm';
import {
  outgoingWebhookDeliveries,
  outgoingWebhooks,
  type Database,
  type OutgoingWebhook,
  type OutgoingWebhookDelivery,
} from '../../db/index.js';
import {
  OUTGOING_WEBHOOK_EVENTS,
  err,
  ok,
  type JsonObject,
  type OutgoingWebhookDeliveryStatus,
  type OutgoingWebhookEvent,
  type Result,
  toJsonObject,
} from '@flowtask/shared';
import { enqueueJob } from '../jobs/queue.js';
import { JOB_TYPES } from '../jobs/types.js';
import { generateWebhookSecret, maskWebhookSecret } from './signing.js';
import { assertSafeWebhookUrl, WebhookUrlError, type SafeUrlOptions } from './ssrf.js';

export type OutgoingWebhookErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_URL'
  | 'HTTPS_REQUIRED'
  | 'PRIVATE_ADDRESS'
  | 'DNS_FAILED'
  | 'INVALID_EVENTS'
  | 'INVALID_CURSOR'
  | 'INTERNAL';

export class OutgoingWebhookError extends Error {
  readonly code: OutgoingWebhookErrorCode;

  constructor(code: OutgoingWebhookErrorCode, message: string) {
    super(message);
    this.name = 'OutgoingWebhookError';
    this.code = code;
  }

  /** Suggested HTTP status for routes. */
  get status(): 400 | 404 | 500 {
    if (this.code === 'NOT_FOUND') return 404;
    if (this.code === 'INTERNAL') return 500;
    return 400;
  }
}

/** Event selector stored on a webhook: a specific event, or '*' for all. */
export type OutgoingWebhookEventSelector = OutgoingWebhookEvent | '*';

/** Event name of a delivery: a domain event, or 'ping' for test deliveries. */
export type OutgoingDeliveryEvent = OutgoingWebhookEvent | 'ping';

export interface OutgoingWebhookView {
  id: string;
  workspaceId: string;
  url: string;
  description: string | null;
  events: OutgoingWebhookEventSelector[];
  enabled: boolean;
  /** Masked secret, e.g. "whsec_…AbCd". */
  secretPreview: string;
  createdBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Returned by create and by update with rotateSecret: the only time the full secret is shown. */
export interface OutgoingWebhookWithSecret extends OutgoingWebhookView {
  secret: string;
}

export interface OutgoingWebhookDeliveryView {
  id: string;
  webhookId: string;
  event: string;
  status: OutgoingWebhookDeliveryStatus;
  responseCode: number | null;
  attempt: number;
  error: string | null;
  durationMs: number | null;
  deliveredAt: Date | null;
  createdAt: Date;
  payload: JsonObject;
}

export interface CreateOutgoingWebhookInput {
  workspaceId: string;
  url: string;
  description?: string;
  events: OutgoingWebhookEventSelector[];
  enabled?: boolean;
  createdBy: string | null;
}

export interface UpdateOutgoingWebhookInput {
  url?: string;
  description?: string | null;
  events?: OutgoingWebhookEventSelector[];
  enabled?: boolean;
  rotateSecret?: boolean;
}

export interface OutgoingWebhookServiceOptions {
  /** URL policy for create/update validation (tests pass allowPrivate/lookup). */
  urlPolicy?: SafeUrlOptions;
}

const EVENT_SET: ReadonlySet<string> = new Set<string>([...OUTGOING_WEBHOOK_EVENTS, '*']);

function isEventSelector(value: string): value is OutgoingWebhookEventSelector {
  return EVENT_SET.has(value);
}

function isDeliveryStatus(value: string): value is OutgoingWebhookDeliveryStatus {
  return value === 'pending' || value === 'success' || value === 'failed';
}

function normalizeEvents(events: readonly string[]): OutgoingWebhookEventSelector[] | null {
  const unique = [...new Set(events)];
  if (unique.length === 0 || !unique.every(isEventSelector)) return null;
  const valid = unique.filter(isEventSelector);
  return valid.includes('*') ? ['*'] : valid;
}

function toView(row: OutgoingWebhook): OutgoingWebhookView {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    url: row.url,
    description: row.description,
    events: row.events.filter(isEventSelector),
    enabled: row.enabled,
    secretPreview: maskWebhookSecret(row.secret),
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toDeliveryView(row: OutgoingWebhookDelivery): OutgoingWebhookDeliveryView {
  return {
    id: row.id,
    webhookId: row.webhookId,
    event: row.event,
    status: isDeliveryStatus(row.status) ? row.status : 'pending',
    responseCode: row.responseCode,
    attempt: row.attempt,
    error: row.error,
    durationMs: row.durationMs,
    deliveredAt: row.deliveredAt,
    createdAt: row.createdAt,
    payload: toJsonObject(row.payload),
  };
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  const [iso, id] = Buffer.from(cursor, 'base64url').toString('utf8').split('|');
  if (!iso || !id || !/^[0-9a-f-]{36}$/i.test(id)) return null;
  const createdAt = new Date(iso);
  return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id };
}

function toError(error: unknown): OutgoingWebhookError {
  if (error instanceof OutgoingWebhookError) return error;
  if (error instanceof WebhookUrlError) return new OutgoingWebhookError(error.code, error.message);
  console.error('[outgoing-webhooks]', error);
  return new OutgoingWebhookError('INTERNAL', 'Outgoing webhook operation failed');
}

export class OutgoingWebhookService {
  private readonly urlPolicy: SafeUrlOptions;

  constructor(
    private readonly db: Database,
    opts: OutgoingWebhookServiceOptions = {}
  ) {
    this.urlPolicy = opts.urlPolicy ?? {};
  }

  async list(workspaceId: string): Promise<Result<OutgoingWebhookView[], OutgoingWebhookError>> {
    try {
      const rows = await this.db
        .select()
        .from(outgoingWebhooks)
        .where(eq(outgoingWebhooks.workspaceId, workspaceId))
        .orderBy(desc(outgoingWebhooks.createdAt), desc(outgoingWebhooks.id));
      return ok(rows.map(toView));
    } catch (error) {
      return err(toError(error));
    }
  }

  async getById(id: string): Promise<Result<OutgoingWebhookView, OutgoingWebhookError>> {
    try {
      const [row] = await this.db.select().from(outgoingWebhooks).where(eq(outgoingWebhooks.id, id));
      if (!row) return err(new OutgoingWebhookError('NOT_FOUND', 'Webhook not found'));
      return ok(toView(row));
    } catch (error) {
      return err(toError(error));
    }
  }

  async create(input: CreateOutgoingWebhookInput): Promise<Result<OutgoingWebhookWithSecret, OutgoingWebhookError>> {
    try {
      const events = normalizeEvents(input.events);
      if (!events) return err(new OutgoingWebhookError('INVALID_EVENTS', 'Unknown or empty event list'));
      await assertSafeWebhookUrl(input.url, this.urlPolicy);

      const secret = generateWebhookSecret();
      const [row] = await this.db
        .insert(outgoingWebhooks)
        .values({
          workspaceId: input.workspaceId,
          url: input.url,
          description: input.description ?? null,
          events,
          enabled: input.enabled ?? true,
          secret,
          createdBy: input.createdBy,
        })
        .returning();
      if (!row) return err(new OutgoingWebhookError('INTERNAL', 'Failed to create webhook'));
      return ok({ ...toView(row), secret });
    } catch (error) {
      return err(toError(error));
    }
  }

  /** Update a webhook. `secret` is set in the result only when rotateSecret was requested. */
  async update(
    id: string,
    input: UpdateOutgoingWebhookInput
  ): Promise<Result<OutgoingWebhookView & { secret?: string }, OutgoingWebhookError>> {
    try {
      const patch: Partial<typeof outgoingWebhooks.$inferInsert> = { updatedAt: new Date() };
      if (input.url !== undefined) {
        await assertSafeWebhookUrl(input.url, this.urlPolicy);
        patch.url = input.url;
      }
      if (input.description !== undefined) patch.description = input.description;
      if (input.enabled !== undefined) patch.enabled = input.enabled;
      if (input.events !== undefined) {
        const events = normalizeEvents(input.events);
        if (!events) return err(new OutgoingWebhookError('INVALID_EVENTS', 'Unknown or empty event list'));
        patch.events = events;
      }
      const secret = input.rotateSecret ? generateWebhookSecret() : undefined;
      if (secret) patch.secret = secret;

      const [row] = await this.db.update(outgoingWebhooks).set(patch).where(eq(outgoingWebhooks.id, id)).returning();
      if (!row) return err(new OutgoingWebhookError('NOT_FOUND', 'Webhook not found'));
      return ok(secret ? { ...toView(row), secret } : toView(row));
    } catch (error) {
      return err(toError(error));
    }
  }

  async delete(id: string): Promise<Result<void, OutgoingWebhookError>> {
    try {
      const rows = await this.db
        .delete(outgoingWebhooks)
        .where(eq(outgoingWebhooks.id, id))
        .returning({ id: outgoingWebhooks.id });
      if (rows.length === 0) return err(new OutgoingWebhookError('NOT_FOUND', 'Webhook not found'));
      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }

  /** Deliveries for a webhook, newest first, keyset-paginated. */
  async listDeliveries(
    webhookId: string,
    opts: { limit?: number; cursor?: string } = {}
  ): Promise<Result<{ items: OutgoingWebhookDeliveryView[]; nextCursor: string | null }, OutgoingWebhookError>> {
    try {
      const limit = Math.max(1, Math.min(100, opts.limit ?? 20));
      const conditions = [eq(outgoingWebhookDeliveries.webhookId, webhookId)];
      if (opts.cursor) {
        const cursor = decodeCursor(opts.cursor);
        if (!cursor) return err(new OutgoingWebhookError('INVALID_CURSOR', 'Invalid cursor'));
        const older = or(
          lt(outgoingWebhookDeliveries.createdAt, cursor.createdAt),
          and(eq(outgoingWebhookDeliveries.createdAt, cursor.createdAt), lt(outgoingWebhookDeliveries.id, cursor.id))
        );
        if (older) conditions.push(older);
      }
      const rows = await this.db
        .select()
        .from(outgoingWebhookDeliveries)
        .where(and(...conditions))
        .orderBy(desc(outgoingWebhookDeliveries.createdAt), desc(outgoingWebhookDeliveries.id))
        .limit(limit + 1);
      const page = rows.slice(0, limit);
      const last = page[page.length - 1];
      return ok({
        items: page.map(toDeliveryView),
        nextCursor: rows.length > limit && last ? encodeCursor(last) : null,
      });
    } catch (error) {
      return err(toError(error));
    }
  }

  /** Queue a 'ping' delivery (sent even when the webhook is disabled). */
  async sendTest(webhookId: string): Promise<Result<{ deliveryId: string }, OutgoingWebhookError>> {
    try {
      const deliveryId = await this.db.transaction(async (tx) => {
        const [hook] = await tx
          .select({ id: outgoingWebhooks.id, workspaceId: outgoingWebhooks.workspaceId })
          .from(outgoingWebhooks)
          .where(eq(outgoingWebhooks.id, webhookId));
        if (!hook) return null;
        const [delivery] = await tx
          .insert(outgoingWebhookDeliveries)
          .values({
            webhookId,
            event: 'ping',
            payload: { message: 'FlowTask webhook test', webhookId },
          })
          .returning({ id: outgoingWebhookDeliveries.id });
        if (!delivery) throw new OutgoingWebhookError('INTERNAL', 'Failed to create delivery');
        await enqueueJob(tx, JOB_TYPES.webhookDeliver, { deliveryId: delivery.id }, { maxAttempts: 1 });
        return delivery.id;
      });
      if (!deliveryId) return err(new OutgoingWebhookError('NOT_FOUND', 'Webhook not found'));
      return ok({ deliveryId });
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Fan an event out to every enabled webhook of the workspace subscribed to
   * it: one delivery row + one `webhooks.deliver` job each, in one transaction.
   * Returns the number of deliveries queued.
   */
  async dispatchEvent(
    workspaceId: string,
    event: OutgoingWebhookEvent,
    data: JsonObject
  ): Promise<Result<number, OutgoingWebhookError>> {
    try {
      const count = await this.db.transaction(async (tx) => {
        const hooks = await tx
          .select({ id: outgoingWebhooks.id })
          .from(outgoingWebhooks)
          .where(
            and(
              eq(outgoingWebhooks.workspaceId, workspaceId),
              eq(outgoingWebhooks.enabled, true),
              sql`(${event} = ANY(${outgoingWebhooks.events}) OR '*' = ANY(${outgoingWebhooks.events}))`
            )
          );
        if (hooks.length === 0) return 0;
        const deliveries = await tx
          .insert(outgoingWebhookDeliveries)
          .values(hooks.map((hook) => ({ webhookId: hook.id, event, payload: data })))
          .returning({ id: outgoingWebhookDeliveries.id });
        for (const delivery of deliveries) {
          await enqueueJob(tx, JOB_TYPES.webhookDeliver, { deliveryId: delivery.id }, { maxAttempts: 6 });
        }
        return deliveries.length;
      });
      return ok(count);
    } catch (error) {
      return err(toError(error));
    }
  }
}
