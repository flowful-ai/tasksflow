import type { AgentTool } from '@flowtask/shared';

/**
 * MCP / in-app agent tool registry. `parameters` and `outputSchema` are plain
 * JSON Schema (a small subset) so they can be served to MCP clients as-is and
 * turned into Zod validators by the runtime.
 */

export type ToolJsonType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'object'
  | 'array'
  | 'null';

export interface ToolParameterSchema {
  /** Omitted = any JSON value. An array allows several types (e.g. ['string', 'null']). */
  type?: ToolJsonType | ToolJsonType[];
  description?: string;
  enum?: string[];
  properties?: Record<string, ToolParameterSchema>;
  required?: string[];
  items?: ToolParameterSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  default?: string | number | boolean;
  /** Only 'uuid' is enforced by the runtime validator. */
  format?: 'uuid';
  additionalProperties?: boolean;
}

export interface ToolObjectSchema extends ToolParameterSchema {
  type: 'object';
  properties: Record<string, ToolParameterSchema>;
  required: string[];
}

export interface ToolAnnotations {
  title?: string;
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDefinition {
  name: AgentTool;
  description: string;
  parameters: ToolObjectSchema;
  outputSchema: ToolObjectSchema;
  annotations: ToolAnnotations;
}

/** Key under which user-authored or GitHub-synced text is returned to the model. */
export const UNTRUSTED_TEXT_KEY = 'untrusted_text';

export const MAX_LIST_LIMIT = 50;
export const DEFAULT_LIST_LIMIT = 10;
export const MAX_BULK_ITEMS = 50;

// ---------- Shared parameter fragments ----------

const PRIORITY: ToolParameterSchema = {
  type: 'string',
  enum: ['urgent', 'high', 'medium', 'low', 'none'],
  description: 'Task priority',
};

const PROJECT_ID: ToolParameterSchema = {
  type: 'string',
  format: 'uuid',
  description: 'Project id (uuid) from list_projects',
};

const TASK_REF: ToolParameterSchema = {
  type: 'string',
  description:
    'Task id (uuid) or task key such as "ENG-123" (project identifier + number) from query_tasks/search_tasks',
};

const TASK_REF_DESCRIPTION = 'id (uuid) or key such as "ENG-123"';

const PARENT_ID_CREATE: ToolParameterSchema = {
  type: 'string',
  description: `Parent task ${TASK_REF_DESCRIPTION}; creates a sub-task (same project)`,
};

const PARENT_ID_UPDATE: ToolParameterSchema = {
  type: ['string', 'null'],
  description: `Parent task ${TASK_REF_DESCRIPTION} (same project); null detaches the sub-task`,
};

const RELATION_TYPE: ToolParameterSchema = {
  type: 'string',
  enum: ['blocks', 'relates', 'duplicates'],
  description: 'Relation type',
};

const RELATION_DIRECTION: ToolParameterSchema = {
  type: 'string',
  enum: ['outgoing', 'incoming'],
  description:
    'For blocks/duplicates: outgoing (default) = taskId blocks/duplicates relatedTaskId, incoming = the reverse',
};

const STATE_ID: ToolParameterSchema = {
  type: 'string',
  format: 'uuid',
  description:
    "State id (uuid) from list_projects (states[].id); must belong to the task's project",
};

const LABEL_IDS: ToolParameterSchema = {
  type: 'array',
  items: { type: 'string', format: 'uuid', description: 'Label id (uuid) from list_labels' },
  maxItems: 20,
  description: "Label ids from list_labels for the task's project",
};

const USER_REF_DESCRIPTION = '"me", a workspace member email, or a user id from list_members';

const ASSIGNEE_IDS: ToolParameterSchema = {
  type: 'array',
  items: { type: 'string', description: `Assignee: ${USER_REF_DESCRIPTION}` },
  maxItems: 20,
  description: `Assignees, each ${USER_REF_DESCRIPTION}`,
};

const TITLE: ToolParameterSchema = {
  type: 'string',
  minLength: 1,
  maxLength: 500,
  description: 'Task title',
};
const DESCRIPTION: ToolParameterSchema = {
  type: 'string',
  maxLength: 50000,
  description: 'Task description (Markdown)',
};

const DUE_DATE_CREATE: ToolParameterSchema = {
  type: 'string',
  description: 'Due date as YYYY-MM-DD or an ISO 8601 datetime',
};

const DUE_DATE_UPDATE: ToolParameterSchema = {
  type: ['string', 'null'],
  description: 'Due date as YYYY-MM-DD or an ISO 8601 datetime; null clears it',
};

const VIEW: ToolParameterSchema = {
  type: 'string',
  enum: ['compact', 'full', 'custom'],
  description: 'Projection: compact (default), full, or custom (with fields)',
};

const RETURN_MODE: ToolParameterSchema = {
  type: 'string',
  enum: ['ack', 'compact', 'full'],
  description: 'Response size: ack (default, id only), compact or full task',
};

const FIELDS: ToolParameterSchema = {
  type: 'array',
  items: { type: 'string', description: 'Task field name, e.g. id, title, stateId, assignees' },
  description: 'Fields to return; required only when view=custom',
};

const INCLUDE_ASSIGNEES: ToolParameterSchema = {
  type: 'boolean',
  description: 'Include assignees only if needed',
};
const INCLUDE_LABELS: ToolParameterSchema = {
  type: 'boolean',
  description: 'Include labels only if needed',
};
const INCLUDE_EXTERNAL_LINKS: ToolParameterSchema = {
  type: 'boolean',
  description: 'Include linked GitHub issues/PRs only if needed',
};

const LIMIT: ToolParameterSchema = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_LIST_LIMIT,
  default: DEFAULT_LIST_LIMIT,
  description: `Page size, ${DEFAULT_LIST_LIMIT} by default, at most ${MAX_LIST_LIMIT}`,
};

