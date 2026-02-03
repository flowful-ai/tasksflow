import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase } from '@flowtask/database';
import { WorkspaceService } from '@flowtask/domain';
import { getCurrentUser, type AuthContext } from '@flowtask/auth';
import { CreateWorkspaceSchema, UpdateWorkspaceSchema, WorkspaceRoleSchema } from '@flowtask/shared';
import { hasPermission } from '@flowtask/auth';

const workspaces = new Hono();
const db = getDatabase();
const workspaceService = new WorkspaceService(db);

// List workspaces for current user
workspaces.get('/', async (c) => {
  const user = getCurrentUser(c);

  const result = await workspaceService.list({
    filters: { userId: user.id },
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
  }

  return c.json({ success: true, data: result.value });
});

// Create workspace
workspaces.post(
  '/',
  zValidator('json', CreateWorkspaceSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const data = c.req.valid('json');

    const result = await workspaceService.create({
      ...data,
      ownerId: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value }, 201);
  }
);

// Get workspace by ID
workspaces.get('/:workspaceId', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');

  // Check membership
  const isMember = await workspaceService.isMember(workspaceId, user.id);
  if (!isMember) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a workspace member' } }, 403);
  }

  const result = await workspaceService.getById(workspaceId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
  }

  return c.json({ success: true, data: result.value });
});

// Get workspace by slug
workspaces.get('/by-slug/:slug', async (c) => {
  const user = getCurrentUser(c);
  const slug = c.req.param('slug');

  const result = await workspaceService.getBySlug(slug);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
  }

  // Check membership
  const isMember = await workspaceService.isMember(result.value.id, user.id);
  if (!isMember) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a workspace member' } }, 403);
  }

  return c.json({ success: true, data: result.value });
});

// Update workspace
workspaces.patch(
  '/:workspaceId',
  zValidator('json', UpdateWorkspaceSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const workspaceId = c.req.param('workspaceId');
    const data = c.req.valid('json');

    // Check permission
    const roleResult = await workspaceService.getMemberRole(workspaceId, user.id);
    if (!roleResult.ok || !roleResult.value) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a workspace member' } }, 403);
    }

    if (!hasPermission(roleResult.value, 'workspace:update')) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403);
    }

    const result = await workspaceService.update(workspaceId, {
      ...data,
      updatedBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value });
  }
);

// Delete workspace
workspaces.delete('/:workspaceId', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');

  // Check permission (only owner can delete)
  const roleResult = await workspaceService.getMemberRole(workspaceId, user.id);
  if (!roleResult.ok || roleResult.value !== 'owner') {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Only the owner can delete a workspace' } }, 403);
  }

  const result = await workspaceService.delete(workspaceId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

// Member management

// Add member
workspaces.post(
  '/:workspaceId/members',
  zValidator(
    'json',
    z.object({
      userId: z.string().uuid(),
      role: WorkspaceRoleSchema.default('member'),
    })
  ),
  async (c) => {
    const user = getCurrentUser(c);
    const workspaceId = c.req.param('workspaceId');
    const { userId, role } = c.req.valid('json');

    // Check permission
    const roleResult = await workspaceService.getMemberRole(workspaceId, user.id);
    if (!roleResult.ok || !roleResult.value) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a workspace member' } }, 403);
    }

    if (!hasPermission(roleResult.value, 'workspace:manage_members')) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403);
    }

    const result = await workspaceService.addMember({
      workspaceId,
      userId,
      role,
      addedBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'ADD_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value }, 201);
  }
);

// Update member role
workspaces.patch(
  '/:workspaceId/members/:memberId',
  zValidator('json', z.object({ role: WorkspaceRoleSchema })),
  async (c) => {
    const user = getCurrentUser(c);
    const workspaceId = c.req.param('workspaceId');
    const memberId = c.req.param('memberId');
    const { role } = c.req.valid('json');

    // Check permission
    const roleResult = await workspaceService.getMemberRole(workspaceId, user.id);
    if (!roleResult.ok || !roleResult.value) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a workspace member' } }, 403);
    }

    if (!hasPermission(roleResult.value, 'workspace:manage_members')) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403);
    }

    const result = await workspaceService.updateMember({
      workspaceId,
      userId: memberId,
      role,
      updatedBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value });
  }
);

// Remove member
workspaces.delete('/:workspaceId/members/:memberId', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.param('workspaceId');
  const memberId = c.req.param('memberId');

  // Check permission (or user removing themselves)
  if (memberId !== user.id) {
    const roleResult = await workspaceService.getMemberRole(workspaceId, user.id);
    if (!roleResult.ok || !roleResult.value) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not a workspace member' } }, 403);
    }

    if (!hasPermission(roleResult.value, 'workspace:manage_members')) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient permissions' } }, 403);
    }
  }

  const result = await workspaceService.removeMember({
    workspaceId,
    userId: memberId,
    removedBy: user.id,
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'REMOVE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

export { workspaces as workspaceRoutes };
