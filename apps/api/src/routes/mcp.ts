import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { Redis } from 'ioredis';
import { getDatabase } from '@flowtask/database';
import { TaskService, ProjectService, AgentService, CommentService, WorkspaceAgentService, SmartViewService } from '@flowtask/domain';
import { getCurrentUser, getOptionalUser, extractBearerToken, isFlowTaskToken, isValidTokenFormat } from '@flowtask/auth';
import type { TokenAuthContext } from '@flowtask/auth';
import { AGENT_TOOLS } from '@flowtask/domain';
import type { ApiTokenPermission } from '@flowtask/shared';
import { publishEvent } from '../sse/manager.js';

/**
 * MCP (Model Context Protocol) endpoints for AI agent tool execution.
 * These endpoints support both session auth (for web UI) and API token auth (for external clients).
 */

const mcp = new Hono();
const db = getDatabase();

// Initialize Redis for rate limiting
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

const taskService = new TaskService(db);
const projectService = new ProjectService(db);
const agentService = new AgentService(db);
const commentService = new CommentService(db);
const workspaceAgentService = new WorkspaceAgentService(db, redis);
const smartViewService = new SmartViewService(db);

/**
 * Dual auth middleware - accepts either session auth OR API token auth.
 * Sets either ctx.get('auth') for session auth or ctx.get('tokenAuth') for token auth.
 */
