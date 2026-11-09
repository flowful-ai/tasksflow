import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase } from '../db/index.js';
import { ProjectService } from '../domain/index.js';
import { hasPermission } from '../auth/index.js';
import {
  CreateProjectSchema,
  UpdateProjectSchema,
  CreateTaskStateSchema,
  CreateLabelSchema,
  REALTIME_EVENTS,
} from '@flowtask/shared';
import { requireProject, requireWorkspace } from '../lib/authorize.js';
import { fromResult, handleRouteError } from '../lib/responses.js';
import { notifyAccessChanged, publishEvent } from '../sse/manager.js';

const projects = new Hono();
projects.onError(handleRouteError);

const db = getDatabase();
const projectService = new ProjectService(db);

const StateOrLabelUpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  color: z.string().max(32).optional(),
});

function publishProjectUpdated(workspaceId: string, projectId: string): void {
  publishEvent(workspaceId, REALTIME_EVENTS.PROJECT_UPDATED, { id: projectId, projectId }, { projectId });
}

// List projects in workspace (filtered by the project ACL)
projects.get('/', async (c) => {
  const { workspaceId, role, user } = await requireWorkspace(c, c.req.query('workspaceId'), 'project:read');

  const list = fromResult(
    await projectService.list({
      filters: {
        workspaceId,
        includeArchived: c.req.query('includeArchived') === 'true',
        search: c.req.query('search'),
        userId: user.id,
        workspaceRole: role,
      },
    }),
    { code: 'LIST_FAILED', message: 'Failed to list projects' }
  );

  return c.json({ success: true, data: list });
});

// Create project
projects.post('/', zValidator('json', CreateProjectSchema.extend({ workspaceId: z.string().uuid() })), async (c) => {
  const data = c.req.valid('json');
  const { workspaceId, user } = await requireWorkspace(c, data.workspaceId, 'project:create');

  const project = fromResult(await projectService.create({ ...data, workspaceId, createdBy: user.id }), {
    status: 400,
    code: 'CREATE_FAILED',
    message: 'Failed to create project',
  });

  notifyAccessChanged(workspaceId);
  return c.json({ success: true, data: project }, 201);
});

// Get project by ID
projects.get('/:projectId', async (c) => {
  const { project } = await requireProject(c, c.req.param('projectId'), 'project:read');
  const full = fromResult(await projectService.getById(project.id), {
    code: 'FETCH_FAILED',
    message: 'Failed to load project',
  });
  return c.json({ success: true, data: full });
});

