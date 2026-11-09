import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase } from '@flowtask/database';
import { WorkspaceService } from '@flowtask/domain';
import {
  CreateWorkspaceSchema,
  UpdateWorkspaceSchema,
  WorkspaceRoleSchema,
  WorkspaceActivityQuerySchema,
  WorkspaceActivityCursorSchema,
  REALTIME_EVENTS,
} from '@flowtask/shared';
import { getAuthz, requireUser, requireWorkspace } from '../lib/authorize.js';
import { badRequest, forbidden, fromResult, handleRouteError } from '../lib/responses.js';
import { notifyAccessChanged, notifyMemberRemoved, publishEvent } from '../sse/manager.js';

const workspaces = new Hono();
workspaces.onError(handleRouteError);

const db = getDatabase();
const workspaceService = new WorkspaceService(db);

function encodeCursor(cursor: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } | null {
  try {
    const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
    const parsed: unknown = JSON.parse(decoded);
    const validated = WorkspaceActivityCursorSchema.safeParse(parsed);
    return validated.success ? validated.data : null;
  } catch {
    return null;
  }
}

// List workspaces for current user
workspaces.get('/', async (c) => {
  const user = requireUser(c);
  const list = fromResult(await workspaceService.list({ filters: { userId: user.id } }), {
    code: 'LIST_FAILED',
    message: 'Failed to list workspaces',
  });
  return c.json({ success: true, data: list });
});

// Create workspace
workspaces.post('/', zValidator('json', CreateWorkspaceSchema), async (c) => {
  const user = requireUser(c);
  const data = c.req.valid('json');
  const workspace = fromResult(await workspaceService.create({ ...data, ownerId: user.id }), {
    status: 400,
    code: 'CREATE_FAILED',
    message: 'Failed to create workspace',
  });
  return c.json({ success: true, data: workspace }, 201);
});

// Get workspace by slug (registered before '/:workspaceId' routes for clarity)
workspaces.get('/by-slug/:slug', async (c) => {
  requireUser(c);
  const result = await workspaceService.getBySlug(c.req.param('slug'));
  // Do not reveal whether a slug exists to non-members.
  if (!result.ok) throw forbidden('Not a workspace member');
  await requireWorkspace(c, result.value.id, 'workspace:read');

  return c.json({ success: true, data: result.value });
});

// Get workspace by ID
workspaces.get('/:workspaceId', async (c) => {
  const { workspaceId } = await requireWorkspace(c, c.req.param('workspaceId'), 'workspace:read');
  const workspace = fromResult(await workspaceService.getById(workspaceId), {
    code: 'FETCH_FAILED',
    message: 'Failed to load workspace',
  });
  return c.json({ success: true, data: workspace });
});

// Get current user's role in a workspace
workspaces.get('/:workspaceId/me', async (c) => {
  const { role } = await requireWorkspace(c, c.req.param('workspaceId'), 'workspace:read');
  return c.json({ success: true, data: { role } });
});

// List recent task activity for workspace, limited to projects the caller can access
workspaces.get('/:workspaceId/activity', zValidator('query', WorkspaceActivityQuerySchema), async (c) => {
  const { workspaceId, role, user } = await requireWorkspace(c, c.req.param('workspaceId'), 'project:read');
  const query = c.req.valid('query');

  let cursor: { createdAt: Date; id: string } | undefined;
  if (query.cursor) {
    cursor = decodeCursor(query.cursor) || undefined;
    if (!cursor) throw badRequest('Invalid cursor format', 'INVALID_CURSOR');
  }

  const projectIds = await getAuthz().listAccessibleProjectIds(workspaceId, user.id, role);
  const page = fromResult(await workspaceService.listActivity(workspaceId, { limit: query.limit, cursor, projectIds }), {
    code: 'LIST_FAILED',
    message: 'Failed to load activity',
  });

  return c.json({
    success: true,
    data: page.items,
    meta: {
      limit: query.limit,
      nextCursor: page.nextCursor ? encodeCursor(page.nextCursor) : null,
    },
  });
});

// Update workspace
workspaces.patch('/:workspaceId', zValidator('json', UpdateWorkspaceSchema), async (c) => {
  const { workspaceId, user } = await requireWorkspace(c, c.req.param('workspaceId'), 'workspace:update');
  const data = c.req.valid('json');
  const workspace = fromResult(await workspaceService.update(workspaceId, { ...data, updatedBy: user.id }), {
    status: 400,
    code: 'UPDATE_FAILED',
    message: 'Failed to update workspace',
  });
  return c.json({ success: true, data: workspace });
});

