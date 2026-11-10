import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase } from '../db/index.js';
import { SmartViewService, TaskService, toSmartViewDto } from '../domain/index.js';
import { hasPermission } from '../auth/index.js';
import {
  CreateSmartViewSchema,
  UpdateSmartViewSchema,
  CreatePublicShareSchema,
  createPaginationQuerySchema,
} from '@flowtask/shared';
import {
  executeSmartViewTaskList,
  isFilterGroupValue,
  smartViewUsesCurrentUserTemplate,
  SMART_VIEW_MAX_LIMIT,
  UNSUPPORTED_PUBLIC_FILTER_CODE,
  UNSUPPORTED_PUBLIC_FILTER_MESSAGE,
  readTimezoneHeader,
} from './smart-view-query-utils.js';
import {
  canShareSmartView,
  getAuthz,
  requireSmartView,
  requireWorkspace,
} from '../lib/authorize.js';
import {
  badRequest,
  forbidden,
  fromResult,
  handleRouteError,
  validationHook,
} from '../lib/responses.js';
import { getWebUrl } from '../integrations/index.js';

const smartViews = new Hono();
smartViews.onError(handleRouteError);

const db = getDatabase();
const smartViewService = new SmartViewService(db);
const taskService = new TaskService(db);

const ExecuteQuerySchema = createPaginationQuerySchema({
  defaultLimit: 50,
  maxLimit: SMART_VIEW_MAX_LIMIT,
});

function shareUrl(token: string): string {
  return `${getWebUrl()}/share/${token}`;
}

// List smart views visible to the caller (team views, own personal views, views shared with them)
smartViews.get('/', async (c) => {
  const { workspaceId, role, user } = await requireWorkspace(
    c,
    c.req.query('workspaceId'),
    'smart_view:read'
  );

  const views = fromResult(
    await smartViewService.list({ filters: { workspaceId, userId: user.id, includeShared: true } }),
    { code: 'LIST_FAILED', message: 'Failed to list smart views' }
  );

  const canShare = hasPermission(role, 'smart_view:share');
  const data = views.map((view) =>
    toSmartViewDto(view, {
      includePublicShares: canShare && (!view.isPersonal || view.createdBy === user.id),
    })
  );
  return c.json({ success: true, data });
});

// Create smart view
smartViews.post(
  '/',
  zValidator(
    'json',
    CreateSmartViewSchema.extend({ workspaceId: z.string().uuid() }),
    validationHook
  ),
  async (c) => {
    const data = c.req.valid('json');
    const { workspaceId, user } = await requireWorkspace(c, data.workspaceId, 'smart_view:create');

    const view = fromResult(
      await smartViewService.create({ ...data, workspaceId, createdBy: user.id }),
      {
        status: 400,
        code: 'CREATE_FAILED',
        message: 'Failed to create smart view',
      }
    );

    return c.json(
      { success: true, data: toSmartViewDto(view, { includePublicShares: true }) },
      201
    );
  }
);

// Get smart view by ID
smartViews.get('/:viewId', async (c) => {
  const grant = await requireSmartView(c, c.req.param('viewId'), 'read');
  return c.json({
    success: true,
    data: toSmartViewDto(grant.view, { includePublicShares: canShareSmartView(grant) }),
  });
});

// Execute smart view (get filtered tasks from the projects the caller can access)
smartViews.get(
  '/:viewId/execute',
  zValidator('query', ExecuteQuerySchema, validationHook),
  async (c) => {
    const grant = await requireSmartView(c, c.req.param('viewId'), 'read');
    const { page, limit } = c.req.valid('query');
    const { view, role, user } = grant;

    const projectIds = await getAuthz().listAccessibleProjectIds(view.workspaceId, user.id, role, {
      excludeArchived: true,
    });

    const result = fromResult(
      await executeSmartViewTaskList({
        view,
        taskService,
        projectIds,
        filterContextUserId: user.id,
        page,
        limit,
        timezone: readTimezoneHeader(c),
      }),
      { code: 'EXECUTE_FAILED', message: 'Failed to execute smart view' }
    );

    return c.json({
      success: true,
      data: {
        view: toSmartViewDto(view, { includePublicShares: canShareSmartView(grant) }),
        tasks: result.tasks,
        meta: {
          total: Number(result.total),
          page,
          limit,
        },
      },
    });
  }
);

