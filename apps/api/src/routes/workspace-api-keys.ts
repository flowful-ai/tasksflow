import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import { AgentService, WorkspaceService } from '../domain/index.js';
import { ApiKeyProviderSchema, UpdateWorkspaceAiSettingsSchema } from '@flowtask/shared';
import type { ApiKeyProvider } from '@flowtask/shared';
import { requireWorkspace } from '../lib/authorize.js';
import { badRequest, fromResult, validationHook, handleRouteError } from '../lib/responses.js';

const workspaceApiKeysRoutes = new Hono();
workspaceApiKeysRoutes.onError(handleRouteError);
const db = getDatabase();
const agentService = new AgentService(db);
const workspaceService = new WorkspaceService(db);

const PROVIDERS = ApiKeyProviderSchema.options;

function providerParam(value: string | undefined): ApiKeyProvider {
  const parsed = ApiKeyProviderSchema.safeParse(value);
  if (!parsed.success) throw badRequest('Invalid API key provider', 'INVALID_PROVIDER');
  return parsed.data;
}

workspaceApiKeysRoutes.post(
  '/:workspaceId/api-keys',
  zValidator(
    'json',
    z.object({
      provider: ApiKeyProviderSchema,
      apiKey: z.string().min(1),
    }),
    validationHook
  ),
  async (c) => {
    const { workspaceId } = await requireWorkspace(
      c,
      c.req.param('workspaceId'),
      'workspace:manage_settings'
    );
    const { provider, apiKey } = c.req.valid('json');

    const stored = fromResult(await agentService.storeApiKey({ workspaceId, provider, apiKey }), {
      status: 400,
      code: 'STORE_FAILED',
      message: 'Failed to store API key',
    });

    return c.json(
      {
        success: true,
        data: {
          id: stored.id,
          workspaceId: stored.workspaceId,
          provider: stored.provider,
          createdAt: stored.createdAt,
        },
      },
      201
    );
  }
);

workspaceApiKeysRoutes.get('/:workspaceId/api-keys', async (c) => {
  const { workspaceId } = await requireWorkspace(
    c,
    c.req.param('workspaceId'),
    'workspace:manage_settings'
  );
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
  const provider = providerParam(c.req.param('provider'));
  const { workspaceId } = await requireWorkspace(
    c,
    c.req.param('workspaceId'),
    'workspace:manage_settings'
  );
  const hasKey = await agentService.hasApiKey(workspaceId, provider);
  return c.json({ success: true, data: { hasKey, provider } });
});

workspaceApiKeysRoutes.delete('/:workspaceId/api-keys/:provider', async (c) => {
  const provider = providerParam(c.req.param('provider'));
  const { workspaceId } = await requireWorkspace(
    c,
    c.req.param('workspaceId'),
    'workspace:manage_settings'
  );
  fromResult(await agentService.deleteApiKey(workspaceId, provider), {
    status: 400,
    code: 'DELETE_FAILED',
    message: 'Failed to delete API key',
  });
  return c.json({ success: true, data: null });
});

workspaceApiKeysRoutes.get('/:workspaceId/ai-settings', async (c) => {
  const { workspaceId } = await requireWorkspace(c, c.req.param('workspaceId'), 'agent:execute');
  const settings = fromResult(await workspaceService.getAgentAiSettings(workspaceId), {
    status: 400,
    code: 'READ_FAILED',
    message: 'Failed to read AI settings',
  });
  return c.json({ success: true, data: settings });
});

workspaceApiKeysRoutes.patch(
  '/:workspaceId/ai-settings',
  zValidator('json', UpdateWorkspaceAiSettingsSchema, validationHook),
  async (c) => {
    const { workspaceId } = await requireWorkspace(
      c,
      c.req.param('workspaceId'),
      'workspace:manage_settings'
    );
    const data = c.req.valid('json');

    if (data.defaultAgentId) {
      const agentResult = await agentService.getById(data.defaultAgentId);
      if (
        !agentResult.ok ||
        agentResult.value.workspaceId !== workspaceId ||
        !agentResult.value.isActive
      ) {
        throw badRequest(
          'Default agent must be active and in this workspace',
          'INVALID_DEFAULT_AGENT'
        );
      }
    }

    const settings = fromResult(await workspaceService.updateAgentAiSettings(workspaceId, data), {
      status: 400,
      code: 'UPDATE_FAILED',
      message: 'Failed to update AI settings',
    });
    return c.json({ success: true, data: settings });
  }
);

export { workspaceApiKeysRoutes };
