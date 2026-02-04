import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase } from '@flowtask/database';
import { TaskService, ProjectService, WorkspaceService } from '@flowtask/domain';
import { getCurrentUser } from '@flowtask/auth';
import { CreateTaskSchema, UpdateTaskSchema, MoveTaskSchema, CreateCommentSchema } from '@flowtask/shared';
import { hasPermission } from '@flowtask/auth';
import { publishEvent } from '../sse/manager.js';

const tasks = new Hono();
const db = getDatabase();
const taskService = new TaskService(db);
const projectService = new ProjectService(db);
const workspaceService = new WorkspaceService(db);

// Helper to check task access via project -> workspace
async function checkTaskAccess(projectId: string, userId: string, permission: string) {
  const projectResult = await projectService.getById(projectId);
  if (!projectResult.ok) {
    return { allowed: false, project: null };
  }

  const roleResult = await workspaceService.getMemberRole(projectResult.value.workspaceId, userId);
  if (!roleResult.ok || !roleResult.value) {
    return { allowed: false, project: projectResult.value };
  }

  return {
    allowed: hasPermission(roleResult.value, permission as any),
    project: projectResult.value,
  };
}

// List tasks
tasks.get('/', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.query('projectId');

  if (!projectId) {
    return c.json({ success: false, error: { code: 'MISSING_PARAM', message: 'projectId is required' } }, 400);
  }

  const { allowed } = await checkTaskAccess(projectId, user.id, 'task:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await taskService.list({
    filters: {
      projectId,
      stateId: c.req.query('stateId'),
      assigneeId: c.req.query('assigneeId'),
      priority: c.req.query('priority') as any,
      search: c.req.query('search'),
      includeDeleted: c.req.query('includeDeleted') === 'true',
    },
    sortBy: (c.req.query('sortBy') as any) || 'position',
    sortOrder: (c.req.query('sortOrder') as any) || 'asc',
    page: parseInt(c.req.query('page') || '1', 10),
    limit: parseInt(c.req.query('limit') || '50', 10),
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
  }

  return c.json({
    success: true,
    data: result.value.tasks,
    meta: {
      total: result.value.total,
      page: parseInt(c.req.query('page') || '1', 10),
      limit: parseInt(c.req.query('limit') || '50', 10),
    },
  });
});

// Create task
tasks.post(
  '/',
  zValidator(
    'json',
    CreateTaskSchema.extend({ projectId: z.string().uuid() })
  ),
  async (c) => {
    const user = getCurrentUser(c);
    const data = c.req.valid('json');

    const { allowed, project } = await checkTaskAccess(data.projectId, user.id, 'task:create');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await taskService.create({
      ...data,
      createdBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    // Publish WebSocket event
    publishEvent(project!.workspaceId, 'task:created', result.value);

    return c.json({ success: true, data: result.value }, 201);
  }
);

// Get task by ID
tasks.get('/:taskId', async (c) => {
  const user = getCurrentUser(c);
  const taskId = c.req.param('taskId');

  const result = await taskService.getById(taskId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
  }

  const { allowed } = await checkTaskAccess(result.value.projectId, user.id, 'task:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  return c.json({ success: true, data: result.value });
});

// Update task
tasks.patch(
  '/:taskId',
  zValidator('json', UpdateTaskSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const taskId = c.req.param('taskId');
    const data = c.req.valid('json');

    // Get task first
    const taskResult = await taskService.getById(taskId);
    if (!taskResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
    }

    const { allowed, project } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await taskService.update(taskId, {
      ...data,
      updatedBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error.message } }, 400);
    }

    // Publish WebSocket event
    publishEvent(project!.workspaceId, 'task:updated', result.value);

    return c.json({ success: true, data: result.value });
  }
);

// Move task (change state and/or position)
tasks.post(
  '/:taskId/move',
  zValidator('json', MoveTaskSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const taskId = c.req.param('taskId');
    const data = c.req.valid('json');

    // Get task first
    const taskResult = await taskService.getById(taskId);
    if (!taskResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
    }

    const { allowed, project } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await taskService.move(taskId, {
      ...data,
      movedBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'MOVE_FAILED', message: result.error.message } }, 400);
    }

    // Publish WebSocket event
    publishEvent(project!.workspaceId, 'task:moved', result.value);

    return c.json({ success: true, data: result.value });
  }
);

