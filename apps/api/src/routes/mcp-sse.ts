import { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { BulkCreateTasksInputSchema, REALTIME_EVENTS } from '@flowtask/shared';
import { getDatabase } from '@flowtask/database';
import { TaskService, ProjectService, CommentService, SmartViewService, WorkspaceService } from '@flowtask/domain';
import { AGENT_TOOLS } from '@flowtask/domain';
import { extractBearerToken } from '@flowtask/auth';
import { publishEvent } from '../sse/manager.js';
import { McpOAuthService, OAuthError, type OAuthMcpAuthContext } from '../services/mcp-oauth-service.js';
import { TaskGitHubLinkService } from '../services/task-github-link-service.js';
import { resolveQueryTasksAssigneeId, resolveUpdateTaskGitHubPrArgs } from './mcp-tool-args.js';
import {
  formatBulkCreateResult,
  formatWriteCommentResult,
  formatWriteTaskResult,
  projectTask,
  projectTaskList,
  resolveListLimit,
  resolveTaskProjectionArgs,
  resolveWriteMode,
} from './mcp-response-shaping.js';

/**
 * MCP SSE transport endpoints for native MCP protocol support.
 * Works with Claude Code, OpenAI ChatGPT, LibreChat, and any MCP-compatible client.
 */

const mcpSse = new Hono();
const db = getDatabase();

const taskService = new TaskService(db);
const projectService = new ProjectService(db);
const commentService = new CommentService(db);
const smartViewService = new SmartViewService(db);
const workspaceService = new WorkspaceService(db);
const oauthService = new McpOAuthService();
const taskGitHubLinkService = new TaskGitHubLinkService(db);

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

function methodNotAllowedResponse(c: any): Response {
  c.header('Allow', 'POST');
  return c.json(
    {
      error: 'Method Not Allowed',
      code: 'MCP_METHOD_NOT_ALLOWED',
      message: 'Only POST is supported for /api/mcp/sse in stateless mode',
    },
    405
  );
}

function legacySseDeprecatedResponse(c: any): Response {
  return c.json(
    {
      error: 'Gone',
      code: 'MCP_LEGACY_SSE_DEPRECATED',
      message: 'Legacy SSE endpoints are deprecated and disabled.',
      hint: 'Use POST /api/mcp/sse (Streamable HTTP).',
    },
    410
  );
}

async function hasAdminWorkspaceRole(tokenAuth: OAuthMcpAuthContext): Promise<boolean> {
  const roleResult = await workspaceService.getMemberRole(tokenAuth.workspaceId, tokenAuth.userId);
  if (!roleResult.ok || !roleResult.value) {
    return false;
  }
  return roleResult.value === 'owner' || roleResult.value === 'admin';
}

/**
 * Helper to check if OAuth token can access a project.
 */
async function canTokenAccessProject(tokenAuth: OAuthMcpAuthContext, projectId: string): Promise<boolean> {
  const projectResult = await projectService.getById(projectId);
  if (!projectResult.ok) {
    return false;
  }

  if (projectResult.value.workspaceId !== tokenAuth.workspaceId) {
    return false;
  }

  return hasAdminWorkspaceRole(tokenAuth);
}

/**
 * Execute an MCP tool and return the result.
 * This mirrors the logic from mcp.ts but returns CallToolResult format.
 */
async function executeMcpTool(
  toolName: string,
  args: Record<string, unknown>,
  tokenAuth: OAuthMcpAuthContext
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  oauthService.ensureToolAllowed(tokenAuth, toolName);

  let result: unknown;

  switch (toolName) {
    case 'create_task': {
      const projectId = args.projectId as string;
      if (!projectId) {
        throw new Error('projectId is required');
      }

      const canAccess = await canTokenAccessProject(tokenAuth, projectId);
      if (!canAccess) {
        throw new Error('Agent cannot access this project');
      }

      const createResult = await taskService.create({
        projectId,
        title: args.title as string,
        description: args.description as string | undefined,
        priority: args.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none' | undefined,
        stateId: args.stateId as string | undefined,
        createdBy: tokenAuth.userId,
        agentId: null,
        mcpClientId: tokenAuth.clientId,
      });

      if (!createResult.ok) throw createResult.error;
      const writeMode = resolveWriteMode(args);
      result = formatWriteTaskResult(
        'create_task',
        createResult.value,
        writeMode,
        resolveTaskProjectionArgs({ view: writeMode === 'full' ? 'full' : 'compact' })
      );

      // Publish SSE event for real-time UI updates
      const projectInfo = await projectService.getById(projectId);
      if (projectInfo.ok) {
        publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.TASK_CREATED, {
          task: createResult.value,
          projectId,
        });
      }
      break;
    }

    case 'bulk_create_tasks': {
      const parsed = BulkCreateTasksInputSchema.parse(args);
      const { projectId, tasks } = parsed;

      const canAccess = await canTokenAccessProject(tokenAuth, projectId);
      if (!canAccess) {
        throw new Error('Agent cannot access this project');
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
          createdBy: tokenAuth.userId,
          agentId: null,
          mcpClientId: tokenAuth.clientId,
        });

        if (!createResult.ok) {
          failed.push({
            index,
            error: createResult.error.message,
          });
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
      result = formatBulkCreateResult(
        'bulk_create_tasks',
        createdTasks,
        failed,
        writeMode,
        resolveTaskProjectionArgs({ view: writeMode === 'full' ? 'full' : 'compact' })
      );
      break;
    }

    case 'update_task': {
      const taskId = args.taskId as string;
      if (!taskId) {
        throw new Error('taskId is required');
      }

      const prLinkArgs = resolveUpdateTaskGitHubPrArgs(args);

      const taskResult = await taskService.getById(taskId);
      if (!taskResult.ok) throw taskResult.error;
      const canAccess = await canTokenAccessProject(tokenAuth, taskResult.value.projectId);
      if (!canAccess) {
        throw new Error('Agent cannot access this project');
      }

      const updateResult = await taskService.update(taskId, {
        title: args.title as string | undefined,
        description: args.description as string | undefined,
        priority: args.priority as 'urgent' | 'high' | 'medium' | 'low' | 'none' | undefined,
        stateId: args.stateId as string | undefined,
        updatedBy: tokenAuth.userId,
        mcpClientId: tokenAuth.clientId,
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
      result = formatWriteTaskResult(
        'update_task',
        updatedTask,
        writeMode,
        resolveTaskProjectionArgs({ view: writeMode === 'full' ? 'full' : 'compact' })
      );

      const projectInfo = await projectService.getById(taskResult.value.projectId);
      if (projectInfo.ok) {
        publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.TASK_UPDATED, updatedTask);
      }
      break;
    }

    case 'delete_task': {
      const taskId = args.taskId as string;
      if (!taskId) {
        throw new Error('taskId is required');
      }

      const taskResult = await taskService.getById(taskId);
      if (!taskResult.ok) throw taskResult.error;
      const canAccess = await canTokenAccessProject(tokenAuth, taskResult.value.projectId);
      if (!canAccess) {
        throw new Error('Agent cannot access this project');
      }

      const deleteResult = await taskService.delete(taskId, tokenAuth.userId, { mcpClientId: tokenAuth.clientId });
      if (!deleteResult.ok) throw deleteResult.error;
      result = { deleted: true, taskId };

      const projectInfo = await projectService.getById(taskResult.value.projectId);
      if (projectInfo.ok) {
        publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.TASK_DELETED, {
          id: taskId,
          projectId: taskResult.value.projectId,
        });
      }
      break;
    }

    case 'query_tasks': {
      const projectId = args.projectId as string | undefined;
      const assigneeId = resolveQueryTasksAssigneeId(args, tokenAuth.userId);

      if (projectId) {
        const canAccess = await canTokenAccessProject(tokenAuth, projectId);
        if (!canAccess) {
          throw new Error('Agent cannot access this project');
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
      result = projectTaskList(
        queryResult.value.tasks,
        queryResult.value.total,
        resolveTaskProjectionArgs(args)
      );
      break;
    }

    case 'get_task': {
      const taskId = args.taskId as string;
      if (!taskId) {
        throw new Error('taskId is required');
      }

      const taskResult = await taskService.getById(taskId);
      if (!taskResult.ok) throw taskResult.error;
      const canAccess = await canTokenAccessProject(tokenAuth, taskResult.value.projectId);
      if (!canAccess) {
        throw new Error('Agent cannot access this project');
      }

      result = projectTask(taskResult.value, resolveTaskProjectionArgs(args));
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
      const canAccess = await canTokenAccessProject(tokenAuth, taskResult.value.projectId);
      if (!canAccess) {
        throw new Error('Agent cannot access this project');
      }

      const position = taskService.calculatePositionBetween(null, null);

      const moveResult = await taskService.move(taskId, {
        stateId,
        position,
        movedBy: tokenAuth.userId,
        mcpClientId: tokenAuth.clientId,
      });

      if (!moveResult.ok) throw moveResult.error;
      const writeMode = resolveWriteMode(args);
      result = formatWriteTaskResult(
        'move_task',
        moveResult.value,
        writeMode,
        resolveTaskProjectionArgs({ view: writeMode === 'full' ? 'full' : 'compact' })
      );

      const projectInfo = await projectService.getById(taskResult.value.projectId);
      if (projectInfo.ok) {
        publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.TASK_MOVED, moveResult.value);
      }
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
      const canAccess = await canTokenAccessProject(tokenAuth, taskResult.value.projectId);
      if (!canAccess) {
        throw new Error('Agent cannot access this project');
      }

      if (action === 'assign') {
        const assignResult = await taskService.addAssignee(taskId, userId, tokenAuth.userId, {
          mcpClientId: tokenAuth.clientId,
        });
        if (!assignResult.ok) throw assignResult.error;
      } else {
        const unassignResult = await taskService.removeAssignee(taskId, userId, tokenAuth.userId, {
          mcpClientId: tokenAuth.clientId,
        });
        if (!unassignResult.ok) throw unassignResult.error;
      }

      const updatedTask = await taskService.getById(taskId);
      if (!updatedTask.ok) throw updatedTask.error;
      const writeMode = resolveWriteMode(args);
      result = formatWriteTaskResult(
        'assign_task',
        updatedTask.value,
        writeMode,
        resolveTaskProjectionArgs({ view: writeMode === 'full' ? 'full' : 'compact' })
      );

      const projectInfo = await projectService.getById(taskResult.value.projectId);
      if (projectInfo.ok) {
        publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.TASK_UPDATED, updatedTask.value);
      }
      break;
    }

    case 'add_comment': {
      const taskId = args.taskId as string;
      const content = args.content as string;

      if (!taskId || !content) {
        throw new Error('taskId and content are required');
      }

      const taskResult = await taskService.getById(taskId);
      if (!taskResult.ok) throw taskResult.error;
      const canAccess = await canTokenAccessProject(tokenAuth, taskResult.value.projectId);
      if (!canAccess) {
        throw new Error('Agent cannot access this project');
      }

      const commentResult = await commentService.create({
        taskId,
        content,
        userId: tokenAuth.userId,
        agentId: null,
        mcpClientId: tokenAuth.clientId,
      });

      if (!commentResult.ok) throw commentResult.error;
      const writeMode = resolveWriteMode(args);
      result = formatWriteCommentResult('add_comment', commentResult.value.id, commentResult.value, writeMode);

      // Publish SSE event for real-time UI updates
      const projectInfo = await projectService.getById(taskResult.value.projectId);
      if (projectInfo.ok) {
        publishEvent(projectInfo.value.workspaceId, REALTIME_EVENTS.COMMENT_CREATED, {
          comment: commentResult.value,
          taskId,
          projectId: taskResult.value.projectId,
        });
      }
      break;
    }

    case 'summarize_project': {
      const projectId = args.projectId as string;
      if (!projectId) {
        throw new Error('projectId is required');
      }

      const canAccess = await canTokenAccessProject(tokenAuth, projectId);
      if (!canAccess) {
        throw new Error('Agent cannot access this project');
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
        states: allStates.map((s) => ({
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
        workspaceId: tokenAuth.workspaceId,
        createdBy: tokenAuth.userId,
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

      const projectId = args.projectId as string | undefined;
      if (projectId) {
        const canAccess = await canTokenAccessProject(tokenAuth, projectId);
        if (!canAccess) {
          throw new Error('Agent cannot access this project');
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
      result = projectTaskList(
        searchResult.value.tasks,
        searchResult.value.total,
        resolveTaskProjectionArgs(args)
      );
      break;
    }

    case 'list_projects': {
      // List projects in the workspace
      const projectsResult = await projectService.list({
        filters: { workspaceId: tokenAuth.workspaceId },
      });
      if (!projectsResult.ok) throw projectsResult.error;

      const projectList = projectsResult.value;

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
      break;
    }

    default:
      throw new Error(`Tool "${toolName}" not implemented`);
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(result) }],
  };
}

/**
 * Create an MCP server instance with tools registered based on token permissions.
 */
function createMcpServer(tokenAuth: OAuthMcpAuthContext): McpServer {
  const mcpServer = new McpServer(
    {
      name: 'flowtask',
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
      instructions: 'Use query_tasks for structured filters (assigneeId="me" for my tasks), search_tasks for keywords, get_task for details; keep defaults (compact/ack) unless full data is required.',
    }
  );

  // Get tools that the token has permission for
  const allowedTools = AGENT_TOOLS.filter(
    (tool) => tokenAuth.toolPermissions.includes(tool.name)
  );

  // Register tools/list handler
  mcpServer.server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: allowedTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.parameters,
        annotations: tool.annotations,
      })),
    };
  });

  // Register tools/call handler
  mcpServer.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    try {
      const result = await executeMcpTool(name, args as Record<string, unknown>, tokenAuth);
      return result;
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: process.env.NODE_ENV === 'production' ? 'Error: Tool execution failed' : `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
        isError: true,
      };
    }
  });

  return mcpServer;
}

/**
 * Verify OAuth access token and return auth context.
 */
async function verifyToken(
  authHeader: string | undefined,
  logContext: { route: string; hasSessionHeader: boolean }
): Promise<OAuthMcpAuthContext | null> {
  const token = extractBearerToken(authHeader);
  if (!token) {
    return null;
  }

  try {
    const tokenAuth = await oauthService.authenticateAccessToken(token);
    const roleOk = await hasAdminWorkspaceRole(tokenAuth);
    if (!roleOk) {
      console.warn('MCP auth failed: non-admin workspace role', logContext);
      return null;
    }
    return tokenAuth;
  } catch (error) {
    if (error instanceof OAuthError) {
      console.warn('MCP auth failed', {
        ...logContext,
        oauthError: error.oauthError,
        statusCode: error.statusCode,
      });
    } else {
      console.warn('MCP auth failed', {
        ...logContext,
        oauthError: 'unknown_error',
      });
    }
    return null;
  }
}

/**
 * MCP SSE endpoint - handles all HTTP methods (GET for SSE, POST for messages, DELETE for session close).
 * This uses the Streamable HTTP transport which is the modern replacement for the deprecated SSE transport.
 */
mcpSse.all('/sse', async (c) => {
  // Verify authentication
  const authHeader = c.req.header('Authorization');
  const tokenAuth = await verifyToken(authHeader, {
    route: '/api/mcp/sse',
    hasSessionHeader: Boolean(c.req.header('Mcp-Session-Id')),
  });

  if (!tokenAuth) {
    setOAuthChallenge(c);
    return c.json({ error: 'Unauthorized', message: 'Valid OAuth access token required' }, 401);
  }

  if (c.req.method !== 'POST') {
    return methodNotAllowedResponse(c);
  }

  // Stateless transport: no server-side session map, one transport per request.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });

  // Create and connect an MCP server to this request transport
  const server = createMcpServer(tokenAuth);
  await server.connect(transport);

  // Handle the request using the transport
  return transport.handleRequest(c.req.raw);
});

/**
 * Alternative endpoint for legacy SSE clients that need separate GET/POST endpoints.
 * GET /sse/stream - SSE stream for server-to-client messages
 * POST /sse/message - JSON-RPC messages from client-to-server
 */
mcpSse.get('/sse/stream', async (c) => {
  return legacySseDeprecatedResponse(c);
});

mcpSse.post('/sse/message', async (c) => {
  return legacySseDeprecatedResponse(c);
});

export { mcpSse as mcpSseRoutes };
