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
  WorkspaceService,
  type OutgoingWebhookError,
} from '../domain/index.js';
import { getCurrentUser } from '../auth/index.js';
import { CreateOutgoingWebhookSchema, UpdateOutgoingWebhookSchema } from '@flowtask/shared';

const outgoingWebhookRoutes = new Hono();
const db = getDatabase();
const webhookService = new OutgoingWebhookService(db);
const workspaceService = new WorkspaceService(db);

const ListQuerySchema = z.object({ workspaceId: z.string().uuid() });
const DeliveriesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(200).optional(),
});
const IdParamSchema = z.object({ id: z.string().uuid() });

// TODO(authz): consolidate with the central authorize() helper once it lands.
async function isWorkspaceAdmin(workspaceId: string, userId: string): Promise<boolean> {
  const role = await workspaceService.getMemberRole(workspaceId, userId);
  return role.ok && (role.value === 'owner' || role.value === 'admin');
}

function forbidden(c: Context) {
  return c.json(
    {
      success: false,
      error: { code: 'FORBIDDEN', message: 'Only workspace owners and admins can manage webhooks' },
    },
    403
  );
}

function fail(c: Context, error: OutgoingWebhookError) {
  return c.json(
    { success: false, error: { code: error.code, message: error.message } },
    error.status
  );
}

/** Load the webhook and check the caller administers its workspace. */
async function loadOwned(c: Context, id: string) {
  const user = getCurrentUser(c);
  const hook = await webhookService.getById(id);
  if (!hook.ok) return { response: fail(c, hook.error) } as const;
  if (!(await isWorkspaceAdmin(hook.value.workspaceId, user.id)))
    return { response: forbidden(c) } as const;
  return { hook: hook.value } as const;
}

outgoingWebhookRoutes.get('/', zValidator('query', ListQuerySchema), async (c) => {
  const user = getCurrentUser(c);
  const { workspaceId } = c.req.valid('query');
  if (!(await isWorkspaceAdmin(workspaceId, user.id))) return forbidden(c);
  const result = await webhookService.list(workspaceId);
  if (!result.ok) return fail(c, result.error);
  return c.json({ success: true, data: result.value });
});

outgoingWebhookRoutes.post('/', zValidator('json', CreateOutgoingWebhookSchema), async (c) => {
  const user = getCurrentUser(c);
  const body = c.req.valid('json');
  if (!(await isWorkspaceAdmin(body.workspaceId, user.id))) return forbidden(c);
  const result = await webhookService.create({ ...body, createdBy: user.id });
  if (!result.ok) return fail(c, result.error);
  return c.json({ success: true, data: result.value }, 201);
});

outgoingWebhookRoutes.get('/:id', zValidator('param', IdParamSchema), async (c) => {
  const owned = await loadOwned(c, c.req.valid('param').id);
  if ('response' in owned) return owned.response;
  return c.json({ success: true, data: owned.hook });
});

outgoingWebhookRoutes.patch(
  '/:id',
  zValidator('param', IdParamSchema),
  zValidator('json', UpdateOutgoingWebhookSchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const owned = await loadOwned(c, id);
    if ('response' in owned) return owned.response;
    const result = await webhookService.update(id, c.req.valid('json'));
    if (!result.ok) return fail(c, result.error);
    return c.json({ success: true, data: result.value });
  }
);

outgoingWebhookRoutes.delete('/:id', zValidator('param', IdParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const owned = await loadOwned(c, id);
  if ('response' in owned) return owned.response;
  const result = await webhookService.delete(id);
  if (!result.ok) return fail(c, result.error);
  return c.json({ success: true, data: null });
});

outgoingWebhookRoutes.post('/:id/test', zValidator('param', IdParamSchema), async (c) => {
  const { id } = c.req.valid('param');
  const owned = await loadOwned(c, id);
  if ('response' in owned) return owned.response;
  const result = await webhookService.sendTest(id);
  if (!result.ok) return fail(c, result.error);
  return c.json({ success: true, data: result.value }, 202);
});

outgoingWebhookRoutes.get(
  '/:id/deliveries',
  zValidator('param', IdParamSchema),
  zValidator('query', DeliveriesQuerySchema),
  async (c) => {
    const { id } = c.req.valid('param');
    const owned = await loadOwned(c, id);
    if ('response' in owned) return owned.response;
    const result = await webhookService.listDeliveries(id, c.req.valid('query'));
    if (!result.ok) return fail(c, result.error);
    return c.json({
      success: true,
      data: result.value.items,
      meta: { nextCursor: result.value.nextCursor },
    });
  }
);

export { outgoingWebhookRoutes };
