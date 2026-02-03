import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { Redis } from 'ioredis';
import { getDatabase } from '@flowtask/database';
import { WorkspaceAgentService, WorkspaceService } from '@flowtask/domain';
import { getCurrentUser, hasPermission } from '@flowtask/auth';
import { CreateWorkspaceAgentSchema, UpdateWorkspaceAgentSchema } from '@flowtask/shared';

const workspaceAgentsRouter = new Hono();
const db = getDatabase();
const workspaceService = new WorkspaceService(db);

// Initialize Redis for rate limiting
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);
const workspaceAgentService = new WorkspaceAgentService(db, redis);

// Helper to check workspace access
async function checkWorkspaceAccess(workspaceId: string, userId: string, permission: string) {
  const roleResult = await workspaceService.getMemberRole(workspaceId, userId);
  if (!roleResult.ok || !roleResult.value) {
    return { allowed: false, role: null };
  }

  return {
    allowed: hasPermission(roleResult.value, permission as Parameters<typeof hasPermission>[1]),
    role: roleResult.value,
  };
}

// List workspace agents
workspaceAgentsRouter.get('/:workspaceId/agents', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');

  const { allowed } = await checkWorkspaceAccess(workspaceId, user.id, 'workspace:manage_settings');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to manage workspace agents' } }, 403);
  }

  const result = await workspaceAgentService.list({
    filters: { workspaceId },
    sortBy: c.req.query('sortBy') as 'name' | 'created_at' | 'last_used_at' | undefined,
    sortOrder: c.req.query('sortOrder') as 'asc' | 'desc' | undefined,
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
  }

  return c.json({ success: true, data: result.value });
});

// Create workspace agent
workspaceAgentsRouter.post(
  '/:workspaceId/agents',
  zValidator('json', CreateWorkspaceAgentSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const workspaceId = c.req.param('workspaceId');
    const data = c.req.valid('json');

    const { allowed } = await checkWorkspaceAccess(workspaceId, user.id, 'workspace:manage_settings');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to manage workspace agents' } }, 403);
    }

    const result = await workspaceAgentService.create({
      ...data,
      workspaceId,
      createdBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    // IMPORTANT: This is the only time the token is returned
    return c.json({
      success: true,
      data: result.value,
      message: 'Save this token now - it will not be shown again.',
    }, 201);
  }
);

// Get workspace agent by ID
workspaceAgentsRouter.get('/:workspaceId/agents/:agentId', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');
  const agentId = c.req.param('agentId');

  const { allowed } = await checkWorkspaceAccess(workspaceId, user.id, 'workspace:manage_settings');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to manage workspace agents' } }, 403);
  }

  const result = await workspaceAgentService.getById(agentId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
  }

  // Verify agent belongs to this workspace
  if (result.value.workspaceId !== workspaceId) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
  }

  return c.json({ success: true, data: result.value });
});

// Update workspace agent
workspaceAgentsRouter.patch(
  '/:workspaceId/agents/:agentId',
  zValidator('json', UpdateWorkspaceAgentSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const workspaceId = c.req.param('workspaceId');
    const agentId = c.req.param('agentId');
    const data = c.req.valid('json');

    const { allowed } = await checkWorkspaceAccess(workspaceId, user.id, 'workspace:manage_settings');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to manage workspace agents' } }, 403);
    }

    // Verify agent belongs to this workspace
    const existingResult = await workspaceAgentService.getById(agentId);
    if (!existingResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
    }
    if (existingResult.value.workspaceId !== workspaceId) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
    }

    const result = await workspaceAgentService.update(agentId, {
      ...data,
      updatedBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value });
  }
);

// Delete (revoke) workspace agent
workspaceAgentsRouter.delete('/:workspaceId/agents/:agentId', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');
  const agentId = c.req.param('agentId');

  const { allowed } = await checkWorkspaceAccess(workspaceId, user.id, 'workspace:manage_settings');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to manage workspace agents' } }, 403);
  }

  // Verify agent belongs to this workspace
  const existingResult = await workspaceAgentService.getById(agentId);
  if (!existingResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
  }
  if (existingResult.value.workspaceId !== workspaceId) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
  }

  const result = await workspaceAgentService.delete(agentId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

// Regenerate workspace agent token
workspaceAgentsRouter.post('/:workspaceId/agents/:agentId/regenerate', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');
  const agentId = c.req.param('agentId');

  const { allowed } = await checkWorkspaceAccess(workspaceId, user.id, 'workspace:manage_settings');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized to manage workspace agents' } }, 403);
  }

  // Verify agent belongs to this workspace
  const existingResult = await workspaceAgentService.getById(agentId);
  if (!existingResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
  }
  if (existingResult.value.workspaceId !== workspaceId) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Agent not found' } }, 404);
  }

  const result = await workspaceAgentService.regenerate(agentId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'REGENERATE_FAILED', message: result.error.message } }, 400);
  }

  // IMPORTANT: This is the only time the new token is returned
  return c.json({
    success: true,
    data: result.value,
    message: 'Save this token now - it will not be shown again. The previous token has been invalidated.',
  });
});

export { workspaceAgentsRouter as workspaceAgentRoutes };
