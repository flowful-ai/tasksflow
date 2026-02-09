import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { BulkCreateTasksInputSchema } from '@flowtask/shared';
import { getDatabase } from '@flowtask/database';
import { TaskService, ProjectService, CommentService, SmartViewService, WorkspaceService } from '@flowtask/domain';
import { extractBearerToken } from '@flowtask/auth';
import { AGENT_TOOLS } from '@flowtask/domain';
import { publishEvent } from '../sse/manager.js';
import { McpOAuthService, OAuthError, type OAuthMcpAuthContext } from '../services/mcp-oauth-service.js';

/**
 * MCP (Model Context Protocol) endpoints for AI agent tool execution.
 * These endpoints require OAuth access tokens.
 */

const mcp = new Hono();
const db = getDatabase();

const taskService = new TaskService(db);
const projectService = new ProjectService(db);
const commentService = new CommentService(db);
const smartViewService = new SmartViewService(db);
const workspaceService = new WorkspaceService(db);
const oauthService = new McpOAuthService();

function getBaseUrl(requestUrl: string, headers: Headers): string {
  const url = new URL(requestUrl);
  const forwardedProto = headers.get('x-forwarded-proto');
  const forwardedHost = headers.get('x-forwarded-host');
  const protocol = forwardedProto || url.protocol.replace(':', '');
  const host = forwardedHost || url.host;
  return `${protocol}://${host}`;
}

function setOAuthChallenge(c: any): void {
  const baseUrl = getBaseUrl(c.req.url, c.req.raw.headers);
  c.header('WWW-Authenticate', oauthService.buildWwwAuthenticateHeader(baseUrl));
}

async function mcpAuthMiddleware(ctx: any, next: () => Promise<void>) {
  const authHeader = ctx.req.header('Authorization');
  const bearerToken = extractBearerToken(authHeader);
  if (!bearerToken) {
    setOAuthChallenge(ctx);
    return ctx.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'OAuth bearer token required' } }, 401);
  }

  try {
    const oauthAuth = await oauthService.authenticateAccessToken(bearerToken);
    const roleResult = await workspaceService.getMemberRole(oauthAuth.workspaceId, oauthAuth.userId);
    const role = roleResult.ok ? roleResult.value : null;
    oauthService.ensureAdminRole(role);
    ctx.set('oauthAuth', oauthAuth);
    return next();
  } catch (error) {
    setOAuthChallenge(ctx);
    if (error instanceof OAuthError) {
      return ctx.json({ success: false, error: { code: error.oauthError.toUpperCase(), message: error.message } }, error.statusCode as 401 | 403);
    }
    return ctx.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Invalid OAuth access token' } }, 401);
  }
}

/**
 * Helper to check if token auth can access a project.
 * For workspace-scoped tokens with optional project restrictions.
 */
async function canTokenAccessProject(tokenAuth: OAuthMcpAuthContext, projectId: string): Promise<boolean> {
  // Get project to check its workspace
  const projectResult = await projectService.getById(projectId);
  if (!projectResult.ok) {
    return false;
  }

  // Must be in agent's workspace
  if (projectResult.value.workspaceId !== tokenAuth.workspaceId) {
    return false;
  }

  return true;
}

// List available tools
mcp.get('/tools', async (c) => {
  return c.json({
    success: true,
    data: AGENT_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
      annotations: tool.annotations,
    })),
  });
});

