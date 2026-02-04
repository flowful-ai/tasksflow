import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '@flowtask/database';
import { CommentService, TaskService, ProjectService, WorkspaceService } from '@flowtask/domain';
import { getCurrentUser } from '@flowtask/auth';
import { CreateCommentSchema, UpdateCommentSchema } from '@flowtask/shared';
import { hasPermission } from '@flowtask/auth';
import { publishEvent } from '../sse/manager.js';

const comments = new Hono();
const db = getDatabase();
const commentService = new CommentService(db);
const taskService = new TaskService(db);
const projectService = new ProjectService(db);
const workspaceService = new WorkspaceService(db);

// Helper to check task access via project -> workspace
async function checkTaskAccess(taskId: string, userId: string, permission: string) {
  const taskResult = await taskService.getById(taskId);
  if (!taskResult.ok) {
    return { allowed: false, task: null, project: null };
  }

  const projectResult = await projectService.getById(taskResult.value.projectId);
  if (!projectResult.ok) {
    return { allowed: false, task: taskResult.value, project: null };
  }

  const roleResult = await workspaceService.getMemberRole(projectResult.value.workspaceId, userId);
  if (!roleResult.ok || !roleResult.value) {
    return { allowed: false, task: taskResult.value, project: projectResult.value };
  }

  return {
    allowed: hasPermission(roleResult.value, permission as any),
    task: taskResult.value,
    project: projectResult.value,
  };
}

// List comments for a task
comments.get('/:taskId/comments', async (c) => {
  const user = getCurrentUser(c);
  const taskId = c.req.param('taskId');

  const { allowed } = await checkTaskAccess(taskId, user.id, 'task:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const page = parseInt(c.req.query('page') || '1', 10);
  const limit = parseInt(c.req.query('limit') || '50', 10);

  const result = await commentService.list({
    taskId,
    page,
    limit,
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
  }

  return c.json({
    success: true,
    data: result.value.comments,
    meta: {
      total: result.value.total,
      page,
      limit,
    },
  });
});

// Create a comment on a task
comments.post(
  '/:taskId/comments',
  zValidator('json', CreateCommentSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const taskId = c.req.param('taskId');
    const data = c.req.valid('json');

    const { allowed, project } = await checkTaskAccess(taskId, user.id, 'task:read');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await commentService.create({
      taskId,
      userId: user.id,
      content: data.content,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    // Publish WebSocket event
    if (project) {
      publishEvent(project.workspaceId, 'comment:created', {
        taskId,
        comment: result.value,
      });
    }

    return c.json({ success: true, data: result.value }, 201);
  }
);

// Get a specific comment
comments.get('/:taskId/comments/:commentId', async (c) => {
  const user = getCurrentUser(c);
  const taskId = c.req.param('taskId');
  const commentId = c.req.param('commentId');

  const { allowed } = await checkTaskAccess(taskId, user.id, 'task:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await commentService.getById(commentId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
  }

  // Verify the comment belongs to the task
  if (result.value.taskId !== taskId) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Comment not found' } }, 404);
  }

  return c.json({ success: true, data: result.value });
});

// Update a comment
comments.patch(
  '/:taskId/comments/:commentId',
  zValidator('json', UpdateCommentSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const taskId = c.req.param('taskId');
    const commentId = c.req.param('commentId');
    const data = c.req.valid('json');

    const { allowed, project } = await checkTaskAccess(taskId, user.id, 'task:read');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    // First get the comment to verify it belongs to this task
    const existingResult = await commentService.getById(commentId);
    if (!existingResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: existingResult.error.message } }, 404);
    }

    if (existingResult.value.taskId !== taskId) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Comment not found' } }, 404);
    }

    const result = await commentService.update(commentId, {
      content: data.content,
      updatedBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error.message } }, 400);
    }

    // Publish WebSocket event
    if (project) {
      publishEvent(project.workspaceId, 'comment:updated', {
        taskId,
        comment: result.value,
      });
    }

    return c.json({ success: true, data: result.value });
  }
);

// Delete a comment (soft delete)
comments.delete('/:taskId/comments/:commentId', async (c) => {
  const user = getCurrentUser(c);
  const taskId = c.req.param('taskId');
  const commentId = c.req.param('commentId');

  const { allowed, project } = await checkTaskAccess(taskId, user.id, 'task:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  // First get the comment to verify it belongs to this task
  const existingResult = await commentService.getById(commentId);
  if (!existingResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: existingResult.error.message } }, 404);
  }

  if (existingResult.value.taskId !== taskId) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: 'Comment not found' } }, 404);
  }

  const result = await commentService.delete(commentId, user.id);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  // Publish WebSocket event
  if (project) {
    publishEvent(project.workspaceId, 'comment:deleted', {
      taskId,
      commentId,
    });
  }

  return c.json({ success: true, data: null });
});

// Get comment count for a task
comments.get('/:taskId/comments/count', async (c) => {
  const user = getCurrentUser(c);
  const taskId = c.req.param('taskId');

  const { allowed } = await checkTaskAccess(taskId, user.id, 'task:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await commentService.getCount(taskId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'COUNT_FAILED', message: result.error.message } }, 500);
  }

  return c.json({ success: true, data: { count: result.value } });
});

export { comments as commentRoutes };