// Update smart view
smartViews.patch(
  '/:viewId',
  zValidator('json', UpdateSmartViewSchema, validationHook),
  async (c) => {
    const grant = await requireSmartView(c, c.req.param('viewId'), 'update');
    const data = c.req.valid('json');

    // Only the creator may change a view's visibility.
    if (data.isPersonal !== undefined && grant.view.createdBy !== grant.user.id) {
      throw forbidden('Only the creator can change whether a view is personal');
    }

    const view = fromResult(
      await smartViewService.update(grant.view.id, { ...data, updatedBy: grant.user.id }),
      {
        status: 400,
        code: 'UPDATE_FAILED',
        message: 'Failed to update smart view',
      }
    );

    return c.json({
      success: true,
      data: toSmartViewDto(view, { includePublicShares: canShareSmartView(grant) }),
    });
  }
);

// Delete smart view
smartViews.delete('/:viewId', async (c) => {
  const { view } = await requireSmartView(c, c.req.param('viewId'), 'delete');
  fromResult(await smartViewService.delete(view.id), {
    code: 'DELETE_FAILED',
    message: 'Failed to delete smart view',
  });
  return c.json({ success: true, data: null });
});

// === Sharing with workspace members ===

smartViews.post(
  '/:viewId/shares',
  zValidator(
    'json',
    z.object({
      userId: z.string().uuid(),
      permission: z.enum(['view', 'edit']).default('view'),
    }),
    validationHook
  ),
  async (c) => {
    const { view } = await requireSmartView(c, c.req.param('viewId'), 'share');
    const data = c.req.valid('json');

    if (!(await getAuthz().areWorkspaceMembers(view.workspaceId, [data.userId]))) {
      throw badRequest('Views can only be shared with workspace members', 'INVALID_USER');
    }

    const share = fromResult(
      await smartViewService.share({
        smartViewId: view.id,
        sharedWithUserId: data.userId,
        permission: data.permission,
      }),
      { status: 400, code: 'SHARE_FAILED', message: 'Failed to share smart view' }
    );

    return c.json({ success: true, data: share }, 201);
  }
);

smartViews.delete('/:viewId/shares/:userId', async (c) => {
  const { view } = await requireSmartView(c, c.req.param('viewId'), 'share');
  const userId = c.req.param('userId');
  if (!z.string().uuid().safeParse(userId).success) throw badRequest('Invalid user id');

  fromResult(await smartViewService.unshare(view.id, userId), {
    code: 'UNSHARE_FAILED',
    message: 'Failed to remove share',
  });

  return c.json({ success: true, data: null });
});

// === Public Sharing ===

smartViews.post(
  '/:viewId/public',
  zValidator('json', CreatePublicShareSchema, validationHook),
  async (c) => {
    const { view, user } = await requireSmartView(c, c.req.param('viewId'), 'share');
    const data = c.req.valid('json');

    if (
      smartViewUsesCurrentUserTemplate(isFilterGroupValue(view.filters) ? view.filters : undefined)
    ) {
      throw badRequest(UNSUPPORTED_PUBLIC_FILTER_MESSAGE, UNSUPPORTED_PUBLIC_FILTER_CODE);
    }

    const share = fromResult(
      await smartViewService.createPublicShare({
        ...data,
        smartViewId: view.id,
        createdBy: user.id,
      }),
      {
        status: 400,
        code: 'CREATE_FAILED',
        message: 'Failed to create public share',
      }
    );

    const { passwordHash, ...safeShare } = share;
    return c.json(
      {
        success: true,
        data: {
          ...safeShare,
          hasPassword: Boolean(passwordHash),
          shareUrl: shareUrl(share.token),
        },
      },
      201
    );
  }
);

smartViews.post('/:viewId/public/:shareId/disable', async (c) => {
  const { view } = await requireSmartView(c, c.req.param('viewId'), 'share');
  const shareId = c.req.param('shareId');
  if (!z.string().uuid().safeParse(shareId).success) throw badRequest('Invalid share id');

  fromResult(await smartViewService.disablePublicShare(view.id, shareId), {
    code: 'DISABLE_FAILED',
    message: 'Failed to disable public share',
  });

  return c.json({ success: true, data: null });
});

smartViews.delete('/:viewId/public/:shareId', async (c) => {
  const { view } = await requireSmartView(c, c.req.param('viewId'), 'share');
  const shareId = c.req.param('shareId');
  if (!z.string().uuid().safeParse(shareId).success) throw badRequest('Invalid share id');

  fromResult(await smartViewService.deletePublicShare(view.id, shareId), {
    code: 'DELETE_FAILED',
    message: 'Failed to delete public share',
  });

  return c.json({ success: true, data: null });
});

export { smartViews as smartViewRoutes };