const CURSOR: ToolParameterSchema = {
  type: 'string',
  description:
    'Opaque nextCursor from a previous page of the same query; when set, limit is taken from the cursor',
};

const PROJECTION_PARAMS: Record<string, ToolParameterSchema> = {
  view: VIEW,
  fields: FIELDS,
  includeAssignees: INCLUDE_ASSIGNEES,
  includeLabels: INCLUDE_LABELS,
  includeExternalLinks: INCLUDE_EXTERNAL_LINKS,
};

const FILTER_FIELDS = [
  'id',
  'project_id',
  'state_id',
  'title',
  'description',
  'priority',
  'due_date',
  'start_date',
  'created_at',
  'updated_at',
  'created_by',
  'sequence_number',
  'state.category',
  'state.name',
  'assignee_id',
  'label_id',
];

const FILTER_GROUP: ToolParameterSchema = {
  type: 'object',
  description:
    'Filter group. Values may use templates such as "{{current_user}}" or "{{now + 7d}}". Example: {"operator":"AND","conditions":[{"field":"assignee_id","op":"eq","value":"{{current_user}}"}]}',
  properties: {
    operator: { type: 'string', enum: ['AND', 'OR'], description: 'How conditions combine' },
    conditions: {
      type: 'array',
      maxItems: 50,
      description: 'Conditions (one level; nest by creating several views)',
      items: {
        type: 'object',
        description: 'One condition: {field, op, value}',
        properties: {
          field: { type: 'string', enum: FILTER_FIELDS, description: 'Task field to filter on' },
          op: {
            type: 'string',
            enum: [
              'eq',
              'neq',
              'gt',
              'gte',
              'lt',
              'lte',
              'in',
              'nin',
              'contains',
              'not_contains',
              'starts_with',
              'ends_with',
              'is_null',
              'is_not_null',
            ],
            description: 'Comparison operator',
          },
          value: {
            type: ['string', 'number', 'boolean', 'array', 'null'],
            items: { type: 'string', description: 'One value for in/nin' },
            description:
              'Comparison value; an array for in/nin; omit or null for is_null/is_not_null',
          },
        },
        required: ['field', 'op'],
        additionalProperties: false,
      },
    },
  },
  required: ['operator', 'conditions'],
  additionalProperties: false,
};

function params(
  properties: Record<string, ToolParameterSchema>,
  required: string[] = []
): ToolObjectSchema {
  return { type: 'object', properties, required, additionalProperties: false };
}

// ---------- Output schemas ----------

const UNTRUSTED_TEXT_NOTE = `user-authored text is wrapped as {"${UNTRUSTED_TEXT_KEY}": "..."}`;

const TASK_OUTPUT: ToolParameterSchema = {
  type: 'object',
  description: `Projected task; ${UNTRUSTED_TEXT_NOTE}`,
};

