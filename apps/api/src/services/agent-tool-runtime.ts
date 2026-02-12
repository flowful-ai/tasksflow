import { z } from 'zod';
import { getDatabase } from '@flowtask/database';
import { TaskService, ProjectService, CommentService, SmartViewService } from '@flowtask/domain';
import { AGENT_TOOLS } from '@flowtask/domain';
import { BulkCreateTasksInputSchema, REALTIME_EVENTS, type AgentTool } from '@flowtask/shared';
import { publishEvent } from '../sse/manager.js';
import { TaskGitHubLinkService } from './task-github-link-service.js';
import { resolveQueryTasksAssigneeId, resolveUpdateTaskGitHubPrArgs } from '../routes/mcp-tool-args.js';
import {
  formatBulkCreateResult,
  formatWriteCommentResult,
  formatWriteTaskResult,
  projectTask,
  projectTaskList,
  resolveListLimit,
  resolveTaskProjectionArgs,
  resolveWriteMode,
} from '../routes/mcp-response-shaping.js';

const db = getDatabase();
const taskService = new TaskService(db);
const projectService = new ProjectService(db);
const commentService = new CommentService(db);
const smartViewService = new SmartViewService(db);
const taskGitHubLinkService = new TaskGitHubLinkService(db);

export class ToolExecutionError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number
  ) {
    super(message);
  }
}

export interface AgentToolExecutionContext {
  workspaceId: string;
  userId: string;
  mcpClientId: string | null;
  allowedToolNames?: Set<string>;
  canAccessProject: (projectId: string) => Promise<boolean>;
}

export interface RuntimeToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

function ensureToolAllowed(toolName: string, ctx: AgentToolExecutionContext): void {
  if (ctx.allowedToolNames && !ctx.allowedToolNames.has(toolName)) {
    throw new ToolExecutionError(`Tool \"${toolName}\" is not allowed`, 'FORBIDDEN', 403);
  }
}

function getUnknownTool(toolName: string): never {
  throw new ToolExecutionError(`Tool \"${toolName}\" not found`, 'UNKNOWN_TOOL', 404);
}

export function listToolDefinitions(allowedToolNames?: Set<string>): RuntimeToolDefinition[] {
  return AGENT_TOOLS
    .filter((toolDef) => !allowedToolNames || allowedToolNames.has(toolDef.name))
    .map((toolDef) => ({
      name: toolDef.name,
      description: toolDef.description,
      inputSchema: toolDef.parameters,
      annotations: toolDef.annotations,
    }));
}

