import { truncate } from '@flowtask/shared';
import { eq, lt } from 'drizzle-orm';
import { outgoingWebhookDeliveries, outgoingWebhooks } from '../../db/index.js';
import { toJsonValue, type JsonValue } from '@flowtask/shared';
import type { JobHandler } from '../jobs/types.js';
import { recurring } from '../jobs/recurring.js';
import {
  DELIVERY_HEADER,
  EVENT_HEADER,
  SIGNATURE_HEADER,
  TIMESTAMP_HEADER,
  signWebhookPayload,
} from './signing.js';
import { assertSafeWebhookUrl, WebhookUrlError, type SafeUrlOptions } from './ssrf.js';

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface DeliverHandlerOptions {
  fetch?: FetchLike;
  urlPolicy?: SafeUrlOptions;
  /** Per-attempt timeout (default 10 s). */
  timeoutMs?: number;
}

export const DELIVERY_RETENTION_DAYS = 30;
const MAX_ERROR_LENGTH = 1000;
const USER_AGENT = 'FlowTask-Webhooks/1.0';

function readDeliveryId(payload: { [key: string]: JsonValue }): string | null {
  const value = payload.deliveryId;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * The `webhooks.deliver` job handler. Payload: `{ deliveryId }`.
 *
 * Body: `{ id, event, createdAt, workspaceId, data }`, signed with the
 * webhook secret (see signing.ts). Redirects are not followed (3xx = failure).
 * A non-2xx response or network error throws so the runner retries with
 * backoff; the delivery row records every attempt.
 */
export function createWebhookDeliveryHandler(opts: DeliverHandlerOptions = {}): JobHandler {
  const doFetch: FetchLike = opts.fetch ?? ((input, init) => fetch(input, init));
  const timeoutMs = opts.timeoutMs ?? 10_000;

  return async (job, { db }) => {
    const deliveryId = readDeliveryId(job.payload);
    if (!deliveryId) return { error: 'Missing deliveryId' };

    const [row] = await db
      .select({ delivery: outgoingWebhookDeliveries, webhook: outgoingWebhooks })
      .from(outgoingWebhookDeliveries)
      .innerJoin(outgoingWebhooks, eq(outgoingWebhookDeliveries.webhookId, outgoingWebhooks.id))
      .where(eq(outgoingWebhookDeliveries.id, deliveryId));
    // Webhook deleted (cascade) or delivery purged: nothing to send.
    if (!row) return;
    const { delivery, webhook } = row;
    if (delivery.status === 'success') return;

    const record = (values: Partial<typeof outgoingWebhookDeliveries.$inferInsert>) =>
      db
        .update(outgoingWebhookDeliveries)
        .set(values)
        .where(eq(outgoingWebhookDeliveries.id, deliveryId));

    if (!webhook.enabled && delivery.event !== 'ping') {
      await record({ status: 'failed', attempt: job.attempts, error: 'Webhook disabled' });
      return;
    }

    try {
      await assertSafeWebhookUrl(webhook.url, opts.urlPolicy);
    } catch (error) {
      // Policy violations are permanent: don't retry.
      const message =
        error instanceof WebhookUrlError ? `${error.code}: ${error.message}` : 'URL check failed';
      await record({
        status: 'failed',
        attempt: job.attempts,
        error: truncate(message, MAX_ERROR_LENGTH),
      });
      return;
    }

    const data = toJsonValue(delivery.payload);
    const body = JSON.stringify({
      id: delivery.id,
      event: delivery.event,
      createdAt: delivery.createdAt.toISOString(),
      workspaceId: webhook.workspaceId,
      data: data ?? {},
    });
    const timestamp = Math.floor(Date.now() / 1000);
    const isLastAttempt = job.attempts >= job.maxAttempts;
    const started = Date.now();

    let response: Response;
    try {
      response = await doFetch(webhook.url, {
        method: 'POST',
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': USER_AGENT,
          [EVENT_HEADER]: delivery.event,
          [DELIVERY_HEADER]: delivery.id,
          [TIMESTAMP_HEADER]: String(timestamp),
          [SIGNATURE_HEADER]: signWebhookPayload(webhook.secret, timestamp, body),
        },
        body,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await record({
        status: isLastAttempt ? 'failed' : 'pending',
        attempt: job.attempts,
        responseCode: null,
        durationMs: Date.now() - started,
        error: truncate(`Request failed: ${message}`, MAX_ERROR_LENGTH),
      });
      throw new Error(`Webhook delivery ${delivery.id} failed: ${message}`);
    }

    const durationMs = Date.now() - started;
    // Drain/cancel the body; the receiver's response content is not stored.
    await response.body?.cancel().catch(() => undefined);

    if (response.status >= 200 && response.status < 300) {
      await record({
        status: 'success',
        attempt: job.attempts,
        responseCode: response.status,
        durationMs,
        error: null,
        deliveredAt: new Date(),
      });
      return;
    }

    await record({
      status: isLastAttempt ? 'failed' : 'pending',
      attempt: job.attempts,
      responseCode: response.status,
      durationMs,
      error: `HTTP ${response.status}`,
    });
    throw new Error(`Webhook delivery ${delivery.id} got HTTP ${response.status}`);
  };
}

/** Delete deliveries older than 30 days. */
export const webhookDeliveryCleanupHandler: JobHandler = async (_job, { db }) => {
  const cutoff = new Date(Date.now() - DELIVERY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await db.delete(outgoingWebhookDeliveries).where(lt(outgoingWebhookDeliveries.createdAt, cutoff));
};

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Handlers for the job types owned by outgoing webhooks. The cleanup handler
 * is recurring (daily); start its chain with
 * `ensureRecurringJob(db, JOB_TYPES.webhookDeliveryCleanup)`.
 */
export function createOutgoingWebhookJobHandlers(
  opts: DeliverHandlerOptions = {}
): Record<string, JobHandler> {
  return {
    'webhooks.deliver': createWebhookDeliveryHandler(opts),
    'webhooks.delivery_cleanup': recurring(DAY_MS, webhookDeliveryCleanupHandler),
  };
}
