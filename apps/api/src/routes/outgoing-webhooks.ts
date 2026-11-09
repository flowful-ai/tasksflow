/**
 * Outgoing webhooks (workspace owner/admin only). Mounted at /api/outgoing-webhooks.
 *
 *   GET    /?workspaceId=            list (secret masked)
 *   POST   /                         create → 201, includes `secret` once
 *   GET    /:id                      read
 *   PATCH  /:id                      update ({ rotateSecret: true } returns a new `secret`)
 *   DELETE /:id                      delete
 *   POST   /:id/test                 queue a 'ping' delivery → 202 { deliveryId }
 *   GET    /:id/deliveries?limit=&cursor=   delivery log, newest first
 */
import { Hono, type Context } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import {
  OutgoingWebhookService,
  type OutgoingWebhookError,
  type OutgoingWebhookView,
} from '../domain/index.js';
import { CreateOutgoingWebhookSchema, UpdateOutgoingWebhookSchema } from '@flowtask/shared';
import type { Result } from '@flowtask/shared';
import { requireWorkspace } from '../lib/authorize.js';
import { AppError, validationHook, handleRouteError } from '../lib/responses.js';

const outgoingWebhookRoutes = new Hono();
outgoingWebhookRoutes.onError(handleRouteError);
const db = getDatabase();
const webhookService = new OutgoingWebhookService(db);

const ListQuerySchema = z.object({ workspaceId: z.string().uuid() });
const DeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
const IdParamSchema = z.object({ id: z.string().uuid() });

/** Managing webhooks is a workspace setting (owner/admin). */
const MANAGE = 'workspace:manage_settings';

function unwrap<T>(result: Result<T, OutgoingWebhookError>): T {
  if (result.ok) return result.value;
  throw new AppError(result.error.status, result.error.code, result.error.message);
}

/** Load the webhook and check the caller administers its workspace. */
async function requireHook(c: Context, id: string): Promise<OutgoingWebhookView> {
  const hook = unwrap(await webhookService.getById(id));
  await requireWorkspace(c, hook.workspaceId, MANAGE);
  return hook;
}

outgoingWebhookRoutes.get('/', zValidator('query', ListQuerySchema, validationHook), async (c) => {
  const { workspaceId } = await requireWorkspace(c, c.req.valid('query').workspaceId, MANAGE);
  return c.json({ success: true, data: unwrap(await webhookService.list(workspaceId)) });
});

outgoingWebhookRoutes.post(
  '/',
  zValidator('json', CreateOutgoingWebhookSchema, validationHook),
  async (c) => {
    const body = c.req.valid('json');
    const { user } = await requireWorkspace(c, body.workspaceId, MANAGE);
    const created = unwrap(await webhookService.create({ ...body, createdBy: user.id }));
    return c.json({ success: true, data: created }, 201);
  }
);

outgoingWebhookRoutes.get('/:id', zValidator('param', IdParamSchema, validationHook), async (c) => {
  return c.json({ success: true, data: await requireHook(c, c.req.valid('param').id) });
});

outgoingWebhookRoutes.patch(
  '/:id',
  zValidator('param', IdParamSchema, validationHook),
  zValidator('json', UpdateOutgoingWebhookSchema, validationHook),
  async (c) => {
    const { id } = c.req.valid('param');
    await requireHook(c, id);
    const updated = unwrap(await webhookService.update(id, c.req.valid('json')));
    return c.json({ success: true, data: updated });
  }
);

outgoingWebhookRoutes.delete(
  '/:id',
  zValidator('param', IdParamSchema, validationHook),
  async (c) => {
    const { id } = c.req.valid('param');
    await requireHook(c, id);
    unwrap(await webhookService.delete(id));
    return c.json({ success: true, data: null });
  }
);

outgoingWebhookRoutes.post(
  '/:id/test',
  zValidator('param', IdParamSchema, validationHook),
  async (c) => {
    const { id } = c.req.valid('param');
    await requireHook(c, id);
    return c.json({ success: true, data: unwrap(await webhookService.sendTest(id)) }, 202);
  }
);

outgoingWebhookRoutes.get(
  '/:id/deliveries',
  zValidator('param', IdParamSchema, validationHook),
  zValidator('query', DeliveriesQuerySchema, validationHook),
  async (c) => {
    const { id } = c.req.valid('param');
    await requireHook(c, id);
    const page = unwrap(await webhookService.listDeliveries(id, c.req.valid('query')));
    return c.json({ success: true, data: page.items, meta: { nextCursor: page.nextCursor } });
  }
);

export { outgoingWebhookRoutes };
