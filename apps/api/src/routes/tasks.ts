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
} from '@flowtask/shared';
import { hasPermission } from '@flowtask/auth';
import { publishEvent } from '../sse/manager.js';
import { GitHubReverseSyncService, createGitHubClientForInstallation } from '@flowtask/integrations';
import { and, eq } from 'drizzle-orm';
import { TaskGitHubLinkError, TaskGitHubLinkService } from '../services/task-github-link-service.js';

const tasks = new Hono();
const db = getDatabase();
const taskService = new TaskService(db);
const projectService = new ProjectService(db);
const workspaceService = new WorkspaceService(db);
const githubReverseSync = new GitHubReverseSyncService(db);
const taskGitHubLinkService = new TaskGitHubLinkService(db);

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

// GitHub integration config type
interface GitHubIntegrationConfig {
  installationId?: number;
  repositories?: Array<{
    owner: string;
    repo: string;
    installationId?: number;
    linkedAt: string;
    lastSyncAt: string | null;
    syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
    syncError: string | null;
  }>;
}

function getInstallationIdForRepo(
  config: GitHubIntegrationConfig,
  owner: string,
  repo: string
): number | null {
  const repoEntry = config.repositories?.find(
    (r) => r.owner === owner && r.repo === repo
  );
  return repoEntry?.installationId ?? config.installationId ?? null;
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

    // Optionally create GitHub issue (non-blocking)
    let githubResult: { url: string; number: number } | null = null;
    if (data.createOnGitHub && data.githubRepo) {
      try {
        // 1. Get GitHub integration for project
        const [integration] = await db
          .select()
          .from(projectIntegrations)
          .where(and(
            eq(projectIntegrations.projectId, data.projectId),
            eq(projectIntegrations.integrationType, 'github'),
            eq(projectIntegrations.isEnabled, true)
          ));

        if (integration) {
          const config = integration.config as GitHubIntegrationConfig;

          const installationId = getInstallationIdForRepo(
            config,
            data.githubRepo.owner,
            data.githubRepo.repo
          );

          if (installationId) {
            // 2. Create GitHub client
            const client = await createGitHubClientForInstallation(
              installationId,
              { owner: data.githubRepo.owner, repo: data.githubRepo.repo }
            );

            // 3. Create issue
            const issue = await client.createIssue({
              title: data.title,
              body: data.description || '',
            });

            // 4. Create external link
            await db.insert(externalLinks).values({
              integrationId: integration.id,
              taskId: result.value.id,
              externalType: 'github_issue',
              externalId: issue.number.toString(),
              externalUrl: issue.html_url,
              lastSyncedAt: new Date(),
            });

            githubResult = { url: issue.html_url, number: issue.number };
          }
        }
      } catch (error) {
        console.error('Failed to create GitHub issue:', error);
        // Don't fail the request - task was created successfully
      }
    }

    return c.json({
      success: true,
      data: result.value,
      github: githubResult,
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

  // Close linked GitHub issue before deleting (fire-and-forget)
  await githubReverseSync.closeGitHubIssue(taskId).catch(() => {});

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

// === GitHub Issue Creation ===

// Create GitHub issue from existing task
tasks.post(
  '/:taskId/github-issue',
  zValidator(
    'json',
    z.object({
      owner: z.string(),
      repo: z.string(),
    })
  ),
  async (c) => {
    const user = getCurrentUser(c);
    const taskId = c.req.param('taskId');
    const { owner, repo } = c.req.valid('json');

    // 1. Get task and verify access
    const taskResult = await taskService.getById(taskId);
    if (!taskResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
    }

    const { allowed, project } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    // 2. Get GitHub integration
    const [integration] = await db
      .select()
      .from(projectIntegrations)
      .where(
        and(
          eq(projectIntegrations.projectId, taskResult.value.projectId),
          eq(projectIntegrations.integrationType, 'github'),
          eq(projectIntegrations.isEnabled, true)
        )
      );

    if (!integration) {
      return c.json({ success: false, error: { code: 'NO_INTEGRATION', message: 'GitHub not configured for this project' } }, 400);
    }

    const config = integration.config as GitHubIntegrationConfig;
    const installationId = getInstallationIdForRepo(config, owner, repo);
    if (!installationId) {
      return c.json({ success: false, error: { code: 'NO_INSTALLATION', message: 'GitHub App not installed' } }, 400);
    }

    // 3. Check task doesn't already have a linked issue
    const [existingLink] = await db
      .select()
      .from(externalLinks)
      .where(
        and(
          eq(externalLinks.taskId, taskId),
          eq(externalLinks.externalType, 'github_issue')
        )
      );

    if (existingLink) {
      return c.json({ success: false, error: { code: 'ALREADY_LINKED', message: 'Task already has a linked GitHub issue' } }, 400);
    }

    // 4. Create GitHub issue
    try {
      const client = await createGitHubClientForInstallation(installationId, { owner, repo });
      const issue = await client.createIssue({
        title: taskResult.value.title,
        body: taskResult.value.description || '',
      });

      // 5. Create external link
      await db.insert(externalLinks).values({
        integrationId: integration.id,
        taskId,
        externalType: 'github_issue',
        externalId: issue.number.toString(),
        externalUrl: issue.html_url,
        lastSyncedAt: new Date(),
      });

      // 6. Publish WebSocket event with updated task
      const updatedTask = await taskService.getById(taskId);
      if (updatedTask.ok) {
        publishEvent(project!.workspaceId, 'task:updated', updatedTask.value);
      }

      return c.json({
        success: true,
        data: { url: issue.html_url, number: issue.number },
      }, 201);
    } catch (error) {
      console.error('Failed to create GitHub issue:', error);
      return c.json({
        success: false,
        error: { code: 'GITHUB_ERROR', message: error instanceof Error ? error.message : 'Failed to create GitHub issue' },
      }, 500);
    }
  }
);

// Link an existing GitHub pull request to an existing task
tasks.post(
  '/:taskId/github-pr',
  zValidator('json', LinkTaskGitHubPrSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const taskId = c.req.param('taskId');
    const { owner, repo, prNumber } = c.req.valid('json');

    // 1. Get task and verify access
    const taskResult = await taskService.getById(taskId);
    if (!taskResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: taskResult.error.message } }, 404);
    }

    const { allowed, project } = await checkTaskAccess(taskResult.value.projectId, user.id, 'task:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    try {
      const linkResult = await taskGitHubLinkService.linkPullRequestToTask({
        taskId,
        projectId: taskResult.value.projectId,
        owner,
        repo,
        prNumber,
      });

      const updatedTask = await taskService.getById(taskId);
      if (updatedTask.ok) {
        publishEvent(project!.workspaceId, 'task:updated', updatedTask.value);
      }

      return c.json({
        success: true,
        data: linkResult,
      }, 201);
    } catch (error) {
      if (error instanceof TaskGitHubLinkError) {
        return c.json({
          success: false,
          error: { code: error.code, message: error.message },
        }, error.status);
      }

      return c.json({
        success: false,
        error: {
          code: 'GITHUB_ERROR',
          message: error instanceof Error ? error.message : 'Failed to link GitHub pull request',
        },
      }, 500);
    }
  }
);

export { tasks as taskRoutes };