export async function executeAgentTool(
  toolName: string,
  args: Record<string, unknown>,
  ctx: AgentToolExecutionContext
): Promise<unknown> {
  ensureToolAllowed(toolName, ctx);

  switch (toolName) {
    case 'create_task': {
      const projectId = args.projectId as string;
      if (!projectId) {
        throw new Error('projectId is required');
      }

      const canAccess = await ctx.canAccessProject(projectId);
      if (!canAccess) {
        throw new ToolExecutionError('Cannot access this project', 'FORBIDDEN', 403);
      }

      const createResult = await taskService.create({
        projectId,
        title: args.title as string,
        description: args.description as string | undefined,
        priority: args.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none' | undefined,
        stateId: args.stateId as string | undefined,
        createdBy: ctx.userId,
        agentId: null,
        mcpClientId: ctx.mcpClientId,
      });

      if (!createResult.ok) throw createResult.error;
      const writeMode = resolveWriteMode(args);
      const result = formatWriteTaskResult(
        'create_task',
        createResult.value,
        writeMode,
        resolveTaskProjectionArgs({ view: writeMode === 'full' ? 'full' : 'compact' })
      );

      const projectInfo = await projectService.getById(projectId);
      if (projectInfo.ok) {
        publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.TASK_CREATED, {
          task: createResult.value,
          projectId,
        });
      }

      return result;
    }

    case 'bulk_create_tasks': {
      const parsed = BulkCreateTasksInputSchema.parse(args);
      const { projectId, tasks } = parsed;

      const canAccess = await ctx.canAccessProject(projectId);
      if (!canAccess) {
        throw new ToolExecutionError('Cannot access this project', 'FORBIDDEN', 403);
      }

      const projectInfo = await projectService.getById(projectId);
      const createdTasks: Parameters<typeof formatBulkCreateResult>[1] = [];
      const failed: Array<{ index: number; error: string }> = [];

      for (const [index, taskInput] of tasks.entries()) {
        const createResult = await taskService.create({
          projectId,
          title: taskInput.title,
          description: taskInput.description,
          priority: taskInput.priority,
          stateId: taskInput.stateId,
          createdBy: ctx.userId,
          agentId: null,
          mcpClientId: ctx.mcpClientId,
        });

        if (!createResult.ok) {
          failed.push({ index, error: createResult.error.message });
          continue;
        }

        createdTasks.push(createResult.value);

        if (projectInfo.ok) {
          publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.TASK_CREATED, {
            task: createResult.value,
            projectId,
          });
        }
      }

      const writeMode = resolveWriteMode(args);
      return formatBulkCreateResult(
        'bulk_create_tasks',
        createdTasks,
        failed,
        writeMode,
        resolveTaskProjectionArgs({ view: writeMode === 'full' ? 'full' : 'compact' })
      );
    }

    case 'update_task': {
      const taskId = args.taskId as string;
      if (!taskId) {
        throw new Error('taskId is required');
      }

      const prLinkArgs = resolveUpdateTaskGitHubPrArgs(args);

      const taskResult = await taskService.getById(taskId);
      if (!taskResult.ok) throw taskResult.error;
      const canAccess = await ctx.canAccessProject(taskResult.value.projectId);
      if (!canAccess) {
        throw new ToolExecutionError('Cannot access this project', 'FORBIDDEN', 403);
      }

      const updateResult = await taskService.update(taskId, {
        title: args.title as string | undefined,
        description: args.description as string | undefined,
        priority: args.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none' | undefined,
        stateId: args.stateId as string | undefined,
        updatedBy: ctx.userId,
        mcpClientId: ctx.mcpClientId,
      });

      if (!updateResult.ok) throw updateResult.error;

      let updatedTask = updateResult.value;

      if (prLinkArgs) {
        await taskGitHubLinkService.linkPullRequestToTask({
          taskId,
          projectId: taskResult.value.projectId,
          owner: prLinkArgs.owner,
          repo: prLinkArgs.repo,
          prNumber: prLinkArgs.prNumber,
        });

        const refreshedTask = await taskService.getById(taskId);
        if (!refreshedTask.ok) throw refreshedTask.error;
        updatedTask = refreshedTask.value;
      }

      const writeMode = resolveWriteMode(args);
      const result = formatWriteTaskResult(
        'update_task',
        updatedTask,
        writeMode,
        resolveTaskProjectionArgs({ view: writeMode === 'full' ? 'full' : 'compact' })
      );

      const projectInfo = await projectService.getById(taskResult.value.projectId);
      if (projectInfo.ok) {
        publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.TASK_UPDATED, updatedTask);
      }

      return result;
    }

    case 'delete_task': {
      const taskId = args.taskId as string;
      if (!taskId) {
        throw new Error('taskId is required');
      }

      const taskResult = await taskService.getById(taskId);
      if (!taskResult.ok) throw taskResult.error;
      const canAccess = await ctx.canAccessProject(taskResult.value.projectId);
      if (!canAccess) {
        throw new ToolExecutionError('Cannot access this project', 'FORBIDDEN', 403);
      }

      const deleteResult = await taskService.delete(taskId, ctx.userId, { mcpClientId: ctx.mcpClientId });
      if (!deleteResult.ok) throw deleteResult.error;

      const projectInfo = await projectService.getById(taskResult.value.projectId);
      if (projectInfo.ok) {
        publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.TASK_DELETED, {
          id: taskId,
          projectId: taskResult.value.projectId,
        });
      }

      return { deleted: true, taskId };
    }

    case 'query_tasks': {
      const projectId = args.projectId as string | undefined;
      const assigneeId = resolveQueryTasksAssigneeId(args, ctx.userId);

      if (projectId) {
        const canAccess = await ctx.canAccessProject(projectId);
        if (!canAccess) {
          throw new ToolExecutionError('Cannot access this project', 'FORBIDDEN', 403);
        }
      }

      const queryResult = await taskService.list({
        filters: {
          projectId,
          stateId: args.stateId as string | undefined,
          priority: args.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none' | undefined,
          assigneeId,
          search: args.search as string | undefined,
        },
        limit: resolveListLimit(args),
      });

      if (!queryResult.ok) throw queryResult.error;
      return projectTaskList(queryResult.value.tasks, queryResult.value.total, resolveTaskProjectionArgs(args));
    }

    case 'get_task': {
      const taskId = args.taskId as string;
      if (!taskId) {
        throw new Error('taskId is required');
      }

      const taskResult = await taskService.getById(taskId);
      if (!taskResult.ok) throw taskResult.error;
      const canAccess = await ctx.canAccessProject(taskResult.value.projectId);
      if (!canAccess) {
        throw new ToolExecutionError('Cannot access this project', 'FORBIDDEN', 403);
      }

      return projectTask(taskResult.value, resolveTaskProjectionArgs(args));
    }

    case 'move_task': {
      const taskId = args.taskId as string;
      const stateId = args.stateId as string;
      if (!taskId || !stateId) {
        throw new Error('taskId and stateId are required');
      }

      const taskResult = await taskService.getById(taskId);
      if (!taskResult.ok) throw taskResult.error;
      const canAccess = await ctx.canAccessProject(taskResult.value.projectId);
      if (!canAccess) {
        throw new ToolExecutionError('Cannot access this project', 'FORBIDDEN', 403);
      }

      const position = taskService.calculatePositionBetween(null, null);
      const moveResult = await taskService.move(taskId, {
        stateId,
        position,
        movedBy: ctx.userId,
        mcpClientId: ctx.mcpClientId,
      });

      if (!moveResult.ok) throw moveResult.error;
      const writeMode = resolveWriteMode(args);
      const result = formatWriteTaskResult(
        'move_task',
        moveResult.value,
        writeMode,
        resolveTaskProjectionArgs({ view: writeMode === 'full' ? 'full' : 'compact' })
      );

      const projectInfo = await projectService.getById(taskResult.value.projectId);
      if (projectInfo.ok) {
        publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.TASK_MOVED, moveResult.value);
      }

      return result;
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
      const canAccess = await ctx.canAccessProject(taskResult.value.projectId);
      if (!canAccess) {
        throw new ToolExecutionError('Cannot access this project', 'FORBIDDEN', 403);
      }

      if (action === 'assign') {
        const assignResult = await taskService.addAssignee(taskId, userId, ctx.userId, {
          mcpClientId: ctx.mcpClientId,
        });
        if (!assignResult.ok) throw assignResult.error;
      } else {
        const unassignResult = await taskService.removeAssignee(taskId, userId, ctx.userId, {
          mcpClientId: ctx.mcpClientId,
        });
        if (!unassignResult.ok) throw unassignResult.error;
      }

      const updatedTask = await taskService.getById(taskId);
      if (!updatedTask.ok) throw updatedTask.error;
      const writeMode = resolveWriteMode(args);
      const result = formatWriteTaskResult(
        'assign_task',
        updatedTask.value,
        writeMode,
        resolveTaskProjectionArgs({ view: writeMode === 'full' ? 'full' : 'compact' })
      );

      const projectInfo = await projectService.getById(taskResult.value.projectId);
      if (projectInfo.ok) {
        publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.TASK_UPDATED, updatedTask.value);
      }

      return result;
    }

    case 'add_comment': {
      const taskId = args.taskId as string;
      const content = args.content as string;

      if (!taskId || !content) {
        throw new Error('taskId and content are required');
      }

      const taskResult = await taskService.getById(taskId);
      if (!taskResult.ok) throw taskResult.error;
      const taskProjectId = taskResult.value.projectId;
      const canAccess = await ctx.canAccessProject(taskProjectId);
      if (!canAccess) {
        throw new ToolExecutionError('Cannot access this project', 'FORBIDDEN', 403);
      }

      const commentResult = await commentService.create({
        taskId,
        content,
        userId: ctx.userId,
        agentId: null,
        mcpClientId: ctx.mcpClientId,
      });

      if (!commentResult.ok) throw commentResult.error;
      const writeMode = resolveWriteMode(args);
      const result = formatWriteCommentResult('add_comment', commentResult.value.id, commentResult.value, writeMode);

      if (taskProjectId) {
        const projectInfo = await projectService.getById(taskProjectId);
        if (projectInfo.ok) {
          publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.COMMENT_CREATED, {
            comment: commentResult.value,
            taskId,
            projectId: taskProjectId,
          });
        }
      }

      return result;
    }

    case 'summarize_project': {
      const projectId = args.projectId as string;
      if (!projectId) {
        throw new Error('projectId is required');
      }

      const canAccess = await ctx.canAccessProject(projectId);
      if (!canAccess) {
        throw new ToolExecutionError('Cannot access this project', 'FORBIDDEN', 403);
      }

      const projectResult = await projectService.getById(projectId);
      if (!projectResult.ok) throw projectResult.error;

      const tasksResult = await taskService.list({
        filters: { projectId },
        limit: 1000,
      });

      if (!tasksResult.ok) throw tasksResult.error;

      const tasks = tasksResult.value.tasks;
      const byState = new Map<string, number>();
      const byPriority = new Map<string, number>();

      const allStates = projectResult.value.taskStates;
      for (const state of allStates) {
        byState.set(state.name, 0);
      }

      for (const taskItem of tasks) {
        const stateName = taskItem.state?.name || 'No State';
        byState.set(stateName, (byState.get(stateName) || 0) + 1);

        const priority = taskItem.priority || 'none';
        byPriority.set(priority, (byPriority.get(priority) || 0) + 1);
      }

      return {
        project: {
          id: projectResult.value.id,
          name: projectResult.value.name,
          identifier: projectResult.value.identifier,
        },
        states: projectResult.value.taskStates.map((state) => ({
          id: state.id,
          name: state.name,
          category: state.category,
        })),
        statistics: {
          totalTasks: tasks.length,
          byState: Object.fromEntries(byState),
          byPriority: Object.fromEntries(byPriority),
        },
      };
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
        workspaceId: ctx.workspaceId,
        createdBy: ctx.userId,
        name,
        description: args.description as string | undefined,
        filters: parsedFilters,
      });

      if (!smartViewResult.ok) throw smartViewResult.error;
      return smartViewResult.value;
    }

    case 'search_tasks': {
      const query = args.query as string;
      if (!query) {
        throw new Error('query is required');
      }

      const projectId = args.projectId as string | undefined;
      if (projectId) {
        const canAccess = await ctx.canAccessProject(projectId);
        if (!canAccess) {
          throw new ToolExecutionError('Cannot access this project', 'FORBIDDEN', 403);
        }
      }

      const searchResult = await taskService.list({
        filters: {
          projectId,
          search: query,
        },
        limit: resolveListLimit(args),
      });

      if (!searchResult.ok) throw searchResult.error;
      return projectTaskList(searchResult.value.tasks, searchResult.value.total, resolveTaskProjectionArgs(args));
    }

    case 'list_projects': {
      const projectsResult = await projectService.list({
        filters: { workspaceId: ctx.workspaceId },
      });
      if (!projectsResult.ok) throw projectsResult.error;

      return projectsResult.value.map((project) => ({
        id: project.id,
        name: project.name,
        identifier: project.identifier,
        states: project.taskStates.map((state) => ({
          id: state.id,
          name: state.name,
          category: state.category,
        })),
      }));
    }

    default:
      getUnknownTool(toolName);
  }
}

