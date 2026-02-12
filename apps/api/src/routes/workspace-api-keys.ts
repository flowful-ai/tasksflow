import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '@flowtask/database';
import { AgentService, WorkspaceService } from '@flowtask/domain';
import { getCurrentUser } from '@flowtask/auth';
import { ApiKeyProviderSchema } from '@flowtask/shared';

const workspaceApiKeysRoutes = new Hono();
const db = getDatabase();
const agentService = new AgentService(db);
const workspaceService = new WorkspaceService(db);

const ProviderSchema = ApiKeyProviderSchema;
const PROVIDERS = ApiKeyProviderSchema.options;

async function requireWorkspaceAdminOrOwner(workspaceId: string, userId: string): Promise<void> {
  const roleResult = await workspaceService.getMemberRole(workspaceId, userId);
  const role = roleResult.ok ? roleResult.value : null;
  if (!role || (role !== 'owner' && role !== 'admin')) {
    throw new Error('FORBIDDEN');
  }
}

workspaceApiKeysRoutes.post(
  '/:workspaceId/api-keys',
  zValidator(
    'json',
    z.object({
      provider: ProviderSchema,
      apiKey: z.string().min(1),
    })
  ),
  async (c) => {
    const user = getCurrentUser(c);
    const workspaceId = c.req.param('workspaceId');
    const { provider, apiKey } = c.req.valid('json');

    try {
      await requireWorkspaceAdminOrOwner(workspaceId, user.id);
    } catch {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await agentService.storeApiKey({
      workspaceId,
      provider,
      apiKey,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'STORE_FAILED', message: result.error.message } }, 400);
    }

    return c.json(
      {
        success: true,
        data: {
          id: result.value.id,
          workspaceId: result.value.workspaceId,
          provider: result.value.provider,
          createdAt: result.value.createdAt,
        },
      },
      201
    );
  }
);

workspaceApiKeysRoutes.get('/:workspaceId/api-keys', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');

  try {
    await requireWorkspaceAdminOrOwner(workspaceId, user.id);
  } catch {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const configuredProviders = await agentService.listApiKeyProviders(workspaceId);

  return c.json({
    success: true,
    data: {
      providers: PROVIDERS.map((provider) => ({
        provider,
        hasKey: configuredProviders.has(provider),
      })),
    },
  });
});

workspaceApiKeysRoutes.get('/:workspaceId/api-keys/:provider', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');
  const providerParse = ProviderSchema.safeParse(c.req.param('provider'));
  if (!providerParse.success) {
    return c.json({ success: false, error: { code: 'INVALID_PROVIDER', message: 'Invalid API key provider' } }, 400);
  }

  try {
    await requireWorkspaceAdminOrOwner(workspaceId, user.id);
  } catch {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const hasKey = await agentService.hasApiKey(workspaceId, providerParse.data);

  return c.json({
    success: true,
    data: {
      hasKey,
      provider: providerParse.data,
    },
  });
});

workspaceApiKeysRoutes.delete('/:workspaceId/api-keys/:provider', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');
  const providerParse = ProviderSchema.safeParse(c.req.param('provider'));
  if (!providerParse.success) {
    return c.json({ success: false, error: { code: 'INVALID_PROVIDER', message: 'Invalid API key provider' } }, 400);
  }

  try {
    await requireWorkspaceAdminOrOwner(workspaceId, user.id);
  } catch {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await agentService.deleteApiKey(workspaceId, providerParse.data);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

export { workspaceApiKeysRoutes };
