import type { Agent, UserApiKey } from '@flowtask/database';
import type { CreateAgent, UpdateAgent, AgentTool, AIModel, AgentExecution, RunAgent } from '@flowtask/shared';

export interface AgentWithRelations extends Agent {
  // Additional computed fields
  isRateLimited: boolean;
  remainingTokensToday: number;
}

export interface AgentCreateInput extends CreateAgent {
  workspaceId: string;
  createdBy: string;
}

export interface AgentUpdateInput extends UpdateAgent {
  updatedBy: string;
}

export interface ApiKeyCreateInput {
  userId: string;
  provider: 'openrouter';
  apiKey: string;
}

export interface AgentFilters {
  workspaceId?: string;
  isActive?: boolean;
  model?: AIModel;
}

export interface AgentListOptions {
  filters?: AgentFilters;
  sortBy?: 'name' | 'created_at';
  sortOrder?: 'asc' | 'desc';
}

export interface AgentRunInput extends RunAgent {
  agentId: string;
  userId: string;
}

export interface AgentRunResult {
  execution: AgentExecution;
  response: string;
}

// Tool definitions for MCP
export interface ToolDefinition {
  name: AgentTool;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description: string;
      enum?: string[];
    }>;
    required: string[];
  };
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'create_task',
    description: 'Create a new task in a project',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The ID of the project to create the task in' },
        title: { type: 'string', description: 'The title of the task' },
        description: { type: 'string', description: 'Optional description in markdown' },
        priority: {
          type: 'string',
          description: 'Task priority',
          enum: ['urgent', 'high', 'medium', 'low', 'none'],
        },
        stateId: { type: 'string', description: 'Optional state ID to place the task in' },
      },
      required: ['projectId', 'title'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'update_task',
    description: 'Update an existing task',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The ID of the task to update' },
        title: { type: 'string', description: 'New title for the task' },
        description: { type: 'string', description: 'New description in markdown' },
        priority: {
          type: 'string',
          description: 'New priority',
          enum: ['urgent', 'high', 'medium', 'low', 'none'],
        },
        stateId: { type: 'string', description: 'New state ID' },
      },
      required: ['taskId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'delete_task',
    description: 'Soft delete a task',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The ID of the task to delete' },
      },
      required: ['taskId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'query_tasks',
    description: 'Search and filter tasks',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Filter by project ID' },
        stateId: { type: 'string', description: 'Filter by state ID' },
        priority: {
          type: 'string',
          description: 'Filter by priority',
          enum: ['urgent', 'high', 'medium', 'low', 'none'],
        },
        assigneeId: { type: 'string', description: 'Filter by assignee ID' },
        search: { type: 'string', description: 'Search in title and description' },
        limit: { type: 'string', description: 'Maximum number of results (default 20)' },
      },
      required: [],
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'move_task',
    description: 'Move a task to a different state',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The ID of the task to move' },
        stateId: { type: 'string', description: 'The target state ID' },
      },
      required: ['taskId', 'stateId'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'assign_task',
    description: 'Assign or unassign a user to/from a task',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The ID of the task' },
        userId: { type: 'string', description: 'The ID of the user to assign' },
        action: {
          type: 'string',
          description: 'Whether to assign or unassign',
          enum: ['assign', 'unassign'],
        },
      },
      required: ['taskId', 'userId', 'action'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'add_comment',
    description: 'Add a comment to a task',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The ID of the task' },
        content: { type: 'string', description: 'The comment content in markdown' },
      },
      required: ['taskId', 'content'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'summarize_project',
    description: 'Get a summary of a project including task statistics and available states (with IDs for use with move_task)',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'The ID of the project to summarize' },
      },
      required: ['projectId'],
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'create_smart_view',
    description: 'Create a smart view with filters',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Name of the smart view' },
        description: { type: 'string', description: 'Description of the smart view' },
        filters: { type: 'string', description: 'JSON filter configuration' },
      },
      required: ['name'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'search_tasks',
    description: 'Full-text search across all tasks',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query' },
        limit: { type: 'string', description: 'Maximum number of results (default 20)' },
      },
      required: ['query'],
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'list_projects',
    description: 'List all projects accessible to this agent',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
];