// Get project permissions for current user
projects.get('/:projectId/permissions', async (c) => {
  const { role } = await requireProject(c, c.req.param('projectId'), 'project:read');
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
projects.patch('/:projectId', zValidator('json', UpdateProjectSchema), async (c) => {
  const { project, workspaceId, user } = await requireProject(c, c.req.param('projectId'), 'project:update');
  const data = c.req.valid('json');

  const updated = fromResult(await projectService.update(project.id, { ...data, updatedBy: user.id }), {
    status: 400,
    code: 'UPDATE_FAILED',
    message: 'Failed to update project',
  });

  publishProjectUpdated(workspaceId, project.id);
  return c.json({ success: true, data: updated });
});

// Delete project
projects.delete('/:projectId', async (c) => {
  const { project, workspaceId } = await requireProject(c, c.req.param('projectId'), 'project:delete');
  fromResult(await projectService.delete(project.id), { code: 'DELETE_FAILED', message: 'Failed to delete project' });

  publishProjectUpdated(workspaceId, project.id);
  notifyAccessChanged(workspaceId);
  return c.json({ success: true, data: null });
});

// === Task States ===

projects.get('/:projectId/states', async (c) => {
  const { project } = await requireProject(c, c.req.param('projectId'), 'project:read');
  const full = fromResult(await projectService.getById(project.id), {
    code: 'FETCH_FAILED',
    message: 'Failed to load task states',
  });
  return c.json({ success: true, data: full.taskStates });
});

projects.post('/:projectId/states', zValidator('json', CreateTaskStateSchema), async (c) => {
  const { project, workspaceId } = await requireProject(c, c.req.param('projectId'), 'project:update');
  const data = c.req.valid('json');

  const state = fromResult(await projectService.createTaskState({ ...data, projectId: project.id }), {
    status: 400,
    code: 'CREATE_FAILED',
    message: 'Failed to create task state',
  });

  publishProjectUpdated(workspaceId, project.id);
  return c.json({ success: true, data: state }, 201);
});

projects.patch('/:projectId/states/:stateId', zValidator('json', StateOrLabelUpdateSchema), async (c) => {
  const { project, workspaceId } = await requireProject(c, c.req.param('projectId'), 'project:update');
  const data = c.req.valid('json');

  const state = fromResult(await projectService.updateTaskState(project.id, c.req.param('stateId'), data), {
    status: 400,
    code: 'UPDATE_FAILED',
    message: 'Failed to update task state',
  });

  publishProjectUpdated(workspaceId, project.id);
  return c.json({ success: true, data: state });
});

projects.delete('/:projectId/states/:stateId', async (c) => {
  const { project, workspaceId } = await requireProject(c, c.req.param('projectId'), 'project:update');

  fromResult(await projectService.deleteTaskState(project.id, c.req.param('stateId')), {
    status: 400,
    code: 'DELETE_FAILED',
    message: 'Failed to delete task state',
  });

  publishProjectUpdated(workspaceId, project.id);
  return c.json({ success: true, data: null });
});

// === Labels ===

projects.post('/:projectId/labels', zValidator('json', CreateLabelSchema), async (c) => {
  const { project, workspaceId } = await requireProject(c, c.req.param('projectId'), 'project:update');
  const data = c.req.valid('json');

  const label = fromResult(await projectService.createLabel({ ...data, projectId: project.id }), {
    status: 400,
    code: 'CREATE_FAILED',
    message: 'Failed to create label',
  });

  publishProjectUpdated(workspaceId, project.id);
  return c.json({ success: true, data: label }, 201);
});

projects.patch('/:projectId/labels/:labelId', zValidator('json', StateOrLabelUpdateSchema), async (c) => {
  const { project, workspaceId } = await requireProject(c, c.req.param('projectId'), 'project:update');
  const data = c.req.valid('json');

  const label = fromResult(await projectService.updateLabel(project.id, c.req.param('labelId'), data), {
    status: 400,
    code: 'UPDATE_FAILED',
    message: 'Failed to update label',
  });

  publishProjectUpdated(workspaceId, project.id);
  return c.json({ success: true, data: label });
});

projects.delete('/:projectId/labels/:labelId', async (c) => {
  const { project, workspaceId } = await requireProject(c, c.req.param('projectId'), 'project:update');

  fromResult(await projectService.deleteLabel(project.id, c.req.param('labelId')), {
    status: 400,
    code: 'DELETE_FAILED',
    message: 'Failed to delete label',
  });

  publishProjectUpdated(workspaceId, project.id);
  return c.json({ success: true, data: null });
});

// === Access Control ===

projects.get('/:projectId/members', async (c) => {
  const { project } = await requireProject(c, c.req.param('projectId'), 'project:read');
  const members = fromResult(await projectService.getMembers(project.id), {
    code: 'FETCH_FAILED',
    message: 'Failed to load project members',
  });
  return c.json({ success: true, data: members });
});

// Set project access mode and members
projects.put(
  '/:projectId/members',
  zValidator(
    'json',
    z.object({
      access: z.enum(['all', 'admin', 'members']),
      userIds: z.array(z.string().uuid()).max(1000).optional(),
    })
  ),
  async (c) => {
    const { project, workspaceId } = await requireProject(c, c.req.param('projectId'), 'project:update');
    const data = c.req.valid('json');

    fromResult(await projectService.setAccess(project.id, data.access, data.userIds), {
      status: 400,
      code: 'UPDATE_FAILED',
      message: 'Failed to update project access',
    });

    // Realtime streams cache each client's accessible projects; refresh them.
    notifyAccessChanged(workspaceId);
    publishProjectUpdated(workspaceId, project.id);
    return c.json({ success: true, data: null });
  }
);

export { projects as projectRoutes };