type ToolSchema = {
  type: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
  properties?: Record<string, ToolSchema>;
  items?: ToolSchema;
  required?: string[];
  enum?: string[];
};

function jsonSchemaToZod(schema: ToolSchema): z.ZodTypeAny {
  switch (schema.type) {
    case 'string': {
      if (schema.enum && schema.enum.length > 0) {
        return z.enum(schema.enum as [string, ...string[]]);
      }
      return z.string();
    }
    case 'number':
      return z.number();
    case 'integer':
      return z.number().int();
    case 'boolean':
      return z.boolean();
    case 'null':
      return z.null();
    case 'array':
      return z.array(jsonSchemaToZod(schema.items ?? { type: 'string' }));
    case 'object': {
      const shape: Record<string, z.ZodTypeAny> = {};
      const required = new Set(schema.required ?? []);
      for (const [key, value] of Object.entries(schema.properties ?? {})) {
        const mapped = jsonSchemaToZod(value);
        shape[key] = required.has(key) ? mapped : mapped.optional();
      }
      return z.object(shape);
    }
    default:
      return z.any();
  }
}

export function buildAiSdkTools(allowedToolNames: AgentTool[], ctx: AgentToolExecutionContext) {
  const allowedSet = new Set(allowedToolNames);
  const tools: Record<string, { description: string; inputSchema: z.ZodTypeAny; execute: (input: unknown) => Promise<unknown> }> = {};

  for (const toolDef of AGENT_TOOLS) {
    if (!allowedSet.has(toolDef.name)) {
      continue;
    }

    tools[toolDef.name] = {
      description: toolDef.description,
      inputSchema: jsonSchemaToZod(toolDef.parameters as ToolSchema),
      execute: async (input: unknown) => executeAgentTool(toolDef.name, input as Record<string, unknown>, ctx),
    };
  }

  return tools as Record<string, unknown>;
}
