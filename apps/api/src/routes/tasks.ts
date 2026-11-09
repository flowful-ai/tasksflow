import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase, projectIntegrations, externalLinks, taskStates } from '@flowtask/database';
import { TaskService, ProjectService, WorkspaceService } from '@flowtask/domain';
import { getCurrentUser } from '@flowtask/auth';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  MoveTaskSchema,
  CreateCommentSchema,
  LinkTaskGitHubPrSchema,
  TaskPrioritySchema,
} from '@flowtask/shared';
import { hasPermission, type WorkspacePermission } from '@flowtask/auth';
import { publishEvent } from '../sse/manager.js';
import { GitHubReverseSyncService, createGitHubClientForInstallation } from '@flowtask/integrations';
import { and, eq } from 'drizzle-orm';
import { TaskGitHubLinkError, TaskGitHubLinkService } from '../services/task-github-link-service.js';
import { GitHubRepoRefSchema, LinkTaskGitHubIssueSchema } from '@flowtask/shared';
import { VALID_TASK_SORT_BY, VALID_TASK_SORT_ORDER } from './smart-view-query-utils.js';

// Validates and coerces task-list query params. Keeps invalid values out of the
// service layer and clamps `limit` so a client can't request an unbounded page.
// Sort vocabularies are shared with smart-view query execution so they can't drift.
const TaskListQuerySchema = z.object({
  priority: TaskPrioritySchema.optional(),
  sortBy: z.enum(VALID_TASK_SORT_BY).default('position'),
  sortOrder: z.enum(VALID_TASK_SORT_ORDER).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const tasks = new Hono();
const db = getDatabase();
const taskService = new TaskService(db);
const projectService = new ProjectService(db);
const workspaceService = new WorkspaceService(db);
const githubReverseSync = new GitHubReverseSyncService(db);
const taskGitHubLinkService = new TaskGitHubLinkService(db, publishEvent);

// Helper to trigger GitHub reverse sync (async, non-blocking)
function triggerGitHubSync(
  taskId: string,
  changes: {
    title?: string;
    description?: string;
    stateId?: string | null;
    priority?: string | null;
    labelIds?: string[];
  },
  skipGitHubSync?: boolean
) {
  if (skipGitHubSync) return;

  // Run in background, don't await
  githubReverseSync.syncTaskToGitHub(taskId, changes, { skipIfRecentSync: true }).catch((error: unknown) => {
    console.error('GitHub reverse sync error:', error);
  });
}

// Helper to check task access via project -> workspace + project access control
async function checkTaskAccess(projectId: string, userId: string, permission: WorkspacePermission) {
  const projectResult = await projectService.getById(projectId);
  if (!projectResult.ok) {
    return { allowed: false, project: null };
  }

  const roleResult = await workspaceService.getMemberRole(projectResult.value.workspaceId, userId);
  if (!roleResult.ok || !roleResult.value) {
    return { allowed: false, project: projectResult.value };
  }

  const role = roleResult.value as 'owner' | 'admin' | 'member';
  if (!hasPermission(role, permission)) {
    return { allowed: false, project: projectResult.value };
  }

  // Check project-level access
  const hasProjectAccess = await projectService.hasAccess(projectId, userId, role);
  return {
    allowed: hasProjectAccess,
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

  // Map present-but-empty params ("?sortBy=") to undefined so the schema
  // defaults apply instead of failing the enum/number validation.
  const parsedQuery = TaskListQuerySchema.safeParse({
    priority: c.req.query('priority') || undefined,
    sortBy: c.req.query('sortBy') || undefined,
    sortOrder: c.req.query('sortOrder') || undefined,
    page: c.req.query('page') || undefined,
    limit: c.req.query('limit') || undefined,
  });
  if (!parsedQuery.success) {
    return c.json({ success: false, error: { code: 'INVALID_QUERY', message: 'Invalid query parameters' } }, 400);
  }
  const { priority, sortBy, sortOrder, page, limit } = parsedQuery.data;

  const result = await taskService.list({
    filters: {
      projectId,
      stateId: c.req.query('stateId'),
      assigneeId: c.req.query('assigneeId'),
      priority,
      search: c.req.query('search'),
      includeDeleted: c.req.query('includeDeleted') === 'true',
    },
    sortBy,
    sortOrder,
    page,
    limit,
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
  }

  return c.json({
    success: true,
    data: result.value.tasks,
    meta: {
      total: result.value.total,
      page,
      limit,
    },
  });
});

// Map TaskGitHubLinkService errors to the API error shape.
function githubLinkErrorResponse(error: unknown): { body: { success: false; error: { code: string; message: string } }; status: 400 | 404 | 409 | 500 } {
  if (error instanceof TaskGitHubLinkError) {
    return { body: { success: false, error: { code: error.code, message: error.message } }, status: error.status };
  }
  return {
    body: {
      success: false,
      error: { code: 'GITHUB_ERROR', message: error instanceof Error ? error.message : 'GitHub request failed' },
    },
    status: 500,
  };
}

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

    // Optionally create a linked GitHub issue in the background (retried; the
    // board updates over SSE once the link exists).
    const githubQueued = Boolean(data.createOnGitHub && data.githubRepo);
    if (data.createOnGitHub && data.githubRepo) {
      taskGitHubLinkService.scheduleIssueCreation({
        taskId: result.value.id,
        projectId: data.projectId,
        owner: data.githubRepo.owner,
        repo: data.githubRepo.repo,
      });
    }

    return c.json({
      success: true,
      data: result.value,
      github: githubQueued ? { queued: true } : null,
    }, 201);
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

    // Trigger GitHub reverse sync
    triggerGitHubSync(taskId, {
      title: data.title,
      description: data.description,
      stateId: data.stateId,
      priority: data.priority,
    });

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

    // Validate that target state belongs to the same project (safety net for cross-project moves)
    if (data.stateId) {
      const targetState = await db.query.taskStates.findFirst({
        where: eq(taskStates.id, data.stateId),
      });

      if (!targetState) {
        return c.json({ success: false, error: { code: 'STATE_NOT_FOUND', message: 'Invalid state' } }, 400);
      }

      if (targetState.projectId !== taskResult.value.projectId) {
        return c.json({
          success: false,
          error: { code: 'CROSS_PROJECT_MOVE', message: 'Cannot move task to a state from a different project' }
        }, 400);
      }
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

    // Trigger GitHub reverse sync for state change
    triggerGitHubSync(taskId, {
      stateId: data.stateId,
    });

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

  // Close linked GitHub issue (fire-and-forget — must not block or fail the
  // delete response). The task is soft-deleted, so the external link remains
  // resolvable for this background call.
  githubReverseSync.closeGitHubIssue(taskId).catch((error: unknown) => {
    console.error('GitHub issue close error:', error);
  });

  const result = await taskService.delete(taskId, user.id);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  // Publish WebSocket event
  publishEvent(project!.workspaceId, 'task:deleted', { id: taskId, projectId: taskResult.value.projectId });

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

// === GitHub links ===

// Create a GitHub issue from an existing task
tasks.post(
  '/:taskId/github-issue',
  zValidator('json', GitHubRepoRefSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const taskId = c.req.param('taskId');
    const { owner, repo } = c.req.valid('json');

    const taskResult = await taskService.getById(taskId);
    if (!taskResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
    }
    const { allowed } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    try {
      const issue = await taskGitHubLinkService.createIssueForTask({
        taskId,
        projectId: taskResult.value.projectId,
        owner,
        repo,
      });
      return c.json({ success: true, data: issue }, 201);
    } catch (error) {
      const { body, status } = githubLinkErrorResponse(error);
      return c.json(body, status);
    }
  }
);

// Link an existing GitHub issue to a task
tasks.post(
  '/:taskId/github-issue/link',
  zValidator('json', LinkTaskGitHubIssueSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const taskId = c.req.param('taskId');
    const { owner, repo, issueNumber } = c.req.valid('json');

    const taskResult = await taskService.getById(taskId);
    if (!taskResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
    }
    const { allowed } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    try {
      const issue = await taskGitHubLinkService.linkIssue({
        taskId,
        projectId: taskResult.value.projectId,
        owner,
        repo,
        issueNumber,
      });
      return c.json({ success: true, data: issue }, 201);
    } catch (error) {
      const { body, status } = githubLinkErrorResponse(error);
      return c.json(body, status);
    }
  }
);

// Link an existing GitHub pull request to a task
tasks.post(
  '/:taskId/github-pr',
  zValidator('json', LinkTaskGitHubPrSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const taskId = c.req.param('taskId');
    const { owner, repo, prNumber } = c.req.valid('json');

    const taskResult = await taskService.getById(taskId);
    if (!taskResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
    }
    const { allowed, project } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:update');
    if (!allowed || !project) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    try {
      const linkResult = await taskGitHubLinkService.linkPr({
        taskId,
        projectId: taskResult.value.projectId,
        owner,
        repo,
        prNumber,
      });
      const updatedTask = await taskService.getById(taskId);
      if (updatedTask.ok) {
        publishEvent(project.workspaceId, 'task:updated', updatedTask.value);
      }
      return c.json({ success: true, data: linkResult }, 201);
    } catch (error) {
      const { body, status } = githubLinkErrorResponse(error);
      return c.json(body, status);
    }
  }
);

export { tasks as taskRoutes };
