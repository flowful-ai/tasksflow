/**
 * Task relations (blocks / relates / duplicates). Mounted at /api/tasks
 * BEFORE the tasks router (paths are /:taskId/relations…, which never collide
 * with the tasks router's single-segment /:taskId routes).
 *
 *   GET    /:taskId/relations                  → TaskRelationView[]
 *   POST   /:taskId/relations                  { relatedTaskId, type, direction? } → 201 TaskRelationView
 *   DELETE /:taskId/relations/:relationId      → null
 */
import { Hono } from 'hono';
import { z } from 'zod';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '../db/index.js';
import { TaskRelationService } from '../domain/index.js';
import { getAuthz, requireTask } from '../lib/authorize.js';
import { fromResult, handleRouteError, validationHook } from '../lib/responses.js';
import { AddTaskRelationSchema } from '@flowtask/shared';

const taskRelationRoutes = new Hono();
taskRelationRoutes.onError(handleRouteError);
const db = getDatabase();
const relationService = new TaskRelationService(db);

const ParamsSchema = z.object({ taskId: z.string().uuid() });
const RelationParamsSchema = z.object({ taskId: z.string().uuid(), relationId: z.string().uuid() });

const FAILED = { code: 'INTERNAL_ERROR', message: 'Request failed' };

taskRelationRoutes.get(
  '/:taskId/relations',
  zValidator('param', ParamsSchema, validationHook),
  async (c) => {
    const { taskId } = c.req.valid('param');
    const { user } = await requireTask(c, taskId, 'task:read');

    const relations = fromResult(await relationService.list(taskId), FAILED);
    // Hide relations to tasks the user cannot see (restricted projects).
    const visible = [];
    for (const view of relations) {
      if ((await getAuthz().authorizeTask(view.task.id, user.id, 'task:read')).ok)
        visible.push(view);
    }
    return c.json({ success: true, data: visible });
  }
);

taskRelationRoutes.post(
  '/:taskId/relations',
  zValidator('param', ParamsSchema, validationHook),
  zValidator('json', AddTaskRelationSchema, validationHook),
  async (c) => {
    const { taskId } = c.req.valid('param');
    const body = c.req.valid('json');
    const { user } = await requireTask(c, taskId, 'task:update');
    await requireTask(c, body.relatedTaskId, 'task:update');

    const relation = fromResult(
      await relationService.add({
        taskId,
        relatedTaskId: body.relatedTaskId,
        type: body.type,
        direction: body.direction,
        createdBy: user.id,
      }),
      FAILED
    );
    return c.json({ success: true, data: relation }, 201);
  }
);

taskRelationRoutes.delete(
  '/:taskId/relations/:relationId',
  zValidator('param', RelationParamsSchema, validationHook),
  async (c) => {
    const { taskId, relationId } = c.req.valid('param');
    const { user } = await requireTask(c, taskId, 'task:update');

    fromResult(await relationService.remove(taskId, relationId, user.id), FAILED);
    return c.json({ success: true, data: null });
  }
);

export { taskRelationRoutes };