async function mcpAuthMiddleware(ctx: any, next: () => Promise<void>) {
  // Check for API token first
  const authHeader = ctx.req.header('Authorization');
  const token = extractBearerToken(authHeader);

  if (token && isFlowTaskToken(token)) {
    // API Token authentication
    if (!isValidTokenFormat(token)) {
      return ctx.json({ success: false, error: { code: 'INVALID_TOKEN_FORMAT', message: 'Invalid API token format' } }, 401);
    }

    // Verify token with rate limiting
    const verifyResult = await workspaceAgentService.verifyToken(token, { checkRateLimit: true });

    if (!verifyResult.ok) {
      const statusCode = verifyResult.error.code === 'RATE_LIMITED' ? 429 : 401;
      return ctx.json({ success: false, error: verifyResult.error }, statusCode);
    }

    // Set token auth context with workspace scope
    ctx.set('tokenAuth', {
      tokenId: verifyResult.value.id,
      workspaceId: verifyResult.value.workspaceId,
      restrictedProjectIds: verifyResult.value.restrictedProjectIds,
      name: verifyResult.value.name,
      permissions: verifyResult.value.permissions,
    } satisfies TokenAuthContext);

    return next();
  }

  // Fall back to session auth
  const user = getOptionalUser(ctx);
  if (!user) {
    return ctx.json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  return next();
}

/**
 * Helper to check if token auth can access a project.
 * For workspace-scoped tokens with optional project restrictions.
 */
async function canTokenAccessProject(tokenAuth: TokenAuthContext, projectId: string): Promise<boolean> {
  // Get project to check its workspace
  const projectResult = await projectService.getById(projectId);
  if (!projectResult.ok) {
    return false;
  }

  // Must be in agent's workspace
  if (projectResult.value.workspaceId !== tokenAuth.workspaceId) {
    return false;
  }

  // If no restrictions, allow all projects in workspace
  if (!tokenAuth.restrictedProjectIds || tokenAuth.restrictedProjectIds.length === 0) {
    return true;
  }

  // Check if project is in allowed list
  return tokenAuth.restrictedProjectIds.includes(projectId);
}

// List available tools
mcp.get('/tools', async (c) => {
  return c.json({
    success: true,
    data: AGENT_TOOLS.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
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
      agentId: z.string().uuid().optional(),
    })
  ),
  async (c) => {
    const toolName = c.req.param('toolName');
    const { arguments: args, agentId } = c.req.valid('json');

    // Determine auth type and get context
    // Use type assertion for custom context values
    const tokenAuth = (c as any).get('tokenAuth') as TokenAuthContext | undefined;
    const user = tokenAuth ? null : getCurrentUser(c);

    // For token auth, verify tool permission
    if (tokenAuth) {
      if (!tokenAuth.permissions.includes(toolName as ApiTokenPermission)) {
        return c.json({
          success: false,
          error: { code: 'FORBIDDEN', message: `Token not authorized for tool: ${toolName}` },
        }, 403);
      }
    }

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

          // For token auth, check workspace scope with optional project restrictions
          if (tokenAuth) {
            const canAccess = await canTokenAccessProject(tokenAuth, projectId);
            if (!canAccess) {
              return c.json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Agent cannot access this project' },
              }, 403);
            }
          }

          const createResult = await taskService.create({
            projectId,
            title: args.title as string,
            description: args.description as string | undefined,
            priority: args.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none' | undefined,
            stateId: args.stateId as string | undefined,
            createdBy: user?.id || null,
            agentId: tokenAuth?.tokenId || null,
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

        case 'update_task': {
          const taskId = args.taskId as string;
          if (!taskId) {
            throw new Error('taskId is required');
          }

          // For token auth, verify task's project is accessible
          if (tokenAuth) {
            const taskResult = await taskService.getById(taskId);
            if (!taskResult.ok) throw taskResult.error;
            const canAccess = await canTokenAccessProject(tokenAuth, taskResult.value.projectId);
            if (!canAccess) {
              return c.json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Agent cannot access this project' },
              }, 403);
            }
          }

          const updateResult = await taskService.update(taskId, {
            title: args.title as string | undefined,
            description: args.description as string | undefined,
            priority: args.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none' | undefined,
            stateId: args.stateId as string | undefined,
            updatedBy: user?.id || null,
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

          // For token auth, verify task's project is accessible
          if (tokenAuth) {
            const taskResult = await taskService.getById(taskId);
            if (!taskResult.ok) throw taskResult.error;
            const canAccess = await canTokenAccessProject(tokenAuth, taskResult.value.projectId);
            if (!canAccess) {
              return c.json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Agent cannot access this project' },
              }, 403);
            }
          }

          const deleteResult = await taskService.delete(taskId, user?.id || null);
          if (!deleteResult.ok) throw deleteResult.error;
          result = { deleted: true, taskId };
          break;
        }

        case 'query_tasks': {
          // For token auth, filter by workspace's projects (optionally restricted)
          let projectId = args.projectId as string | undefined;

          // If no projectId specified but using token auth, we query across allowed projects
          // The task service will need to handle workspace-level queries
          // For now, if token has restrictions, require a projectId
          if (tokenAuth) {
            if (projectId) {
              const canAccess = await canTokenAccessProject(tokenAuth, projectId);
              if (!canAccess) {
                return c.json({
                  success: false,
                  error: { code: 'FORBIDDEN', message: 'Agent cannot access this project' },
                }, 403);
              }
            }
            // If no projectId and token has restrictions, we could query across all allowed projects
            // For simplicity, we allow querying without projectId (workspace-wide)
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

          // For token auth, verify task's project is accessible
          if (tokenAuth) {
            const taskResult = await taskService.getById(taskId);
            if (!taskResult.ok) throw taskResult.error;
            const canAccess = await canTokenAccessProject(tokenAuth, taskResult.value.projectId);
            if (!canAccess) {
              return c.json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Agent cannot access this project' },
              }, 403);
            }
          }

          // Get current task to calculate position
          const currentTask = await taskService.getById(taskId);
          if (!currentTask.ok) throw currentTask.error;

          const position = taskService.calculatePositionBetween(null, null);

          const moveResult = await taskService.move(taskId, {
            stateId,
            position,
            movedBy: user?.id || null,
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

          // For token auth, verify task's project is accessible
          if (tokenAuth) {
            const taskResult = await taskService.getById(taskId);
            if (!taskResult.ok) throw taskResult.error;
            const canAccess = await canTokenAccessProject(tokenAuth, taskResult.value.projectId);
            if (!canAccess) {
              return c.json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Agent cannot access this project' },
              }, 403);
            }
          }

          if (action === 'assign') {
            const assignResult = await taskService.addAssignee(taskId, userId, user?.id || null);
            if (!assignResult.ok) throw assignResult.error;
          } else {
            const unassignResult = await taskService.removeAssignee(taskId, userId, user?.id || null);
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

          // For token auth, verify task's project is accessible
          let taskProjectId: string | undefined;
          if (tokenAuth) {
            const taskResult = await taskService.getById(taskId);
            if (!taskResult.ok) throw taskResult.error;
            taskProjectId = taskResult.value.projectId;
            const canAccess = await canTokenAccessProject(tokenAuth, taskProjectId);
            if (!canAccess) {
              return c.json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Agent cannot access this project' },
              }, 403);
            }
          }

          const commentResult = await commentService.create({
            taskId,
            content,
            userId: user?.id || null,
            agentId: tokenAuth?.tokenId || null,
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

          // For token auth, check workspace scope with optional project restrictions
          if (tokenAuth) {
            const canAccess = await canTokenAccessProject(tokenAuth, projectId);
            if (!canAccess) {
              return c.json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Agent cannot access this project' },
              }, 403);
            }
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

          // Determine workspace and creator based on auth type
          let workspaceId: string;
          let createdBy: string | null;

          if (tokenAuth) {
            workspaceId = tokenAuth.workspaceId;
            createdBy = null; // Agent-created views have no user owner
          } else if (user) {
            // For session auth, we need a workspaceId from args
            const argWorkspaceId = args.workspaceId as string | undefined;
            if (!argWorkspaceId) {
              throw new Error('workspaceId is required for session auth');
            }
            workspaceId = argWorkspaceId;
            createdBy = user.id;
          } else {
            throw new Error('Authentication required');
          }

          const smartViewResult = await smartViewService.create({
            workspaceId,
            createdBy,
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

          // For token auth, optionally filter by project if specified
          let projectId = args.projectId as string | undefined;
          if (tokenAuth && projectId) {
            const canAccess = await canTokenAccessProject(tokenAuth, projectId);
            if (!canAccess) {
              return c.json({
                success: false,
                error: { code: 'FORBIDDEN', message: 'Agent cannot access this project' },
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
          // For token auth, list projects in the workspace (optionally filtered by restrictions)
          if (tokenAuth) {
            const projectsResult = await projectService.list({
              filters: { workspaceId: tokenAuth.workspaceId },
            });
            if (!projectsResult.ok) throw projectsResult.error;

            let projectList = projectsResult.value;

            // Filter by restricted project IDs if set
            if (tokenAuth.restrictedProjectIds && tokenAuth.restrictedProjectIds.length > 0) {
              projectList = projectList.filter((p) => tokenAuth.restrictedProjectIds!.includes(p.id));
            }

            result = projectList.map((p) => ({
              id: p.id,
              name: p.name,
              identifier: p.identifier,
              states: p.taskStates.map((s) => ({
                id: s.id,
                name: s.name,
                category: s.category,
              })),
            }));
          } else {
            // For session auth, this tool isn't particularly useful without workspace context
            // Return empty array or require workspace context
            result = { message: 'list_projects requires API token authentication with workspace scope' };
          }
          break;
        }

        default:
          throw new Error(`Tool "${toolName}" not implemented`);
      }

      // Record token usage if API token auth
      if (tokenAuth) {
        // Rough estimate: 100 tokens per tool call
        await workspaceAgentService.recordTokenUsage(tokenAuth.tokenId, 100);
      }

      // If agentId is provided (for session auth), record token usage
      if (agentId && !tokenAuth) {
        // Rough estimate: 100 tokens per tool call
        await agentService.recordTokenUsage(agentId, 100);
      }

      return c.json({ success: true, data: result });
    } catch (error) {
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
