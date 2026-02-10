import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { Redis } from 'ioredis';
import { getDatabase } from '@flowtask/database';
import { SmartViewService, TaskService, RateLimitService, ProjectService } from '@flowtask/domain';
import type { FilterGroup } from '@flowtask/shared';
import {
  executeSmartViewTaskList,
  smartViewUsesCurrentUserTemplate,
  UNSUPPORTED_PUBLIC_FILTER_CODE,
  UNSUPPORTED_PUBLIC_FILTER_MESSAGE,
} from './smart-view-query-utils.js';

const publicRoutes = new Hono();

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);
const rateLimitService = new RateLimitService(redis);
const db = getDatabase();
const smartViewService = new SmartViewService(db);
const taskService = new TaskService(db);
const projectService = new ProjectService(db);

function applyHiddenFields<T extends object>(items: T[], hideFields: string[]): T[] {
  if (hideFields.length === 0) {
    return items;
  }

  return items.map((item) => {
    const itemCopy = { ...item } as T & Record<string, unknown>;
    for (const field of hideFields) {
      if (field in itemCopy) {
        delete itemCopy[field];
      }
    }
    return itemCopy as T;
  });
}

type PublicSharePayloadResult =
  | {
      ok: true;
      data: {
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
        tasks: object[];
        meta: {
          total: number;
          page: number;
          limit: number;
        };
      };
    }
  | {
      ok: false;
      status: 400 | 500;
      code: string;
      message: string;
    };

async function buildPublicSharePayload({
  view,
  share,
  page,
  limit,
}: {
  view: {
    workspaceId: string;
    filters: unknown;
    sortBy: string | null;
    sortOrder: string | null;
    name: string;
    description: string | null;
    displayType: string;
    groupBy: string;
    secondaryGroupBy: string | null;
    visibleFields: unknown;
  };
  share: {
    displayTypeOverride: string | null;
    hideFields: unknown;
  };
  page: number;
  limit: number;
}): Promise<PublicSharePayloadResult> {
  const viewFilters = view.filters as FilterGroup | undefined;
  if (smartViewUsesCurrentUserTemplate(viewFilters)) {
    return {
      ok: false as const,
      status: 400,
      code: UNSUPPORTED_PUBLIC_FILTER_CODE,
      message: UNSUPPORTED_PUBLIC_FILTER_MESSAGE,
    };
  }

  const tasksResult = await executeSmartViewTaskList({
    view,
    taskService,
    projectService,
    filterContextUserId: 'public-share',
    page,
    limit,
  });

  if (!tasksResult.ok) {
    return {
      ok: false as const,
      status: 500,
      code: 'FETCH_FAILED',
      message: tasksResult.error.message,
    };
  }

  const hideFields = Array.isArray(share.hideFields) ? share.hideFields.filter((f): f is string => typeof f === 'string') : [];
  const filteredTasks = applyHiddenFields(tasksResult.value.tasks, hideFields);
  const displayType = share.displayTypeOverride || view.displayType;
  const visibleFields = Array.isArray(view.visibleFields)
    ? view.visibleFields.filter((field): field is string => typeof field === 'string')
    : null;

  return {
    ok: true as const,
    data: {
      view: {
        name: view.name,
        description: view.description,
        displayType,
        groupBy: view.groupBy,
        secondaryGroupBy: view.secondaryGroupBy,
        sortBy: view.sortBy,
        sortOrder: view.sortOrder,
        visibleFields,
      },
      tasks: filteredTasks,
      meta: {
        total: tasksResult.value.total,
        page,
        limit,
      },
    },
  };
}

// Access public share by token
publicRoutes.get('/share/:token', async (c) => {
  const token = c.req.param('token');

  // Get the public share
  const shareResult = await smartViewService.getPublicShareByToken(token);

  if (!shareResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: shareResult.error.message } }, 404);
  }

  const share = shareResult.value;

  // Check if password protected
  if (share.passwordHash) {
    return c.json({
      success: true,
      data: {
        requiresPassword: true,
        shareId: share.id,
      },
    });
  }

  // Record access
  await smartViewService.recordPublicShareAccess(token);

  // Get the smart view
  const viewResult = await smartViewService.getById(share.smartViewId);
  if (!viewResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Smart view not found' } }, 404);
  }

  const view = viewResult.value;
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));

  const payloadResult = await buildPublicSharePayload({ view, share, page, limit });
  if (!payloadResult.ok) {
    return c.json(
      {
        success: false,
        error: {
          code: payloadResult.code,
          message: payloadResult.message,
        },
      },
      payloadResult.status
    );
  }

  return c.json({
    success: true,
    data: payloadResult.data,
  });
});

// Verify password for protected share
publicRoutes.post(
  '/share/:token/verify',
  zValidator('json', z.object({ password: z.string() })),
  async (c) => {
    const token = c.req.param('token');
    const ip = c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown';
    const rateLimitKey = `share-pw:${ip}:${token}`;

    // Check if locked out from too many failed attempts
    const lockout = await rateLimitService.isLockedOut(rateLimitKey);
    if (lockout.lockedOut) {
      return c.json({ success: false, error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } }, 429);
    }

    const { password } = c.req.valid('json');

    const isValid = await smartViewService.verifyPublicSharePassword(token, password);

    if (!isValid.ok || !isValid.value) {
      await rateLimitService.trackFailedAttempt(rateLimitKey);
      return c.json({ success: false, error: { code: 'INVALID_PASSWORD', message: 'Invalid password' } }, 401);
    }

    // Clear failed attempts on success
    await rateLimitService.clearFailedAttempts(rateLimitKey);

    // Record access
    await smartViewService.recordPublicShareAccess(token);

    // Get the public share
    const shareResult = await smartViewService.getPublicShareByToken(token);
    if (!shareResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Share not found' } }, 404);
    }

    const share = shareResult.value;

    // Get the smart view
    const viewResult = await smartViewService.getById(share.smartViewId);
    if (!viewResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Smart view not found' } }, 404);
    }

    const view = viewResult.value;

    const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));

    const payloadResult = await buildPublicSharePayload({ view, share, page, limit });
    if (!payloadResult.ok) {
      return c.json(
        {
          success: false,
          error: {
            code: payloadResult.code,
            message: payloadResult.message,
          },
        },
        payloadResult.status
      );
    }

    return c.json({
      success: true,
      data: payloadResult.data,
    });
  }
);

export { publicRoutes };
