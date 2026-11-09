import { Hono, type Context } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase, type PublicShare } from '../db/index.js';
import {
  SmartViewService,
  TaskService,
  parseHiddenFields,
  toPublicTask,
  type PublicTask,
  type SmartViewWithRelations,
} from '../domain/index.js';
import { hasPermission } from '../auth/index.js';
import { createPaginationQuerySchema } from '@flowtask/shared';
import {
  executeSmartViewTaskList,
  isFilterGroupValue,
  smartViewUsesCurrentUserTemplate,
  SMART_VIEW_MAX_LIMIT,
  UNSUPPORTED_PUBLIC_FILTER_CODE,
  UNSUPPORTED_PUBLIC_FILTER_MESSAGE,
  readTimezoneHeader,
} from './smart-view-query-utils.js';
import { getAuthz } from '../lib/authorize.js';
import { getClientIp } from '../lib/client-ip.js';
import {
  AppError,
  badRequest,
  fromResult,
  handleRouteError,
  notFound,
  tooManyRequests,
} from '../lib/responses.js';

const publicRoutes = new Hono();
publicRoutes.onError(handleRouteError);

const db = getDatabase();
const smartViewService = new SmartViewService(db);
const taskService = new TaskService(db);

const PublicPageQuerySchema = createPaginationQuerySchema({
  defaultLimit: 50,
  maxLimit: SMART_VIEW_MAX_LIMIT,
});

interface PublicSharePayload {
  view: {
    name: string;
    description: string | null;
    displayType: string;
    groupBy: string;
    secondaryGroupBy: string | null;
    sortBy: string | null;
    sortOrder: string | null;
    visibleFields: string[] | null;
  };
  tasks: PublicTask[];
  meta: {
    total: number;
    page: number;
    limit: number;
  };
}

/** Any failure to resolve a share is reported the same way. */
const shareNotFound = (): AppError => notFound('Share');

async function loadActiveShare(token: string): Promise<PublicShare> {
  const result = await smartViewService.getPublicShareByToken(token);
  if (!result.ok) throw shareNotFound();
  return result.value;
}

async function loadSharedView(share: PublicShare): Promise<SmartViewWithRelations> {
  const result = await smartViewService.getById(share.smartViewId);
  if (!result.ok) throw shareNotFound();
  return result.value;
}

/**
 * Run the shared view with the access of the user who created the share.
 * If that user has left the workspace or lost the sharing permission, the
 * link stops working instead of exposing data they can no longer see.
 */
async function buildPublicSharePayload(
  view: SmartViewWithRelations,
  share: PublicShare,
  page: number,
  limit: number,
  timezone: string | undefined
): Promise<PublicSharePayload> {
  const filters = isFilterGroupValue(view.filters) ? view.filters : undefined;
  if (smartViewUsesCurrentUserTemplate(filters)) {
    throw badRequest(UNSUPPORTED_PUBLIC_FILTER_MESSAGE, UNSUPPORTED_PUBLIC_FILTER_CODE);
  }

  if (!share.createdBy) throw shareNotFound();
  const authz = getAuthz();
  const creatorRole = await authz.getRole(view.workspaceId, share.createdBy);
  if (!creatorRole || !hasPermission(creatorRole, 'smart_view:share')) throw shareNotFound();
  const projectIds = await authz.listAccessibleProjectIds(
    view.workspaceId,
    share.createdBy,
    creatorRole,
    {
      excludeArchived: true,
    }
  );

  const result = fromResult(
    await executeSmartViewTaskList({
      view,
      taskService,
      projectIds,
      filterContextUserId: 'public-share',
      page,
      limit,
      timezone,
    }),
    { code: 'FETCH_FAILED', message: 'Failed to load shared tasks' }
  );

  const options = {
    hiddenFields: parseHiddenFields(share.hideFields),
    showExternalLinks: share.showExternalLinks,
  };
  const visibleFields = Array.isArray(view.visibleFields)
    ? view.visibleFields.filter((field): field is string => typeof field === 'string')
    : null;

  return {
    view: {
      name: view.name,
      description: view.description,
      displayType: share.displayTypeOverride || view.displayType,
      groupBy: view.groupBy,
      secondaryGroupBy: view.secondaryGroupBy,
      sortBy: view.sortBy,
      sortOrder: view.sortOrder,
      visibleFields,
    },
    tasks: result.tasks.map((task) => toPublicTask(task, options)),
    meta: {
      total: Number(result.total),
      page,
      limit,
    },
  };
}

function pageOf(c: Context): { page: number; limit: number } {
  const parsed = PublicPageQuerySchema.safeParse({
    page: c.req.query('page'),
    limit: c.req.query('limit'),
  });
  return parsed.success ? parsed.data : { page: 1, limit: 50 };
}

// Access public share by token
publicRoutes.get('/share/:token', async (c) => {
  const share = await loadActiveShare(c.req.param('token'));

  if (share.passwordHash) {
    return c.json({ success: true, data: { requiresPassword: true, shareId: share.id } });
  }

  const view = await loadSharedView(share);
  const { page, limit } = pageOf(c);
  const payload = await buildPublicSharePayload(view, share, page, limit, readTimezoneHeader(c));
  await smartViewService.recordPublicShareAccess(share.token);

  return c.json({ success: true, data: payload });
});

// Verify password for protected share
publicRoutes.post(
  '/share/:token/verify',
  zValidator('json', z.object({ password: z.string().max(1024) })),
  async (c) => {
    const share = await loadActiveShare(c.req.param('token'));
    const ip = getClientIp(c);

    // Count the attempt *before* verifying: per (ip, token) and per token
    // regardless of IP, so neither parallel guesses nor rotating IPs get around it.
    const attempt = fromResult(await smartViewService.beginPasswordAttempt(share.token, ip), {
      code: 'RATE_LIMIT_FAILED',
      message: 'Unable to verify password right now',
    });
    if (!attempt.allowed) {
      c.header('Retry-After', String(attempt.retryAfterSeconds));
      throw tooManyRequests('Too many attempts. Try again later.');
    }

    const { password } = c.req.valid('json');
    const verified = await smartViewService.verifyPublicSharePassword(share.token, password);
    const success = verified.ok && verified.value;
    await smartViewService.settlePasswordAttempt(share.token, ip, success);

    if (!success) {
      throw new AppError(401, 'INVALID_PASSWORD', 'Invalid password');
    }

    const view = await loadSharedView(share);
    const { page, limit } = pageOf(c);
    const payload = await buildPublicSharePayload(view, share, page, limit, readTimezoneHeader(c));
    await smartViewService.recordPublicShareAccess(share.token);

    return c.json({ success: true, data: payload });
  }
);

export { publicRoutes };