// Execute a tool
mcp.post(
  '/tools/:toolName/execute',
  mcpAuthMiddleware,
  zValidator(
    'json',
    z.object({
      arguments: z.record(z.unknown()),
    })
  ),
  async (c) => {
    const toolName = c.req.param('toolName');
    const { arguments: args } = c.req.valid('json');

    const oauthAuth = (c as any).get('oauthAuth') as OAuthMcpAuthContext;

    oauthService.ensureToolAllowed(oauthAuth, toolName);

    // Find the tool definition
    const tool = AGENT_TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      return c.json({ success: false, error: { code: 'UNKNOWN_TOOL', message: `Tool "${toolName}" not found` } }, 404);
    }

    try {
      let result: unknown;

      switch (toolName) {
        case 'create_task': {
          const projectId = args.projectId as string;
          if (!projectId) {
            throw new Error('projectId is required');
          }

          const canAccess = await canTokenAccessProject(oauthAuth, projectId);
          if (!canAccess) {
            return c.json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'OAuth token cannot access this project' },
            }, 403);
          }

          const createResult = await taskService.create({
            projectId,
            title: args.title as string,
            description: args.description as string | undefined,
            priority: args.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none' | undefined,
            stateId: args.stateId as string | undefined,
            createdBy: oauthAuth.userId,
            agentId: null,
          });

          if (!createResult.ok) throw createResult.error;
          result = createResult.value;

          // Publish SSE event for real-time UI updates
          const projectInfo = await projectService.getById(projectId);
          if (projectInfo.ok) {
            publishEvent(projectInfo.value.workspaceId, 'task.created', {
              task: createResult.value,
              projectId,
            });
          }
          break;
        }

        case 'bulk_create_tasks': {
          const parsed = BulkCreateTasksInputSchema.parse(args);
          const { projectId, tasks } = parsed;

          const canAccess = await canTokenAccessProject(oauthAuth, projectId);
          if (!canAccess) {
            return c.json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'OAuth token cannot access this project' },
            }, 403);
          }

          const projectInfo = await projectService.getById(projectId);
          const results: Array<{ index: number; ok: boolean; task?: unknown; error?: string }> = [];
          let created = 0;

          for (const [index, taskInput] of tasks.entries()) {
            const createResult = await taskService.create({
              projectId,
              title: taskInput.title,
              description: taskInput.description,
              priority: taskInput.priority,
              stateId: taskInput.stateId,
              createdBy: oauthAuth.userId,
              agentId: null,
            });

            if (!createResult.ok) {
              results.push({
                index,
                ok: false,
                error: createResult.error.message,
              });
              continue;
            }

            created += 1;
            results.push({
              index,
              ok: true,
              task: createResult.value,
            });

            if (projectInfo.ok) {
              publishEvent(projectInfo.value.workspaceId, 'task.created', {
                task: createResult.value,
                projectId,
              });
            }
          }

          result = {
            projectId,
            summary: {
              requested: tasks.length,
              created,
              failed: tasks.length - created,
            },
            results,
          };
          break;
        }

        case 'update_task': {
          const taskId = args.taskId as string;
          if (!taskId) {
            throw new Error('taskId is required');
          }

          const taskResult = await taskService.getById(taskId);
          if (!taskResult.ok) throw taskResult.error;
          const canAccess = await canTokenAccessProject(oauthAuth, taskResult.value.projectId);
          if (!canAccess) {
            return c.json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'OAuth token cannot access this project' },
            }, 403);
          }

          const updateResult = await taskService.update(taskId, {
            title: args.title as string | undefined,
            description: args.description as string | undefined,
            priority: args.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none' | undefined,
            stateId: args.stateId as string | undefined,
            updatedBy: oauthAuth.userId,
          });

          if (!updateResult.ok) throw updateResult.error;
          result = updateResult.value;
          break;
        }

        case 'delete_task': {
          const taskId = args.taskId as string;
          if (!taskId) {
            throw new Error('taskId is required');
          }

          const taskResult = await taskService.getById(taskId);
          if (!taskResult.ok) throw taskResult.error;
          const canAccess = await canTokenAccessProject(oauthAuth, taskResult.value.projectId);
          if (!canAccess) {
            return c.json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'OAuth token cannot access this project' },
            }, 403);
          }

          const deleteResult = await taskService.delete(taskId, oauthAuth.userId);
          if (!deleteResult.ok) throw deleteResult.error;
          result = { deleted: true, taskId };
          break;
        }

        case 'query_tasks': {
          let projectId = args.projectId as string | undefined;

          if (projectId) {
            const canAccess = await canTokenAccessProject(oauthAuth, projectId);
            if (!canAccess) {
              return c.json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'OAuth token cannot access this project' },
              }, 403);
            }
          }

          const queryResult = await taskService.list({
            filters: {
              projectId,
              stateId: args.stateId as string | undefined,
              priority: args.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none' | undefined,
              assigneeId: args.assigneeId as string | undefined,
              search: args.search as string | undefined,
            },
            limit: parseInt(args.limit as string || '20', 10),
          });

          if (!queryResult.ok) throw queryResult.error;
          result = queryResult.value;
          break;
        }

        case 'move_task': {
          const taskId = args.taskId as string;
          const stateId = args.stateId as string;
          if (!taskId || !stateId) {
            throw new Error('taskId and stateId are required');
          }

          const taskResult = await taskService.getById(taskId);
          if (!taskResult.ok) throw taskResult.error;
          const canAccess = await canTokenAccessProject(oauthAuth, taskResult.value.projectId);
          if (!canAccess) {
            return c.json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'OAuth token cannot access this project' },
            }, 403);
          }

          // Get current task to calculate position
          const currentTask = await taskService.getById(taskId);
          if (!currentTask.ok) throw currentTask.error;

          const position = taskService.calculatePositionBetween(null, null);

          const moveResult = await taskService.move(taskId, {
            stateId,
            position,
            movedBy: oauthAuth.userId,
          });

          if (!moveResult.ok) throw moveResult.error;
          result = moveResult.value;
          break;
        }

        case 'assign_task': {
          const taskId = args.taskId as string;
          const userId = args.userId as string;
          const action = args.action as 'assign' | 'unassign';

          if (!taskId || !userId || !action) {
            throw new Error('taskId, userId, and action are required');
          }

          const taskResult = await taskService.getById(taskId);
          if (!taskResult.ok) throw taskResult.error;
          const canAccess = await canTokenAccessProject(oauthAuth, taskResult.value.projectId);
          if (!canAccess) {
            return c.json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'OAuth token cannot access this project' },
            }, 403);
          }

          if (action === 'assign') {
            const assignResult = await taskService.addAssignee(taskId, userId, oauthAuth.userId);
            if (!assignResult.ok) throw assignResult.error;
          } else {
            const unassignResult = await taskService.removeAssignee(taskId, userId, oauthAuth.userId);
            if (!unassignResult.ok) throw unassignResult.error;
          }

          const updatedTask = await taskService.getById(taskId);
          if (!updatedTask.ok) throw updatedTask.error;
          result = updatedTask.value;
          break;
        }

        case 'add_comment': {
          const taskId = args.taskId as string;
          const content = args.content as string;

          if (!taskId || !content) {
            throw new Error('taskId and content are required');
          }

          let taskProjectId: string | undefined;
          const taskResult = await taskService.getById(taskId);
          if (!taskResult.ok) throw taskResult.error;
          taskProjectId = taskResult.value.projectId;
          const canAccess = await canTokenAccessProject(oauthAuth, taskProjectId);
          if (!canAccess) {
            return c.json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'OAuth token cannot access this project' },
            }, 403);
          }

          const commentResult = await commentService.create({
            taskId,
            content,
            userId: oauthAuth.userId,
            agentId: null,
          });

          if (!commentResult.ok) throw commentResult.error;
          result = commentResult.value;

          // Publish SSE event for real-time UI updates
          if (taskProjectId) {
            const projectInfo = await projectService.getById(taskProjectId);
            if (projectInfo.ok) {
              publishEvent(projectInfo.value.workspaceId, 'comment.created', {
                comment: commentResult.value,
                taskId,
                projectId: taskProjectId,
              });
            }
          }
          break;
        }

        case 'summarize_project': {
          const projectId = args.projectId as string;
          if (!projectId) {
            throw new Error('projectId is required');
          }

          const canAccess = await canTokenAccessProject(oauthAuth, projectId);
          if (!canAccess) {
            return c.json({
              success: false,
              error: { code: 'FORBIDDEN', message: 'OAuth token cannot access this project' },
            }, 403);
          }

          const projectResult = await projectService.getById(projectId);
          if (!projectResult.ok) throw projectResult.error;

          const tasksResult = await taskService.list({
            filters: { projectId },
            limit: 1000,
          });

          if (!tasksResult.ok) throw tasksResult.error;

          // Calculate statistics
          const tasks = tasksResult.value.tasks;
          const byState = new Map<string, number>();
          const byPriority = new Map<string, number>();

          // Initialize all states with 0 count so empty states are included
          const allStates = projectResult.value.taskStates;
          for (const state of allStates) {
            byState.set(state.name, 0);
          }

          for (const task of tasks) {
            const stateName = task.state?.name || 'No State';
            byState.set(stateName, (byState.get(stateName) || 0) + 1);

            const priority = task.priority || 'none';
            byPriority.set(priority, (byPriority.get(priority) || 0) + 1);
          }

          result = {
            project: {
              id: projectResult.value.id,
              name: projectResult.value.name,
              identifier: projectResult.value.identifier,
            },
            states: projectResult.value.taskStates.map((s) => ({
              id: s.id,
              name: s.name,
              category: s.category,
            })),
            statistics: {
              totalTasks: tasks.length,
              byState: Object.fromEntries(byState),
              byPriority: Object.fromEntries(byPriority),
            },
          };
          break;
        }

        case 'create_smart_view': {
          const name = args.name as string;
          if (!name) {
            throw new Error('name is required');
          }

          const filters = args.filters as string | undefined;
          let parsedFilters;
          if (filters) {
            try {
              parsedFilters = JSON.parse(filters);
            } catch {
              throw new Error('Invalid filters JSON');
            }
          }

          const smartViewResult = await smartViewService.create({
            workspaceId: oauthAuth.workspaceId,
            createdBy: oauthAuth.userId,
            name,
            description: args.description as string | undefined,
            filters: parsedFilters,
          });

          if (!smartViewResult.ok) throw smartViewResult.error;
          result = smartViewResult.value;
          break;
        }

        case 'search_tasks': {
          const query = args.query as string;
          if (!query) {
            throw new Error('query is required');
          }

          let projectId = args.projectId as string | undefined;
          if (projectId) {
            const canAccess = await canTokenAccessProject(oauthAuth, projectId);
            if (!canAccess) {
              return c.json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'OAuth token cannot access this project' },
              }, 403);
            }
          }

          const searchResult = await taskService.list({
            filters: {
              projectId,
              search: query,
            },
            limit: parseInt(args.limit as string || '20', 10),
          });

          if (!searchResult.ok) throw searchResult.error;
          result = searchResult.value;
          break;
        }

        case 'list_projects': {
          const projectsResult = await projectService.list({
            filters: { workspaceId: oauthAuth.workspaceId },
          });
          if (!projectsResult.ok) throw projectsResult.error;

          result = projectsResult.value.map((p) => ({
            id: p.id,
            name: p.name,
            identifier: p.identifier,
            states: p.taskStates.map((s) => ({
              id: s.id,
              name: s.name,
              category: s.category,
            })),
          }));
          break;
        }

        default:
          throw new Error(`Tool "${toolName}" not implemented`);
      }

      return c.json({ success: true, data: result });
    } catch (error) {
      if (error instanceof OAuthError) {
        if (error.statusCode === 401) {
          setOAuthChallenge(c);
        }
        return c.json({
          success: false,
          error: {
            code: error.oauthError.toUpperCase(),
            message: error.message,
          },
        }, error.statusCode as 400 | 401 | 403);
      }

      return c.json({
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: process.env.NODE_ENV === 'production' ? 'Tool execution failed' : (error instanceof Error ? error.message : 'Unknown error'),
        },
      }, 400);
    }
  }
);

export { mcp as mcpRoutes };
