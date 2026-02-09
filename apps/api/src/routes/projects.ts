import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase } from '@flowtask/database';
import { ProjectService, WorkspaceService } from '@flowtask/domain';
import { getCurrentUser } from '@flowtask/auth';
import { CreateProjectSchema, UpdateProjectSchema, CreateTaskStateSchema, CreateLabelSchema } from '@flowtask/shared';
import { hasPermission } from '@flowtask/auth';

const projects = new Hono();
const db = getDatabase();
const projectService = new ProjectService(db);
const workspaceService = new WorkspaceService(db);

// Helper to check workspace access
async function checkWorkspaceAccess(workspaceId: string, userId: string, permission: string) {
  const roleResult = await workspaceService.getMemberRole(workspaceId, userId);
  if (!roleResult.ok || !roleResult.value) {
    return { allowed: false, role: null };
  }
  return {
    allowed: hasPermission(roleResult.value, permission as any),
    role: roleResult.value,
  };
}

// List projects in workspace
projects.get('/', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.query('workspaceId');

  if (!workspaceId) {
    return c.json({ success: false, error: { code: 'MISSING_PARAM', message: 'workspaceId is required' } }, 400);
  }

  const { allowed } = await checkWorkspaceAccess(workspaceId, user.id, 'project:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await projectService.list({
    filters: {
      workspaceId,
      includeArchived: c.req.query('includeArchived') === 'true',
      search: c.req.query('search'),
    },
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
  }

  return c.json({ success: true, data: result.value });
});

// Create project
projects.post(
  '/',
  zValidator(
    'json',
    CreateProjectSchema.extend({ workspaceId: z.string().uuid() })
  ),
  async (c) => {
    const user = getCurrentUser(c);
    const data = c.req.valid('json');

    const { allowed } = await checkWorkspaceAccess(data.workspaceId, user.id, 'project:create');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await projectService.create({
      ...data,
      createdBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value }, 201);
  }
);

// Get project by ID
projects.get('/:projectId', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');

  const result = await projectService.getById(projectId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(result.value.workspaceId, user.id, 'project:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  return c.json({ success: true, data: result.value });
});

// Get project permissions for current user
projects.get('/:projectId/permissions', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');

  const result = await projectService.getById(projectId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
  }

  const roleResult = await workspaceService.getMemberRole(result.value.workspaceId, user.id);
  if (!roleResult.ok || !roleResult.value) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const role = roleResult.value;
  return c.json({
    success: true,
    data: {
      role,
      canEdit: hasPermission(role, 'project:update'),
      canDelete: hasPermission(role, 'project:delete'),
    },
  });
});

// Update project
projects.patch(
  '/:projectId',
  zValidator('json', UpdateProjectSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const projectId = c.req.param('projectId');
    const data = c.req.valid('json');

    // Get project to check workspace
    const projectResult = await projectService.getById(projectId);
    if (!projectResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: projectResult.error.message } }, 404);
    }

    const { allowed } = await checkWorkspaceAccess(projectResult.value.workspaceId, user.id, 'project:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await projectService.update(projectId, {
      ...data,
      updatedBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value });
  }
);

// Delete project
projects.delete('/:projectId', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');

  // Get project to check workspace
  const projectResult = await projectService.getById(projectId);
  if (!projectResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: projectResult.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(projectResult.value.workspaceId, user.id, 'project:delete');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await projectService.delete(projectId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

// === Task States ===

// Get task states for a project
projects.get('/:projectId/states', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');

  const projectResult = await projectService.getById(projectId);
  if (!projectResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: projectResult.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(projectResult.value.workspaceId, user.id, 'project:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  return c.json({ success: true, data: projectResult.value.taskStates || [] });
});

// Create task state
projects.post(
  '/:projectId/states',
  zValidator('json', CreateTaskStateSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const projectId = c.req.param('projectId');
    const data = c.req.valid('json');

    // Get project to check workspace
    const projectResult = await projectService.getById(projectId);
    if (!projectResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: projectResult.error.message } }, 404);
    }

    const { allowed } = await checkWorkspaceAccess(projectResult.value.workspaceId, user.id, 'project:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await projectService.createTaskState({
      ...data,
      projectId,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value }, 201);
  }
);

// Update task state
projects.patch(
  '/:projectId/states/:stateId',
  zValidator('json', z.object({ name: z.string().optional(), color: z.string().optional() })),
  async (c) => {
    const user = getCurrentUser(c);
    const projectId = c.req.param('projectId');
    const stateId = c.req.param('stateId');
    const data = c.req.valid('json');

    // Get project to check workspace
    const projectResult = await projectService.getById(projectId);
    if (!projectResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: projectResult.error.message } }, 404);
    }

    const { allowed } = await checkWorkspaceAccess(projectResult.value.workspaceId, user.id, 'project:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await projectService.updateTaskState(stateId, data);

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value });
  }
);

// Delete task state
projects.delete('/:projectId/states/:stateId', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');
  const stateId = c.req.param('stateId');

  // Get project to check workspace
  const projectResult = await projectService.getById(projectId);
  if (!projectResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: projectResult.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(projectResult.value.workspaceId, user.id, 'project:update');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await projectService.deleteTaskState(stateId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

// === Labels ===

// Create label
projects.post(
  '/:projectId/labels',
  zValidator('json', CreateLabelSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const projectId = c.req.param('projectId');
    const data = c.req.valid('json');

    // Get project to check workspace
    const projectResult = await projectService.getById(projectId);
    if (!projectResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: projectResult.error.message } }, 404);
    }

    const { allowed } = await checkWorkspaceAccess(projectResult.value.workspaceId, user.id, 'project:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await projectService.createLabel({
      ...data,
      projectId,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value }, 201);
  }
);

// Update label
projects.patch(
  '/:projectId/labels/:labelId',
  zValidator('json', z.object({ name: z.string().optional(), color: z.string().optional() })),
  async (c) => {
    const user = getCurrentUser(c);
    const projectId = c.req.param('projectId');
    const labelId = c.req.param('labelId');
    const data = c.req.valid('json');

    // Get project to check workspace
    const projectResult = await projectService.getById(projectId);
    if (!projectResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: projectResult.error.message } }, 404);
    }

    const { allowed } = await checkWorkspaceAccess(projectResult.value.workspaceId, user.id, 'project:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await projectService.updateLabel(labelId, data);

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value });
  }
);

// Delete label
projects.delete('/:projectId/labels/:labelId', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');
  const labelId = c.req.param('labelId');

  // Get project to check workspace
  const projectResult = await projectService.getById(projectId);
  if (!projectResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: projectResult.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(projectResult.value.workspaceId, user.id, 'project:update');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await projectService.deleteLabel(labelId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

export { projects as projectRoutes };