// Delete workspace (owner only)
workspaces.delete('/:workspaceId', async (c) => {
  const { workspaceId } = await requireWorkspace(c, c.req.param('workspaceId'), 'workspace:delete');
  fromResult(await workspaceService.delete(workspaceId), {
    code: 'DELETE_FAILED',
    message: 'Failed to delete workspace',
  });
  return c.json({ success: true, data: null });
});

// === Member management ===

// List members
workspaces.get('/:workspaceId/members', async (c) => {
  const { workspaceId } = await requireWorkspace(c, c.req.param('workspaceId'), 'workspace:read');
  const workspace = fromResult(await workspaceService.getById(workspaceId), {
    code: 'FETCH_FAILED',
    message: 'Failed to load members',
  });
  return c.json({ success: true, data: workspace.members });
});

// Add member. Owner role can only be granted by an owner; others may only
// assign roles at or below their own (enforced in WorkspaceService).
workspaces.post(
  '/:workspaceId/members',
  zValidator('json', z.object({ userId: z.string().uuid(), role: WorkspaceRoleSchema.default('member') })),
  async (c) => {
    const { workspaceId, user } = await requireWorkspace(c, c.req.param('workspaceId'), 'workspace:manage_members');
    const { userId, role } = c.req.valid('json');

    const member = fromResult(await workspaceService.addMember({ workspaceId, userId, role, addedBy: user.id }), {
      status: 400,
      code: 'ADD_FAILED',
      message: 'Failed to add member',
    });

    publishEvent(workspaceId, REALTIME_EVENTS.MEMBER_JOINED, { workspaceId, userId });
    return c.json({ success: true, data: member }, 201);
  }
);

// Transfer ownership to another member (owner only). The previous owner becomes an admin.
workspaces.post(
  '/:workspaceId/transfer-ownership',
  zValidator('json', z.object({ userId: z.string().uuid() })),
  async (c) => {
    const { workspaceId, user, role } = await requireWorkspace(c, c.req.param('workspaceId'), 'workspace:read');
    if (role !== 'owner') throw forbidden('Only an owner can transfer ownership');
    const { userId } = c.req.valid('json');

    const member = fromResult(
      await workspaceService.transferOwnership({ workspaceId, fromUserId: user.id, toUserId: userId }),
      { status: 400, code: 'TRANSFER_FAILED', message: 'Failed to transfer ownership' }
    );

    notifyAccessChanged(workspaceId, user.id);
    notifyAccessChanged(workspaceId, userId);
    return c.json({ success: true, data: member });
  }
);

// Update member role
workspaces.patch(
  '/:workspaceId/members/:memberId',
  zValidator('json', z.object({ role: WorkspaceRoleSchema })),
  async (c) => {
    const { workspaceId, user } = await requireWorkspace(c, c.req.param('workspaceId'), 'workspace:manage_members');
    const memberId = c.req.param('memberId');
    const { role } = c.req.valid('json');

    const member = fromResult(
      await workspaceService.updateMember({ workspaceId, userId: memberId, role, updatedBy: user.id }),
      { status: 400, code: 'UPDATE_FAILED', message: 'Failed to update member' }
    );

    notifyAccessChanged(workspaceId, memberId);
    return c.json({ success: true, data: member });
  }
);

// Remove member (or leave the workspace when removing yourself)
workspaces.delete('/:workspaceId/members/:memberId', async (c) => {
  const user = requireUser(c);
  const workspaceId = c.req.param('workspaceId');
  const memberId = c.req.param('memberId');

  if (memberId !== user.id) {
    await requireWorkspace(c, workspaceId, 'workspace:manage_members');
  } else {
    await requireWorkspace(c, workspaceId, 'workspace:read');
  }

  fromResult(await workspaceService.removeMember({ workspaceId, userId: memberId, removedBy: user.id }), {
    status: 400,
    code: 'REMOVE_FAILED',
    message: 'Failed to remove member',
  });

  // Close the removed user's realtime streams on every instance immediately.
  notifyMemberRemoved(workspaceId, memberId);
  publishEvent(workspaceId, REALTIME_EVENTS.MEMBER_LEFT, { workspaceId, userId: memberId });
  return c.json({ success: true, data: null });
});

export { workspaces as workspaceRoutes };
