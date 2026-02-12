import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase } from '@flowtask/database';
import { AgentService, WorkspaceService } from '@flowtask/domain';
import { getCurrentUser } from '@flowtask/auth';
import { CreateAgentSchema, UpdateAgentSchema, RunAgentSchema, getRequiredApiKeyProvidersForModel } from '@flowtask/shared';
import { hasPermission } from '@flowtask/auth';

const agents = new Hono();
const db = getDatabase();
const agentService = new AgentService(db);
const workspaceService = new WorkspaceService(db);

// Helper to check workspace access
async function checkWorkspaceAccess(workspaceId: string, userId: string, permission: string) {
  const roleResult = await workspaceService.getMemberRole(workspaceId, userId);
  if (!roleResult.ok || !roleResult.value) {
    return { allowed: false, role: null };
  }
  return {
    allowed: hasPermission(roleResult.value, permission as any),
    role: roleResult.value,
  };
}

// List agents
agents.get('/', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.query('workspaceId');

  if (!workspaceId) {
    return c.json({ success: false, error: { code: 'MISSING_PARAM', message: 'workspaceId is required' } }, 400);
  }

  const { allowed } = await checkWorkspaceAccess(workspaceId, user.id, 'agent:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await agentService.list({
    filters: {
      workspaceId,
      isActive: c.req.query('isActive') !== 'false',
    },
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
  }

  return c.json({ success: true, data: result.value });
});

// Create agent
agents.post(
  '/',
  zValidator(
    'json',
    CreateAgentSchema.extend({ workspaceId: z.string().uuid() })
  ),
  async (c) => {
    const user = getCurrentUser(c);
    const data = c.req.valid('json');

    const { allowed } = await checkWorkspaceAccess(data.workspaceId, user.id, 'agent:create');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await agentService.create({
      ...data,
      createdBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value }, 201);
  }
);

// Get agent by ID
agents.get('/:agentId', async (c) => {
  const user = getCurrentUser(c);
  const agentId = c.req.param('agentId');

  const result = await agentService.getById(agentId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(result.value.workspaceId, user.id, 'agent:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  return c.json({ success: true, data: result.value });
});

// Update agent
agents.patch(
  '/:agentId',
  zValidator('json', UpdateAgentSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const agentId = c.req.param('agentId');
    const data = c.req.valid('json');

    const agentResult = await agentService.getById(agentId);
    if (!agentResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: agentResult.error.message } }, 404);
    }

    const { allowed } = await checkWorkspaceAccess(agentResult.value.workspaceId, user.id, 'agent:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await agentService.update(agentId, {
      ...data,
      updatedBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value });
  }
);

// Delete agent
agents.delete('/:agentId', async (c) => {
  const user = getCurrentUser(c);
  const agentId = c.req.param('agentId');

  const agentResult = await agentService.getById(agentId);
  if (!agentResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: agentResult.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(agentResult.value.workspaceId, user.id, 'agent:delete');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await agentService.delete(agentId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

// Run agent
agents.post(
  '/:agentId/run',
  zValidator('json', RunAgentSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const agentId = c.req.param('agentId');
    const data = c.req.valid('json');

    const agentResult = await agentService.getById(agentId);
    if (!agentResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: agentResult.error.message } }, 404);
    }

    const { allowed } = await checkWorkspaceAccess(agentResult.value.workspaceId, user.id, 'agent:execute');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    // Check rate limiting
    if (agentResult.value.isRateLimited) {
      return c.json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Agent has reached its daily token limit',
        },
      }, 429);
    }

    const requiredProviders = getRequiredApiKeyProvidersForModel(agentResult.value.model);
    const keyChecks = await Promise.all(
      requiredProviders.map(async (provider) => ({
        provider,
        hasKey: await agentService.hasApiKey(agentResult.value.workspaceId, provider),
      }))
    );
    const hasAnyKey = keyChecks.some((entry) => entry.hasKey);

    if (!hasAnyKey) {
      const requiredProviderNames = requiredProviders.map((provider) => provider.toUpperCase()).join(' or ');
      return c.json({
        success: false,
        error: {
          code: 'NO_API_KEY',
          message: `Please configure a workspace ${requiredProviderNames} API key first`,
        },
      }, 400);
    }

    // TODO: Implement actual agent execution with OpenRouter
    // This would involve:
    // 1. Getting the API key
    // 2. Building the conversation with system prompt
    // 3. Running the conversation loop with tool execution
    // 4. Recording token usage

    return c.json({
      success: true,
      data: {
        message: 'Agent execution not yet implemented',
        agentId,
        input: data,
      },
    });
  }
);

export { agents as agentRoutes };
