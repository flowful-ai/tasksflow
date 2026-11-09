import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase } from '@flowtask/database';
import { TaskService } from '@flowtask/domain';
import { hasPermission } from '@flowtask/auth';
import {
  CreateTaskSchema,
  UpdateTaskSchema,
  MoveTaskSchema,
  LinkTaskGitHubPrSchema,
  TaskPrioritySchema,
} from '@flowtask/shared';
import { publishEvent } from '../sse/manager.js';
import { TaskGitHubLinkError, TaskGitHubLinkService } from '../services/task-github-link-service.js';
import { GitHubRepoRefSchema, LinkTaskGitHubIssueSchema } from '@flowtask/shared';
import { VALID_TASK_SORT_BY, VALID_TASK_SORT_ORDER } from './smart-view-query-utils.js';
import { getAuthz, requireProject, requireTask, requireUser } from '../lib/authorize.js';
import { badRequest, forbidden, fromResult, handleRouteError, toAppError } from '../lib/responses.js';

// Validates and coerces task-list query params. Keeps invalid values out of the
// service layer and clamps `limit` so a client can't request an unbounded page.
// Sort vocabularies are shared with smart-view query execution so they can't drift.
const TaskListQuerySchema = z.object({
  priority: TaskPrioritySchema.optional(),
  stateId: z.string().uuid().optional(),
  assigneeId: z.string().uuid().optional(),
  labelId: z.string().uuid().optional(),
  /** A task id lists its sub-tasks; "none" lists top-level tasks only. */
  parentId: z.union([z.string().uuid(), z.literal('none')]).optional(),
  search: z.string().max(200).optional(),
  sortBy: z.enum(VALID_TASK_SORT_BY).default('position'),
  sortOrder: z.enum(VALID_TASK_SORT_ORDER).default('asc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const tasks = new Hono();
tasks.onError(handleRouteError);

const db = getDatabase();
const taskService = new TaskService(db);
const taskGitHubLinkService = new TaskGitHubLinkService(db, publishEvent);

async function assertStateInProject(stateId: string | undefined, projectId: string): Promise<void> {
  if (stateId && !(await getAuthz().stateBelongsToProject(stateId, projectId))) {
    throw badRequest('Invalid state for this project', 'INVALID_STATE');
  }
}

// List tasks
tasks.get('/', async (c) => {
  const { project } = await requireProject(c, c.req.query('projectId'), 'task:read');

  // Map present-but-empty params ("?sortBy=") to undefined so the schema
  // defaults apply instead of failing the enum/number validation.
  const parsedQuery = TaskListQuerySchema.safeParse({
    priority: c.req.query('priority') || undefined,
    stateId: c.req.query('stateId') || undefined,
    assigneeId: c.req.query('assigneeId') || undefined,
    labelId: c.req.query('labelId') || undefined,
    parentId: c.req.query('parentId') || undefined,
    search: c.req.query('search') || undefined,
    sortBy: c.req.query('sortBy') || undefined,
    sortOrder: c.req.query('sortOrder') || undefined,
    page: c.req.query('page') || undefined,
    limit: c.req.query('limit') || undefined,
  });
  if (!parsedQuery.success) {
    throw badRequest('Invalid query parameters', 'INVALID_QUERY');
  }
  const { priority, stateId, assigneeId, labelId, parentId, search, sortBy, sortOrder, page, limit } = parsedQuery.data;

  const result = fromResult(
    await taskService.list({
      filters: {
        projectId: project.id,
        stateId,
        assigneeId,
        labelId,
        ...(parentId ? { parentId: parentId === 'none' ? null : parentId } : {}),
        priority,
        search,
        includeDeleted: c.req.query('includeDeleted') === 'true',
      },
      sortBy,
      sortOrder,
      page,
      limit,
    }),
    { code: 'LIST_FAILED', message: 'Failed to list tasks' }
  );

  return c.json({
    success: true,
    data: result.tasks,
    meta: {
      total: result.total,
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
  console.error('[GITHUB_ERROR]', error);
  return { body: { success: false, error: { code: 'GITHUB_ERROR', message: 'GitHub request failed' } }, status: 500 };
}

// Create task
tasks.post(
  '/',
  zValidator(
    'json',
    CreateTaskSchema.extend({ projectId: z.string().uuid() })
  ),
  async (c) => {
    const data = c.req.valid('json');
    const { project, role, user } = await requireProject(c, data.projectId, 'task:create');
    const authz = getAuthz();

    await assertStateInProject(data.stateId, project.id);
    if (data.labelIds && !(await authz.labelsBelongToProject(data.labelIds, project.id))) {
      throw badRequest('Invalid labels for this project', 'INVALID_LABEL');
    }
    if (data.assigneeIds && data.assigneeIds.length > 0) {
      const onlySelf = data.assigneeIds.every((id) => id === user.id);
      if (!onlySelf && !hasPermission(role, 'task:assign')) {
        throw forbidden('Insufficient permissions to assign other users');
      }
      if (!(await authz.usersCanAccessProject(project, data.assigneeIds))) {
        throw badRequest('Assignees must be members with access to this project', 'INVALID_ASSIGNEE');
      }
    }

    const result = await taskService.create({
      ...data,
      createdBy: user.id,
    });

    if (!result.ok) {
      throw toAppError(result.error, { status: 400, code: 'CREATE_FAILED', message: 'Failed to create task' });
    }

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
  const { task } = await requireTask(c, c.req.param('taskId'), 'task:read', {
    includeDeleted: c.req.query('includeDeleted') === 'true',
  });
  const full = fromResult(await taskService.getById(task.id), { code: 'FETCH_FAILED', message: 'Failed to load task' });
  return c.json({ success: true, data: full });
});

// Update task
tasks.patch(
  '/:taskId',
  zValidator('json', UpdateTaskSchema),
  async (c) => {
    const { task, user } = await requireTask(c, c.req.param('taskId'), 'task:update');
    const data = c.req.valid('json');
    await assertStateInProject(data.stateId, task.projectId);

    const updated = fromResult(await taskService.update(task.id, { ...data, updatedBy: user.id }), {
      status: 400,
      code: 'UPDATE_FAILED',
      message: 'Failed to update task',
    });

    return c.json({ success: true, data: updated });
  }
);

// Move task (change state and/or position)
tasks.post(
  '/:taskId/move',
  zValidator('json', MoveTaskSchema),
  async (c) => {
    const { task, user } = await requireTask(c, c.req.param('taskId'), 'task:update');
    const data = c.req.valid('json');

    // The target state must belong to the task's project (no cross-project moves).
    if (!(await getAuthz().stateBelongsToProject(data.stateId, task.projectId))) {
      throw badRequest('Cannot move task to a state from a different project', 'CROSS_PROJECT_MOVE');
    }

    const moved = fromResult(await taskService.move(task.id, { ...data, movedBy: user.id }), {
      status: 400,
      code: 'MOVE_FAILED',
      message: 'Failed to move task',
    });

    return c.json({ success: true, data: moved });
  }
);

// Delete task (soft delete)
tasks.delete('/:taskId', async (c) => {
  const { task, user } = await requireTask(c, c.req.param('taskId'), 'task:delete');

  fromResult(await taskService.delete(task.id, user.id), {
    status: 400,
    code: 'DELETE_FAILED',
    message: 'Failed to delete task',
  });

  return c.json({ success: true, data: null });
});

// Restore task
tasks.post('/:taskId/restore', async (c) => {
  const { task, user } = await requireTask(c, c.req.param('taskId'), 'task:update', {
    includeDeleted: true,
  });

  const restored = fromResult(await taskService.restore(task.id, user.id), {
    status: 400,
    code: 'RESTORE_FAILED',
    message: 'Failed to restore task',
  });

  return c.json({ success: true, data: restored });
});

// === Assignees ===

// Add assignee
tasks.post(
  '/:taskId/assignees',
  zValidator('json', z.object({ userId: z.string().uuid() })),
  async (c) => {
    const { task, project, user } = await requireTask(c, c.req.param('taskId'), 'task:assign');
    const { userId } = c.req.valid('json');

    // Only workspace members who can see the project may be assigned; this also
    // stops responses from embedding a foreign user's profile.
    if (!(await getAuthz().userCanAccessProject(project, userId))) {
      throw badRequest('Assignee must be a member with access to this project', 'INVALID_ASSIGNEE');
    }

    fromResult(await taskService.addAssignee(task.id, userId, user.id), {
      status: 400,
      code: 'ASSIGN_FAILED',
      message: 'Failed to assign task',
    });

    return c.json({ success: true, data: null });
  }
);

// Remove assignee
tasks.delete('/:taskId/assignees/:userId', async (c) => {
  const { task, user } = await requireTask(c, c.req.param('taskId'), 'task:assign');
  const userId = c.req.param('userId');
  if (!z.string().uuid().safeParse(userId).success) {
    throw badRequest('Invalid user id', 'INVALID_ASSIGNEE');
  }

  fromResult(await taskService.removeAssignee(task.id, userId, user.id), {
    status: 400,
    code: 'UNASSIGN_FAILED',
    message: 'Failed to unassign task',
  });

  return c.json({ success: true, data: null });
});

// === Labels ===

// Add label
tasks.post(
  '/:taskId/labels',
  zValidator('json', z.object({ labelId: z.string().uuid() })),
  async (c) => {
    const { task, user } = await requireTask(c, c.req.param('taskId'), 'task:update');
    const { labelId } = c.req.valid('json');

    if (!(await getAuthz().labelsBelongToProject([labelId], task.projectId))) {
      throw badRequest('Invalid label for this project', 'INVALID_LABEL');
    }

    fromResult(await taskService.addLabel(task.id, labelId, user.id), {
      status: 400,
      code: 'LABEL_FAILED',
      message: 'Failed to add label',
    });

    return c.json({ success: true, data: null });
  }
);

// Remove label
tasks.delete('/:taskId/labels/:labelId', async (c) => {
  const { task, user } = await requireTask(c, c.req.param('taskId'), 'task:update');
  const labelId = c.req.param('labelId');
  if (!z.string().uuid().safeParse(labelId).success) {
    throw badRequest('Invalid label id', 'INVALID_LABEL');
  }

  fromResult(await taskService.removeLabel(task.id, labelId, user.id), {
    status: 400,
    code: 'UNLABEL_FAILED',
    message: 'Failed to remove label',
  });

  return c.json({ success: true, data: null });
});

// === Position calculation helper ===

// Calculate position between two tasks
tasks.post(
  '/calculate-position',
  zValidator(
    'json',
    z.object({
      beforePosition: z.string().max(200).nullable().optional(),
      afterPosition: z.string().max(200).nullable().optional(),
    })
  ),
  async (c) => {
    requireUser(c);
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
    const { task } = await requireTask(c, c.req.param('taskId'), 'task:update');
    const { owner, repo } = c.req.valid('json');
    try {
      const issue = await taskGitHubLinkService.createIssueForTask({ taskId: task.id, projectId: task.projectId, owner, repo });
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
    const { task } = await requireTask(c, c.req.param('taskId'), 'task:update');
    const { owner, repo, issueNumber } = c.req.valid('json');
    try {
      const issue = await taskGitHubLinkService.linkIssue({ taskId: task.id, projectId: task.projectId, owner, repo, issueNumber });
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
    const { task } = await requireTask(c, c.req.param('taskId'), 'task:update');
    const { owner, repo, prNumber } = c.req.valid('json');
    try {
      const linkResult = await taskGitHubLinkService.linkPr({ taskId: task.id, projectId: task.projectId, owner, repo, prNumber });
      return c.json({ success: true, data: linkResult }, 201);
    } catch (error) {
      const { body, status } = githubLinkErrorResponse(error);
      return c.json(body, status);
    }
  }
);

export { tasks as taskRoutes };
