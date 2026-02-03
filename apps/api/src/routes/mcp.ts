import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getDatabase } from '@flowtask/database';
import { TaskService, ProjectService, AgentService, CommentService } from '@flowtask/domain';
import { getCurrentUser } from '@flowtask/auth';
import { AGENT_TOOLS } from '@flowtask/domain';

/**
 * MCP (Model Context Protocol) endpoints for AI agent tool execution.
 * These endpoints are called by AI agents to perform actions.
 */

const mcp = new Hono();
const db = getDatabase();
const taskService = new TaskService(db);
const projectService = new ProjectService(db);
const agentService = new AgentService(db);
const commentService = new CommentService(db);

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
  zValidator(
    'json',
    z.object({
      arguments: z.record(z.unknown()),
      agentId: z.string().uuid().optional(),
    })
  ),
  async (c) => {
    const user = getCurrentUser(c);
    const toolName = c.req.param('toolName');
    const { arguments: args, agentId } = c.req.valid('json');

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

          const createResult = await taskService.create({
            projectId,
            title: args.title as string,
            description: args.description as string | undefined,
            priority: args.priority as any,
            stateId: args.stateId as string | undefined,
            createdBy: user.id,
          });

          if (!createResult.ok) throw createResult.error;
          result = createResult.value;
          break;
        }

        case 'update_task': {
          const taskId = args.taskId as string;
          if (!taskId) {
            throw new Error('taskId is required');
          }

          const updateResult = await taskService.update(taskId, {
            title: args.title as string | undefined,
            description: args.description as string | undefined,
            priority: args.priority as any,
            stateId: args.stateId as string | undefined,
            updatedBy: user.id,
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

          const deleteResult = await taskService.delete(taskId, user.id);
          if (!deleteResult.ok) throw deleteResult.error;
          result = { deleted: true, taskId };
          break;
        }

        case 'query_tasks': {
          const queryResult = await taskService.list({
            filters: {
              projectId: args.projectId as string | undefined,
              stateId: args.stateId as string | undefined,
              priority: args.priority as any,
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

          // Get current task to calculate position
          const currentTask = await taskService.getById(taskId);
          if (!currentTask.ok) throw currentTask.error;

          const position = taskService.calculatePositionBetween(null, null);

          const moveResult = await taskService.move(taskId, {
            stateId,
            position,
            movedBy: user.id,
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

          if (action === 'assign') {
            const assignResult = await taskService.addAssignee(taskId, userId, user.id);
            if (!assignResult.ok) throw assignResult.error;
          } else {
            const unassignResult = await taskService.removeAssignee(taskId, userId, user.id);
            if (!unassignResult.ok) throw unassignResult.error;
          }

          const updatedTask = await taskService.getById(taskId);
          if (!updatedTask.ok) throw updatedTask.error;
          result = updatedTask.value;
          break;
        }

        case 'add_comment': {
          // TODO: Implement comment service
          result = { message: 'Comments not yet implemented' };
          break;
        }

        case 'summarize_project': {
          const projectId = args.projectId as string;
          if (!projectId) {
            throw new Error('projectId is required');
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
            statistics: {
              totalTasks: tasks.length,
              byState: Object.fromEntries(byState),
              byPriority: Object.fromEntries(byPriority),
            },
          };
          break;
        }

        case 'create_smart_view': {
          // TODO: Implement smart view creation via MCP
          result = { message: 'Smart view creation not yet implemented' };
          break;
        }

        case 'search_tasks': {
          const query = args.query as string;
          if (!query) {
            throw new Error('query is required');
          }

          const searchResult = await taskService.list({
            filters: { search: query },
            limit: parseInt(args.limit as string || '20', 10),
          });

          if (!searchResult.ok) throw searchResult.error;
          result = searchResult.value;
          break;
        }

        default:
          throw new Error(`Tool "${toolName}" not implemented`);
      }

      // If agentId is provided, record token usage (estimated)
      if (agentId) {
        // Rough estimate: 100 tokens per tool call
        await agentService.recordTokenUsage(agentId, 100);
      }

      return c.json({ success: true, data: result });
    } catch (error) {
      return c.json({
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      }, 400);
    }
  }
);

export { mcp as mcpRoutes };