const TASK_LIST_OUTPUT: ToolObjectSchema = {
  type: 'object',
  properties: {
    total: { type: 'integer', description: 'Total matching tasks' },
    tasks: { type: 'array', items: TASK_OUTPUT, description: 'This page of tasks' },
    nextCursor: { type: 'string', description: 'Pass as cursor to fetch the next page' },
  },
  required: ['total', 'tasks'],
};

const WRITE_TASK_OUTPUT: ToolObjectSchema = {
  type: 'object',
  properties: {
    ok: { type: 'boolean', description: 'Always true on success' },
    tool: { type: 'string', description: 'Tool that produced the result' },
    id: { type: 'string', description: 'Task id (ack mode)' },
    task: TASK_OUTPUT,
  },
  required: ['ok', 'tool'],
};

const OBJECT_ARRAY = (description: string): ToolParameterSchema => ({
  type: 'array',
  items: { type: 'object', description },
  description,
});

function output(
  properties: Record<string, ToolParameterSchema>,
  required: string[]
): ToolObjectSchema {
  return { type: 'object', properties, required };
}

// ---------- Tools ----------

export const AGENT_TOOLS: ToolDefinition[] = [
  {
    name: 'create_task',
    description:
      'Create a task in a project. Get projectId, stateId and label ids from list_projects/list_labels.',
    parameters: params(
      {
        projectId: PROJECT_ID,
        title: TITLE,
        description: DESCRIPTION,
        priority: PRIORITY,
        stateId: {
          ...STATE_ID,
          description: `${STATE_ID.description}; defaults to the first backlog state`,
        },
        parentId: PARENT_ID_CREATE,
        dueDate: DUE_DATE_CREATE,
        labelIds: LABEL_IDS,
        assigneeIds: ASSIGNEE_IDS,
        autoAssign: {
          type: 'boolean',
          description: 'Also assign the task to the authenticated user',
        },
        return: RETURN_MODE,
      },
      ['projectId', 'title']
    ),
    outputSchema: WRITE_TASK_OUTPUT,
    annotations: {
      title: 'Create task',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'bulk_create_tasks',
    description: `Create up to ${MAX_BULK_ITEMS} tasks in one project. Failures are reported per item.`,
    parameters: params(
      {
        projectId: PROJECT_ID,
        tasks: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_BULK_ITEMS,
          description: 'Tasks to create',
          items: {
            type: 'object',
            description: 'One task to create',
            properties: {
              title: TITLE,
              description: DESCRIPTION,
              priority: PRIORITY,
              stateId: STATE_ID,
              parentId: PARENT_ID_CREATE,
              dueDate: DUE_DATE_CREATE,
              labelIds: LABEL_IDS,
              assigneeIds: ASSIGNEE_IDS,
            },
            required: ['title'],
            additionalProperties: false,
          },
        },
        return: RETURN_MODE,
      },
      ['projectId', 'tasks']
    ),
    outputSchema: output(
      {
        ok: { type: 'boolean', description: 'True when the call ran (check failed[])' },
        tool: { type: 'string', description: 'Tool name' },
        createdIds: {
          type: 'array',
          items: { type: 'string', description: 'Created task id' },
          description: 'Created task ids (ack mode)',
        },
        tasks: {
          type: 'array',
          items: TASK_OUTPUT,
          description: 'Created tasks (compact/full mode)',
        },
        failed: OBJECT_ARRAY('Items that failed: {index, error}'),
      },
      ['ok', 'tool', 'failed']
    ),
    annotations: {
      title: 'Bulk create tasks',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'update_task',
    description:
      'Update task fields. labelIds/assigneeIds replace the current set. Linking a GitHub PR (githubPr*) calls GitHub.',
    parameters: params(
      {
        taskId: TASK_REF,
        title: TITLE,
        description: DESCRIPTION,
        priority: PRIORITY,
        stateId: STATE_ID,
        parentId: PARENT_ID_UPDATE,
        dueDate: DUE_DATE_UPDATE,
        labelIds: {
          ...LABEL_IDS,
          description: `${LABEL_IDS.description}; replaces existing labels`,
        },
        assigneeIds: {
          ...ASSIGNEE_IDS,
          description: `${ASSIGNEE_IDS.description}; replaces existing assignees`,
        },
        githubPrOwner: {
          type: 'string',
          description:
            'GitHub owner of a pull request to link (with githubPrRepo and githubPrNumber)',
        },
        githubPrRepo: {
          type: 'string',
          description: 'GitHub repository name of the pull request to link',
        },
        githubPrNumber: { type: 'integer', minimum: 1, description: 'Pull request number to link' },
        return: RETURN_MODE,
      },
      ['taskId']
    ),
    outputSchema: WRITE_TASK_OUTPUT,
    annotations: {
      title: 'Update task',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
  },
  {
    name: 'bulk_update_tasks',
    description: `Apply updates to up to ${MAX_BULK_ITEMS} tasks. Each update is applied independently and reported per task.`,
    parameters: params(
      {
        updates: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_BULK_ITEMS,
          description: 'One entry per task',
          items: {
            type: 'object',
            description: 'Changes for one task; omitted fields are left unchanged',
            properties: {
              taskId: TASK_REF,
              title: TITLE,
              description: DESCRIPTION,
              priority: PRIORITY,
              stateId: STATE_ID,
              parentId: PARENT_ID_UPDATE,
              dueDate: DUE_DATE_UPDATE,
              labelIds: {
                ...LABEL_IDS,
                description: `${LABEL_IDS.description}; replaces existing labels`,
              },
              assigneeIds: {
                ...ASSIGNEE_IDS,
                description: `${ASSIGNEE_IDS.description}; replaces existing assignees`,
              },
            },
            required: ['taskId'],
            additionalProperties: false,
          },
        },
      },
      ['updates']
    ),
    outputSchema: output(
      {
        ok: { type: 'boolean', description: 'True when every update succeeded' },
        tool: { type: 'string', description: 'Tool name' },
        updated: { type: 'integer', description: 'Number of tasks updated' },
        failed: { type: 'integer', description: 'Number of updates that failed' },
        results: OBJECT_ARRAY('Per-task result: {taskId, ok, id?, error?}'),
      },
      ['ok', 'tool', 'updated', 'failed', 'results']
    ),
    annotations: {
      title: 'Bulk update tasks',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'delete_task',
    description: 'Delete a task (soft delete).',
    parameters: params({ taskId: TASK_REF }, ['taskId']),
    outputSchema: output(
      {
        deleted: { type: 'boolean', description: 'True when the task was deleted' },
        taskId: { type: 'string', description: 'Deleted task id' },
      },
      ['deleted', 'taskId']
    ),
    annotations: {
      title: 'Delete task',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'query_tasks',
    description:
      'List/filter tasks across the projects you can access. Use assigneeId="me" for my tasks; search_tasks for keywords.',
    parameters: params({
      projectId: {
        ...PROJECT_ID,
        description: `${PROJECT_ID.description}; omit to search all accessible projects`,
      },
      stateId: STATE_ID,
      priority: PRIORITY,
      assigneeId: { type: 'string', description: `Assignee: ${USER_REF_DESCRIPTION}` },
      labelId: { type: 'string', format: 'uuid', description: 'Label id (uuid) from list_labels' },
      parentId: {
        type: 'string',
        description: `Parent task ${TASK_REF_DESCRIPTION}: only its sub-tasks; "none" for top-level tasks only`,
      },
      search: {
        type: 'string',
        maxLength: 200,
        description: 'Text that must appear in title or description',
      },
      limit: LIMIT,
      cursor: CURSOR,
      ...PROJECTION_PARAMS,
    }),
    outputSchema: TASK_LIST_OUTPUT,
    annotations: { title: 'Query tasks', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'get_task',
    description:
      'Get one task by id or key (detail-on-demand after query/search). view=full adds parent, sub-tasks and relations.',
    parameters: params({ taskId: TASK_REF, ...PROJECTION_PARAMS }, ['taskId']),
    outputSchema: output({ task: TASK_OUTPUT }, ['task']),
    annotations: { title: 'Get task', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'move_task',
    description:
      'Move a task to another state (column), placing it at the end. Give stateId, or state as a state name or category.',
    parameters: params(
      {
        taskId: TASK_REF,
        stateId: STATE_ID,
        state: {
          type: 'string',
          description:
            'Target state name (e.g. "In Progress") or category (backlog, in_progress, done) when stateId is unknown',
        },
        return: RETURN_MODE,
      },
      ['taskId']
    ),
    outputSchema: WRITE_TASK_OUTPUT,
    annotations: {
      title: 'Move task',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'assign_task',
    description: 'Assign or unassign one workspace member on a task.',
    parameters: params(
      {
        taskId: TASK_REF,
        userId: { type: 'string', description: `User to (un)assign: ${USER_REF_DESCRIPTION}` },
        action: { type: 'string', enum: ['assign', 'unassign'], description: 'assign or unassign' },
        return: RETURN_MODE,
      },
      ['taskId', 'userId', 'action']
    ),
    outputSchema: WRITE_TASK_OUTPUT,
    annotations: {
      title: 'Assign task',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'add_comment',
    description: 'Add a Markdown comment to a task.',
    parameters: params(
      {
        taskId: TASK_REF,
        content: {
          type: 'string',
          minLength: 1,
          maxLength: 20000,
          description: 'Comment body (Markdown)',
        },
        return: RETURN_MODE,
      },
      ['taskId', 'content']
    ),
    outputSchema: output(
      {
        ok: { type: 'boolean', description: 'Always true on success' },
        tool: { type: 'string', description: 'Tool name' },
        id: { type: 'string', description: 'Comment id' },
        comment: { type: 'object', description: `Comment; ${UNTRUSTED_TEXT_NOTE}` },
      },
      ['ok', 'tool']
    ),
    annotations: {
      title: 'Add comment',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'list_comments',
    description: 'List comments on a task, newest first.',
    parameters: params({ taskId: TASK_REF, limit: LIMIT, cursor: CURSOR }, ['taskId']),
    outputSchema: output(
      {
        total: { type: 'integer', description: 'Total comments on the task' },
        comments: OBJECT_ARRAY(`Comments; ${UNTRUSTED_TEXT_NOTE}`),
        nextCursor: { type: 'string', description: 'Pass as cursor to fetch the next page' },
      },
      ['total', 'comments']
    ),
    annotations: { title: 'List comments', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'summarize_project',
    description: 'Summarize a project: states and task counts by state and priority.',
    parameters: params({ projectId: PROJECT_ID }, ['projectId']),
    outputSchema: output(
      {
        project: { type: 'object', description: 'Project id, name and identifier' },
        states: OBJECT_ARRAY('Project states'),
        statistics: { type: 'object', description: 'totalTasks plus byState/byPriority counts' },
      },
      ['project', 'states', 'statistics']
    ),
    annotations: { title: 'Summarize project', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'create_smart_view',
    description: 'Create a saved smart view (filtered task list) in the workspace.',
    parameters: params(
      {
        name: { type: 'string', minLength: 1, maxLength: 100, description: 'View name' },
        description: { type: 'string', maxLength: 1000, description: 'View description' },
        filters: FILTER_GROUP,
        isPersonal: {
          type: 'boolean',
          description: 'Only visible to you when true (default false)',
        },
      },
      ['name']
    ),
    outputSchema: output(
      {
        ok: { type: 'boolean', description: 'Always true on success' },
        tool: { type: 'string', description: 'Tool name' },
        smartView: { type: 'object', description: `Created view; ${UNTRUSTED_TEXT_NOTE}` },
      },
      ['ok', 'tool', 'smartView']
    ),
    annotations: {
      title: 'Create smart view',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  {
    name: 'list_smart_views',
    description: 'List smart views you can see in the workspace; run one with run_smart_view.',
    parameters: params({}),
    outputSchema: output({ smartViews: OBJECT_ARRAY(`Smart views; ${UNTRUSTED_TEXT_NOTE}`) }, [
      'smartViews',
    ]),
    annotations: { title: 'List smart views', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'run_smart_view',
    description: 'Run a smart view and return its tasks (limited to projects you can access).',
    parameters: params(
      {
        smartViewId: {
          type: 'string',
          format: 'uuid',
          description: 'Smart view id (uuid) from list_smart_views',
        },
        limit: LIMIT,
        cursor: CURSOR,
        ...PROJECTION_PARAMS,
      },
      ['smartViewId']
    ),
    outputSchema: output(
      {
        smartView: { type: 'object', description: 'The view that ran (id and name)' },
        total: { type: 'integer', description: 'Total matching tasks' },
        tasks: { type: 'array', items: TASK_OUTPUT, description: 'This page of tasks' },
        nextCursor: { type: 'string', description: 'Pass as cursor to fetch the next page' },
      },
      ['smartView', 'total', 'tasks']
    ),
    annotations: { title: 'Run smart view', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'search_tasks',
    description:
      'Keyword search over task titles and descriptions; use query_tasks for structured filters.',
    parameters: params(
      {
        query: { type: 'string', minLength: 1, maxLength: 200, description: 'Keywords' },
        projectId: {
          ...PROJECT_ID,
          description: `${PROJECT_ID.description}; omit to search all accessible projects`,
        },
        limit: LIMIT,
        cursor: CURSOR,
        ...PROJECTION_PARAMS,
      },
      ['query']
    ),
    outputSchema: TASK_LIST_OUTPUT,
    annotations: { title: 'Search tasks', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_projects',
    description: 'List projects you can access, with their identifiers (for task keys) and states.',
    parameters: params({}),
    outputSchema: output(
      { projects: OBJECT_ARRAY('Projects with id, name, identifier and states') },
      ['projects']
    ),
    annotations: { title: 'List projects', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_members',
    description: 'List workspace members (ids and emails for assigneeIds/userId).',
    parameters: params({
      search: {
        type: 'string',
        maxLength: 100,
        description: 'Filter by name or email (case-insensitive)',
      },
      limit: LIMIT,
      cursor: CURSOR,
    }),
    outputSchema: output(
      {
        total: { type: 'integer', description: 'Total matching members' },
        members: OBJECT_ARRAY('Members: {id, name, email, role}'),
        nextCursor: { type: 'string', description: 'Pass as cursor to fetch the next page' },
      },
      ['total', 'members']
    ),
    annotations: { title: 'List members', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'list_labels',
    description:
      'List labels of a project, or of every accessible project when projectId is omitted.',
    parameters: params({
      projectId: {
        ...PROJECT_ID,
        description: `${PROJECT_ID.description}; omit for all accessible projects`,
      },
    }),
    outputSchema: output({ labels: OBJECT_ARRAY('Labels: {id, name, color, projectId}') }, [
      'labels',
    ]),
    annotations: { title: 'List labels', readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'link_tasks',
    description:
      'Relate two tasks: blocks, relates or duplicates. Tasks may be in different projects of the workspace.',
    parameters: params(
      {
        taskId: TASK_REF,
        relatedTaskId: { ...TASK_REF, description: `Related task ${TASK_REF_DESCRIPTION}` },
        type: RELATION_TYPE,
        direction: RELATION_DIRECTION,
      },
      ['taskId', 'relatedTaskId', 'type']
    ),
    outputSchema: output(
      {
        ok: { type: 'boolean', description: 'Always true on success' },
        tool: { type: 'string', description: 'Tool name' },
        relation: {
          type: 'object',
          description: `Relation seen from taskId: {id, type, direction, task}; ${UNTRUSTED_TEXT_NOTE}`,
        },
      },
      ['ok', 'tool', 'relation']
    ),
    annotations: {
      title: 'Link tasks',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'unlink_tasks',
    description:
      'Remove a relation between two tasks. Give relationId (from get_task view=full or link_tasks), or relatedTaskId and type.',
    parameters: params(
      {
        taskId: TASK_REF,
        relationId: {
          type: 'string',
          format: 'uuid',
          description: 'Relation id (uuid) from get_task (view=full) relations[].id or link_tasks',
        },
        relatedTaskId: { ...TASK_REF, description: `Related task ${TASK_REF_DESCRIPTION}` },
        type: { ...RELATION_TYPE, description: 'Relation type (with relatedTaskId)' },
        direction: {
          ...RELATION_DIRECTION,
          description: `${RELATION_DIRECTION.description}; only needed when both directions exist`,
        },
      },
      ['taskId']
    ),
    outputSchema: output(
      {
        ok: { type: 'boolean', description: 'Always true on success' },
        tool: { type: 'string', description: 'Tool name' },
        relationId: { type: 'string', description: 'Removed relation id' },
      },
      ['ok', 'tool', 'relationId']
    ),
    annotations: {
      title: 'Unlink tasks',
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  {
    name: 'create_label',
    description: 'Create a label in a project; use its id in labelIds.',
    parameters: params(
      {
        projectId: PROJECT_ID,
        name: { type: 'string', minLength: 1, maxLength: 50, description: 'Label name' },
        color: { type: 'string', description: 'Label color, e.g. "#ef4444"' },
      },
      ['projectId', 'name']
    ),
    outputSchema: output(
      {
        ok: { type: 'boolean', description: 'Always true on success' },
        tool: { type: 'string', description: 'Tool name' },
        label: { type: 'object', description: 'Created label: {id, name, color, projectId}' },
      },
      ['ok', 'tool', 'label']
    ),
    annotations: {
      title: 'Create label',
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
];

/** Tools that change data; the in-app chat asks the user before running them. */
export function isMutatingTool(tool: ToolDefinition): boolean {
  return tool.annotations.readOnlyHint !== true;
}