// Delete task (soft delete)
tasks.delete('/:taskId', async (c) => {
  const user = getCurrentUser(c);
  const taskId = c.req.param('taskId');

  // Get task first
  const taskResult = await taskService.getById(taskId);
  if (!taskResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
  }

  const { allowed, project } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:delete');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await taskService.delete(taskId, user.id);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  // Publish WebSocket event
  publishEvent(project!.workspaceId, 'task:deleted', { id: taskId });

  return c.json({ success: true, data: null });
});

// Restore task
tasks.post('/:taskId/restore', async (c) => {
  const user = getCurrentUser(c);
  const taskId = c.req.param('taskId');

  // Get task first (including deleted)
  const taskResult = await taskService.getById(taskId);
  if (!taskResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
  }

  const { allowed, project } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:update');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await taskService.restore(taskId, user.id);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'RESTORE_FAILED', message: result.error.message } }, 400);
  }

  // Publish WebSocket event
  publishEvent(project!.workspaceId, 'task:created', result.value);

  return c.json({ success: true, data: result.value });
});

// === Assignees ===

// Add assignee
tasks.post(
  '/:taskId/assignees',
  zValidator('json', z.object({ userId: z.string().uuid() })),
  async (c) => {
    const user = getCurrentUser(c);
    const taskId = c.req.param('taskId');
    const { userId } = c.req.valid('json');

    // Get task first
    const taskResult = await taskService.getById(taskId);
    if (!taskResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
    }

    const { allowed, project } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:assign');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await taskService.addAssignee(taskId, userId, user.id);

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'ASSIGN_FAILED', message: result.error.message } }, 400);
    }

    // Get updated task and publish
    const updatedTask = await taskService.getById(taskId);
    if (updatedTask.ok) {
      publishEvent(project!.workspaceId, 'task:updated', updatedTask.value);
    }

    return c.json({ success: true, data: null });
  }
);

// Remove assignee
tasks.delete('/:taskId/assignees/:userId', async (c) => {
  const user = getCurrentUser(c);
  const taskId = c.req.param('taskId');
  const userId = c.req.param('userId');

  // Get task first
  const taskResult = await taskService.getById(taskId);
  if (!taskResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
  }

  const { allowed, project } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:assign');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await taskService.removeAssignee(taskId, userId, user.id);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'UNASSIGN_FAILED', message: result.error.message } }, 400);
  }

  // Get updated task and publish
  const updatedTask = await taskService.getById(taskId);
  if (updatedTask.ok) {
    publishEvent(project!.workspaceId, 'task:updated', updatedTask.value);
  }

  return c.json({ success: true, data: null });
});

// === Labels ===

// Add label
tasks.post(
  '/:taskId/labels',
  zValidator('json', z.object({ labelId: z.string().uuid() })),
  async (c) => {
    const user = getCurrentUser(c);
    const taskId = c.req.param('taskId');
    const { labelId } = c.req.valid('json');

    // Get task first
    const taskResult = await taskService.getById(taskId);
    if (!taskResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
    }

    const { allowed, project } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await taskService.addLabel(taskId, labelId, user.id);

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'LABEL_FAILED', message: result.error.message } }, 400);
    }

    // Get updated task and publish
    const updatedTask = await taskService.getById(taskId);
    if (updatedTask.ok) {
      publishEvent(project!.workspaceId, 'task:updated', updatedTask.value);
    }

    return c.json({ success: true, data: null });
  }
);

// Remove label
tasks.delete('/:taskId/labels/:labelId', async (c) => {
  const user = getCurrentUser(c);
  const taskId = c.req.param('taskId');
  const labelId = c.req.param('labelId');

  // Get task first
  const taskResult = await taskService.getById(taskId);
  if (!taskResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
  }

  const { allowed, project } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:update');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await taskService.removeLabel(taskId, labelId, user.id);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'UNLABEL_FAILED', message: result.error.message } }, 400);
  }

  // Get updated task and publish
  const updatedTask = await taskService.getById(taskId);
  if (updatedTask.ok) {
    publishEvent(project!.workspaceId, 'task:updated', updatedTask.value);
  }

  return c.json({ success: true, data: null });
});

// === Position calculation helper ===

// Calculate position between two tasks
tasks.post(
  '/calculate-position',
  zValidator(
    'json',
    z.object({
      beforePosition: z.string().nullable().optional(),
      afterPosition: z.string().nullable().optional(),
    })
  ),
  async (c) => {
    const data = c.req.valid('json');

    const position = taskService.calculatePositionBetween(
      data.beforePosition ?? null,
      data.afterPosition ?? null
    );

    return c.json({ success: true, data: { position } });
  }
);

export { tasks as taskRoutes };
