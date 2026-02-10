import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase } from '@flowtask/database';
import { SmartViewService, WorkspaceService, TaskService, ProjectService } from '@flowtask/domain';
import { getCurrentUser } from '@flowtask/auth';
import { CreateSmartViewSchema, UpdateSmartViewSchema, CreatePublicShareSchema, type FilterGroup } from '@flowtask/shared';
import { hasPermission } from '@flowtask/auth';
import {
  executeSmartViewTaskList,
  smartViewUsesCurrentUserTemplate,
  UNSUPPORTED_PUBLIC_FILTER_CODE,
  UNSUPPORTED_PUBLIC_FILTER_MESSAGE,
} from './smart-view-query-utils.js';

const smartViews = new Hono();
const db = getDatabase();
const smartViewService = new SmartViewService(db);
const workspaceService = new WorkspaceService(db);
const taskService = new TaskService(db);
const projectService = new ProjectService(db);

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

// List smart views
smartViews.get('/', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.query('workspaceId');

  if (!workspaceId) {
    return c.json({ success: false, error: { code: 'MISSING_PARAM', message: 'workspaceId is required' } }, 400);
  }

  const { allowed } = await checkWorkspaceAccess(workspaceId, user.id, 'smart_view:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await smartViewService.list({
    filters: {
      workspaceId,
      userId: user.id,
      includeShared: true,
    },
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
  }

  return c.json({ success: true, data: result.value });
});

// Create smart view
smartViews.post(
  '/',
  zValidator(
    'json',
    CreateSmartViewSchema.extend({ workspaceId: z.string().uuid() })
  ),
  async (c) => {
    const user = getCurrentUser(c);
    const data = c.req.valid('json');

    const { allowed } = await checkWorkspaceAccess(data.workspaceId, user.id, 'smart_view:create');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await smartViewService.create({
      ...data,
      createdBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value }, 201);
  }
);

// Get smart view by ID
smartViews.get('/:viewId', async (c) => {
  const user = getCurrentUser(c);
  const viewId = c.req.param('viewId');

  const result = await smartViewService.getById(viewId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(result.value.workspaceId, user.id, 'smart_view:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  return c.json({ success: true, data: result.value });
});

// Execute smart view (get filtered tasks)
smartViews.get('/:viewId/execute', async (c) => {
  const user = getCurrentUser(c);
  const viewId = c.req.param('viewId');

  const viewResult = await smartViewService.getById(viewId);

  if (!viewResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: viewResult.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(viewResult.value.workspaceId, user.id, 'smart_view:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const view = viewResult.value;
  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const tasksResult = await executeSmartViewTaskList({
    view,
    taskService,
    projectService,
    filterContextUserId: user.id,
    page,
    limit,
  });

  if (!tasksResult.ok) {
    return c.json({ success: false, error: { code: 'EXECUTE_FAILED', message: tasksResult.error.message } }, 500);
  }

  return c.json({
    success: true,
    data: {
      view,
      tasks: tasksResult.value.tasks,
      meta: {
        total: tasksResult.value.total,
        page,
        limit,
      },
    },
  });
});

// Update smart view
smartViews.patch(
  '/:viewId',
  zValidator('json', UpdateSmartViewSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const viewId = c.req.param('viewId');
    const data = c.req.valid('json');

    const viewResult = await smartViewService.getById(viewId);
    if (!viewResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: viewResult.error.message } }, 404);
    }

    const { allowed } = await checkWorkspaceAccess(viewResult.value.workspaceId, user.id, 'smart_view:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await smartViewService.update(viewId, {
      ...data,
      updatedBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value });
  }
);

// Delete smart view
smartViews.delete('/:viewId', async (c) => {
  const user = getCurrentUser(c);
  const viewId = c.req.param('viewId');

  const viewResult = await smartViewService.getById(viewId);
  if (!viewResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: viewResult.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(viewResult.value.workspaceId, user.id, 'smart_view:delete');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await smartViewService.delete(viewId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

// === Sharing ===

// Share with user
smartViews.post(
  '/:viewId/shares',
  zValidator(
    'json',
    z.object({
      userId: z.string().uuid(),
      permission: z.enum(['view', 'edit']).default('view'),
    })
  ),
  async (c) => {
    const user = getCurrentUser(c);
    const viewId = c.req.param('viewId');
    const data = c.req.valid('json');

    const viewResult = await smartViewService.getById(viewId);
    if (!viewResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: viewResult.error.message } }, 404);
    }

    const { allowed } = await checkWorkspaceAccess(viewResult.value.workspaceId, user.id, 'smart_view:share');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await smartViewService.share({
      smartViewId: viewId,
      sharedWithUserId: data.userId,
      permission: data.permission,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'SHARE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value }, 201);
  }
);

// Remove share
smartViews.delete('/:viewId/shares/:userId', async (c) => {
  const user = getCurrentUser(c);
  const viewId = c.req.param('viewId');
  const userId = c.req.param('userId');

  const viewResult = await smartViewService.getById(viewId);
  if (!viewResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: viewResult.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(viewResult.value.workspaceId, user.id, 'smart_view:share');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await smartViewService.unshare(viewId, userId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'UNSHARE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

// === Public Sharing ===

// Create public share
smartViews.post(
  '/:viewId/public',
  zValidator('json', CreatePublicShareSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const viewId = c.req.param('viewId');
    const data = c.req.valid('json');

    const viewResult = await smartViewService.getById(viewId);
    if (!viewResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: viewResult.error.message } }, 404);
    }

    const { allowed } = await checkWorkspaceAccess(viewResult.value.workspaceId, user.id, 'smart_view:share');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const viewFilters = viewResult.value.filters as FilterGroup | undefined;
    if (smartViewUsesCurrentUserTemplate(viewFilters)) {
      return c.json(
        {
          success: false,
          error: {
            code: UNSUPPORTED_PUBLIC_FILTER_CODE,
            message: UNSUPPORTED_PUBLIC_FILTER_MESSAGE,
          },
        },
        400
      );
    }

    const result = await smartViewService.createPublicShare({
      ...data,
      smartViewId: viewId,
      createdBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({
      success: true,
      data: {
        ...result.value,
        shareUrl: `${process.env.WEB_URL || 'http://localhost:3000'}/share/${result.value.token}`,
      },
    }, 201);
  }
);

// Disable public share
smartViews.post('/:viewId/public/:shareId/disable', async (c) => {
  const user = getCurrentUser(c);
  const viewId = c.req.param('viewId');
  const shareId = c.req.param('shareId');

  const viewResult = await smartViewService.getById(viewId);
  if (!viewResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: viewResult.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(viewResult.value.workspaceId, user.id, 'smart_view:share');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await smartViewService.disablePublicShare(shareId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DISABLE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

// Delete public share
smartViews.delete('/:viewId/public/:shareId', async (c) => {
  const user = getCurrentUser(c);
  const viewId = c.req.param('viewId');
  const shareId = c.req.param('shareId');

  const viewResult = await smartViewService.getById(viewId);
  if (!viewResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: viewResult.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(viewResult.value.workspaceId, user.id, 'smart_view:share');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await smartViewService.deletePublicShare(shareId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

export { smartViews as smartViewRoutes };
