import type { Agent } from '@flowtask/database';
import type { CreateAgent, UpdateAgent, AgentTool, AIModel, AgentExecution, RunAgent, ApiKeyProvider } from '@flowtask/shared';

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
  workspaceId: string;
  provider: ApiKeyProvider;
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

interface ToolParameterSchema {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'object' | 'array' | 'null';
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  items?: ToolParameterSchema;
}

// Tool definitions for MCP
export interface ToolDefinition {
  name: AgentTool;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameterSchema>;
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

const TASK_PRIORITY_PARAMETER: ToolParameterSchema = {
  type: 'string',
  enum: ['urgent', 'high', 'medium', 'low', 'none'],
};

const VIEW_PARAMETER: ToolParameterSchema = {
  type: 'string',
  description: 'compact|full|custom; use custom with fields',
  enum: ['compact', 'full', 'custom'],
};

const RETURN_PARAMETER: ToolParameterSchema = {
  type: 'string',
  description: 'ack by default; compact/full only when needed',
  enum: ['ack', 'compact', 'full'],
};

const FIELDS_PARAMETER: ToolParameterSchema = {
  type: 'array',
  description: 'Required only when view=custom',
  items: { type: 'string' },
};

const INCLUDE_ASSIGNEES_PARAMETER: ToolParameterSchema = { type: 'boolean', description: 'Include assignees only if needed' };
const INCLUDE_LABELS_PARAMETER: ToolParameterSchema = { type: 'boolean', description: 'Include labels only if needed' };
const INCLUDE_EXTERNAL_LINKS_PARAMETER: ToolParameterSchema = { type: 'boolean', description: 'Include external links only if needed' };

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'create_task',
    description: 'Create task',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: TASK_PRIORITY_PARAMETER,
        stateId: { type: 'string' },
        return: RETURN_PARAMETER,
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
    name: 'bulk_create_tasks',
    description: 'Create tasks',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              title: { type: 'string' },
              description: { type: 'string' },
              priority: TASK_PRIORITY_PARAMETER,
              stateId: { type: 'string' },
            },
            required: ['title'],
          },
        },
        return: RETURN_PARAMETER,
      },
      required: ['projectId', 'tasks'],
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'update_task',
    description: 'Update task',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        title: { type: 'string' },
        description: { type: 'string' },
        priority: TASK_PRIORITY_PARAMETER,
        stateId: { type: 'string' },
        githubPrOwner: { type: 'string' },
        githubPrRepo: { type: 'string' },
        githubPrNumber: { type: 'integer' },
        return: RETURN_PARAMETER,
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
    description: 'Delete task',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
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
    description: 'List/filter tasks; use assigneeId="me" for my tasks',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
        stateId: { type: 'string' },
        priority: TASK_PRIORITY_PARAMETER,
        assigneeId: { type: 'string', description: 'Use "me" for current user' },
        search: { type: 'string', description: 'Structured text filter' },
        limit: { type: 'string', description: 'Default 10, max 50' },
        view: VIEW_PARAMETER,
        fields: FIELDS_PARAMETER,
        includeAssignees: INCLUDE_ASSIGNEES_PARAMETER,
        includeLabels: INCLUDE_LABELS_PARAMETER,
        includeExternalLinks: INCLUDE_EXTERNAL_LINKS_PARAMETER,
      },
      required: [],
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'get_task',
    description: 'Get one task (detail-on-demand after query/search)',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        view: VIEW_PARAMETER,
        fields: FIELDS_PARAMETER,
        includeAssignees: INCLUDE_ASSIGNEES_PARAMETER,
        includeLabels: INCLUDE_LABELS_PARAMETER,
        includeExternalLinks: INCLUDE_EXTERNAL_LINKS_PARAMETER,
      },
      required: ['taskId'],
    },
    annotations: {
      readOnlyHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'move_task',
    description: 'Move task to stateId',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        stateId: { type: 'string' },
        return: RETURN_PARAMETER,
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
    description: 'Assign task',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        userId: { type: 'string' },
        action: {
          type: 'string',
          enum: ['assign', 'unassign'],
        },
        return: RETURN_PARAMETER,
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
    description: 'Add comment',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string' },
        content: { type: 'string' },
        return: RETURN_PARAMETER,
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
    description: 'Summarize project',
    parameters: {
      type: 'object',
      properties: {
        projectId: { type: 'string' },
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
    description: 'Create smart view',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        filters: { type: 'string' },
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
    description: 'Keyword search; use query_tasks for structured filters',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keyword query' },
        projectId: { type: 'string' },
        limit: { type: 'string', description: 'Default 10, max 50' },
        view: VIEW_PARAMETER,
        fields: FIELDS_PARAMETER,
        includeAssignees: INCLUDE_ASSIGNEES_PARAMETER,
        includeLabels: INCLUDE_LABELS_PARAMETER,
        includeExternalLinks: INCLUDE_EXTERNAL_LINKS_PARAMETER,
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
    description: 'List projects',
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
