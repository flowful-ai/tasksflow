import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { getDatabase } from '@flowtask/database';
import { CommentService } from '@flowtask/domain';
import { CreateCommentSchema, UpdateCommentSchema, PaginationQuerySchema, REALTIME_EVENTS } from '@flowtask/shared';
import { publishEvent } from '../sse/manager.js';
import { GitHubReverseSyncService } from '@flowtask/integrations';
import { hasPermission } from '@flowtask/auth';
import { requireTask } from '../lib/authorize.js';
import { fromResult, handleRouteError, notFound } from '../lib/responses.js';

const comments = new Hono();
comments.onError(handleRouteError);

const db = getDatabase();
const commentService = new CommentService(db);
const githubReverseSync = new GitHubReverseSyncService(db);

/** Load a comment and make sure it belongs to the (already authorized) task. */
async function loadTaskComment(taskId: string, commentId: string) {
  const result = await commentService.getById(commentId);
  if (!result.ok || result.value.taskId !== taskId || result.value.deletedAt) {
    throw notFound('Comment');
  }
  return result.value;
}

// List comments for a task
comments.get('/:taskId/comments', zValidator('query', PaginationQuerySchema), async (c) => {
  const { task } = await requireTask(c, c.req.param('taskId'), 'comment:read');
  const { page, limit } = c.req.valid('query');

  const result = fromResult(await commentService.list({ taskId: task.id, page, limit }), {
    code: 'LIST_FAILED',
    message: 'Failed to list comments',
  });

  return c.json({
    success: true,
    data: result.comments,
    meta: {
      total: result.total,
      page,
      limit,
    },
  });
});

// Get comment count for a task. Registered before '/:commentId' so that
// "count" is not captured as a comment id.
comments.get('/:taskId/comments/count', async (c) => {
  const { task } = await requireTask(c, c.req.param('taskId'), 'comment:read');
  const count = fromResult(await commentService.getCount(task.id), {
    code: 'COUNT_FAILED',
    message: 'Failed to count comments',
  });
  return c.json({ success: true, data: { count } });
});

// Create a comment on a task
comments.post('/:taskId/comments', zValidator('json', CreateCommentSchema), async (c) => {
  const { task, workspaceId, user } = await requireTask(c, c.req.param('taskId'), 'comment:create');
  const data = c.req.valid('json');

  const comment = fromResult(await commentService.create({ taskId: task.id, userId: user.id, content: data.content }), {
    status: 400,
    code: 'CREATE_FAILED',
    message: 'Failed to create comment',
  });

  publishEvent(
    workspaceId,
    REALTIME_EVENTS.COMMENT_CREATED,
    { taskId: task.id, projectId: task.projectId, comment },
    { projectId: task.projectId }
  );

  // Trigger GitHub comment sync (async, non-blocking)
  githubReverseSync
    .syncCommentToGitHub(task.id, {
      content: data.content,
      authorId: user.id,
      authorName: user.name || undefined,
    })
    .catch((error: unknown) => {
      console.error('GitHub comment sync error:', error);
    });

  return c.json({ success: true, data: comment }, 201);
});

// Get a specific comment
comments.get('/:taskId/comments/:commentId', async (c) => {
  const { task } = await requireTask(c, c.req.param('taskId'), 'comment:read');
  const comment = await loadTaskComment(task.id, c.req.param('commentId'));
  return c.json({ success: true, data: comment });
});

// Update a comment (author only, enforced by CommentService)
comments.patch('/:taskId/comments/:commentId', zValidator('json', UpdateCommentSchema), async (c) => {
  const { task, workspaceId, user } = await requireTask(c, c.req.param('taskId'), 'comment:update');
  const existing = await loadTaskComment(task.id, c.req.param('commentId'));
  const data = c.req.valid('json');

  const comment = fromResult(await commentService.update(existing.id, { content: data.content, updatedBy: user.id }), {
    status: 400,
    code: 'UPDATE_FAILED',
    message: 'Failed to update comment',
  });

  publishEvent(
    workspaceId,
    REALTIME_EVENTS.COMMENT_UPDATED,
    { taskId: task.id, projectId: task.projectId, comment },
    { projectId: task.projectId }
  );

  return c.json({ success: true, data: comment });
});

// Delete a comment (soft delete). Authors can delete their own comments;
// roles with comment:delete (admins, owners) can moderate any comment.
comments.delete('/:taskId/comments/:commentId', async (c) => {
  const { task, workspaceId, user, role } = await requireTask(c, c.req.param('taskId'), 'comment:read');
  const existing = await loadTaskComment(task.id, c.req.param('commentId'));

  fromResult(
    await commentService.delete(existing.id, user.id, {
      canModerate: hasPermission(role, 'comment:delete'),
    }),
    { status: 400, code: 'DELETE_FAILED', message: 'Failed to delete comment' }
  );

  publishEvent(
    workspaceId,
    REALTIME_EVENTS.COMMENT_DELETED,
    { taskId: task.id, projectId: task.projectId, commentId: existing.id },
    { projectId: task.projectId }
  );

  return c.json({ success: true, data: null });
});

export { comments as commentRoutes };
