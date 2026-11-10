import {
  FilterEngine,
  type SmartViewWithRelations,
  type TaskListOptions,
} from '../../domain/index.js';
import { FilterGroupSchema, SortOrderSchema, type FilterGroup } from '@flowtask/shared';
import { ToolExecutionError } from '../../lib/mcp/errors.js';
import { formatZodIssues } from '../../lib/mcp/json-schema-zod.js';
import {
  optionalBoolean,
  optionalInteger,
  optionalRecord,
  optionalString,
  requiredString,
  resolveMcpWriteReturnMode,
} from '../../lib/mcp/tool-args.js';
import {
  formatWriteCommentResult,
  projectComment,
  projectTaskList,
  resolveTaskProjectionArgs,
  untrusted,
  type ToolOutput,
} from '../../lib/mcp/response-shaping.js';
import { nextCursorFor, pageNumber, resolvePageWindow } from '../../lib/mcp/cursor.js';
import type { ToolContext } from '../../lib/mcp/tool-context.js';
import type { ToolHandler } from './types.js';
import { unwrap } from './task-tools.js';

// ---------- projects, members, labels ----------

const listProjects: ToolHandler = async (_args, ctx) => {
  const projects = (await ctx.accessibleProjects()).filter((project) => !project.isArchived);
  return {
    projects: projects.map((project) => ({
      id: project.id,
      name: project.name,
      identifier: project.identifier,
      taskCount: project.taskCount,
      states: project.taskStates.map((state) => ({
        id: state.id,
        name: state.name,
        category: state.category,
      })),
    })),
  };
};

const listMembers: ToolHandler = async (args, ctx) => {
  const window = resolvePageWindow({
    limit: optionalInteger(args, 'limit'),
    cursor: optionalString(args, 'cursor'),
  });
  const search = optionalString(args, 'search')?.trim().toLowerCase();
  const members = (await ctx.members())
    .filter(
      (member) =>
        !search ||
        member.email.toLowerCase().includes(search) ||
        (member.name ?? '').toLowerCase().includes(search)
    )
    .sort((a, b) => (a.name ?? a.email).localeCompare(b.name ?? b.email));

  const page = members.slice(window.offset, window.offset + window.limit);
  const nextCursor = nextCursorFor(window, members.length);
  return {
    total: members.length,
    members: page.map((member) => ({
      id: member.id,
      name: member.name,
      email: member.email,
      role: member.role,
      isYou: member.id === ctx.userId,
    })),
    ...(nextCursor ? { nextCursor } : {}),
  };
};

const listLabels: ToolHandler = async (args, ctx) => {
  const projectId = optionalString(args, 'projectId');
  const projects = projectId
    ? [await ctx.requireProject(projectId)]
    : await ctx.accessibleProjects();
  return {
    labels: projects.flatMap((project) =>
      project.labels.map((label) => ({
        id: label.id,
        name: label.name,
        color: label.color,
        projectId: project.id,
      }))
    ),
  };
};

const createLabel: ToolHandler = async (args, ctx, services) => {
  const project = await ctx.requireProject(requiredString(args, 'projectId'));
  const label = unwrap(
    await services.projects.createLabel({
      projectId: project.id,
      name: requiredString(args, 'name'),
      color: optionalString(args, 'color'),
    })
  );
  return {
    ok: true,
    tool: 'create_label',
    label: { id: label.id, name: label.name, color: label.color, projectId: label.projectId },
  };
};

const SUMMARY_SAMPLE_LIMIT = 1000;

const summarizeProject: ToolHandler = async (args, ctx, services) => {
  const project = await ctx.requireProject(requiredString(args, 'projectId'));
  const result = unwrap(
    await services.tasks.list({
      filters: { projectIds: [project.id] },
      limit: SUMMARY_SAMPLE_LIMIT,
    })
  );

  const byState = new Map<string, number>(project.taskStates.map((state) => [state.name, 0]));
  const byPriority = new Map<string, number>();
  for (const task of result.tasks) {
    const stateName = task.state?.name || 'No State';
    byState.set(stateName, (byState.get(stateName) ?? 0) + 1);
    const priority = task.priority || 'none';
    byPriority.set(priority, (byPriority.get(priority) ?? 0) + 1);
  }

  return {
    project: { id: project.id, name: project.name, identifier: project.identifier },
    states: project.taskStates.map((state) => ({
      id: state.id,
      name: state.name,
      category: state.category,
    })),
    statistics: {
      totalTasks: result.total,
      byState: Object.fromEntries(byState),
      byPriority: Object.fromEntries(byPriority),
      ...(result.total > result.tasks.length ? { breakdownSampleSize: result.tasks.length } : {}),
    },
  };
};

// ---------- comments ----------

const addComment: ToolHandler = async (args, ctx, services) => {
  const task = await ctx.requireTask(requiredString(args, 'taskId'));
  const mode = resolveMcpWriteReturnMode(args);
  const comment = unwrap(
    await services.comments.create({
      taskId: task.id,
      content: requiredString(args, 'content'),
      userId: ctx.userId,
      mcpClientId: ctx.mcpClientId,
    })
  );

  return formatWriteCommentResult('add_comment', comment, mode);
};

const listComments: ToolHandler = async (args, ctx, services) => {
  const task = await ctx.requireTask(requiredString(args, 'taskId'));
  const window = resolvePageWindow({
    limit: optionalInteger(args, 'limit'),
    cursor: optionalString(args, 'cursor'),
  });
  const result = unwrap(
    await services.comments.list({ taskId: task.id, page: pageNumber(window), limit: window.limit })
  );
  const nextCursor = nextCursorFor(window, result.total);
  return {
    total: result.total,
    comments: result.comments.map(projectComment),
    ...(nextCursor ? { nextCursor } : {}),
  };
};

// ---------- smart views ----------

function projectSmartView(view: SmartViewWithRelations): ToolOutput {
  return {
    id: view.id,
    name: untrusted(view.name),
    description: untrusted(view.description),
    isPersonal: view.isPersonal,
    filters: view.filters,
    sortBy: view.sortBy,
    sortOrder: view.sortOrder,
    createdBy: view.createdBy,
  };
}

function parseFilterGroup(value: unknown, source: string): FilterGroup {
  const parsed = FilterGroupSchema.safeParse(value);
  if (!parsed.success) {
    throw new ToolExecutionError(
      `${source} is not a valid filter group: ${formatZodIssues(parsed.error)}`,
      'VALIDATION_ERROR'
    );
  }
  return parsed.data;
}

type TaskSortBy = NonNullable<TaskListOptions['sortBy']>;
const TASK_SORT_FIELDS: readonly TaskSortBy[] = [
  'position',
  'created_at',
  'updated_at',
  'due_date',
  'priority',
  'sequence_number',
];

function resolveTaskSortBy(value: string): TaskSortBy {
  return TASK_SORT_FIELDS.find((field) => field === value) ?? 'position';
}

function canSeeSmartView(view: SmartViewWithRelations, ctx: ToolContext): boolean {
  if (view.workspaceId !== ctx.workspaceId) {
    return false;
  }
  return (
    !view.isPersonal ||
    view.createdBy === ctx.userId ||
    view.shares.some((share) => share.sharedWithUserId === ctx.userId)
  );
}

const createSmartView: ToolHandler = async (args, ctx, services) => {
  const rawFilters = optionalRecord(args, 'filters');
  const view = unwrap(
    await services.smartViews.create({
      workspaceId: ctx.workspaceId,
      createdBy: ctx.userId,
      name: requiredString(args, 'name'),
      description: optionalString(args, 'description'),
      filters: rawFilters ? parseFilterGroup(rawFilters, 'filters') : undefined,
      isPersonal: optionalBoolean(args, 'isPersonal'),
    })
  );
  return { ok: true, tool: 'create_smart_view', smartView: projectSmartView(view) };
};

const listSmartViews: ToolHandler = async (_args, ctx, services) => {
  const views = unwrap(
    await services.smartViews.list({
      filters: { workspaceId: ctx.workspaceId, userId: ctx.userId, includeShared: true },
    })
  );
  return { smartViews: views.filter((view) => canSeeSmartView(view, ctx)).map(projectSmartView) };
};

const runSmartView: ToolHandler = async (args, ctx, services) => {
  const projection = resolveTaskProjectionArgs(args);
  const window = resolvePageWindow({
    limit: optionalInteger(args, 'limit'),
    cursor: optionalString(args, 'cursor'),
  });
  const viewResult = await services.smartViews.getById(requiredString(args, 'smartViewId'));
  if (!viewResult.ok || !canSeeSmartView(viewResult.value, ctx)) {
    throw new ToolExecutionError('Smart view not found', 'NOT_FOUND');
  }
  const view = viewResult.value;
  const summary = { id: view.id, name: untrusted(view.name) };

  const projectIds = await ctx.accessibleProjectIds();
  if (projectIds.length === 0) {
    return { smartView: summary, ...projectTaskList([], 0, projection) };
  }

  const filters = parseFilterGroup(view.filters, 'The smart view filter');
  const hasConditions = filters.conditions.length > 0;
  const sortOrder = SortOrderSchema.safeParse(view.sortOrder);

  const result = unwrap(
    await services.tasks.list({
      filters: { projectIds },
      filterSql: hasConditions
        ? FilterEngine.buildWhereClause(filters, FilterEngine.createContext(ctx.userId))
        : null,
      requiredJoins: hasConditions ? FilterEngine.getRequiredJoins(filters) : undefined,
      sortBy: resolveTaskSortBy(view.sortBy),
      sortOrder: sortOrder.success ? sortOrder.data : 'asc',
      page: pageNumber(window),
      limit: window.limit,
    })
  );

  return {
    smartView: summary,
    ...projectTaskList(result.tasks, result.total, projection, nextCursorFor(window, result.total)),
  };
};

export const WORKSPACE_TOOL_HANDLERS = {
  list_projects: listProjects,
  list_members: listMembers,
  list_labels: listLabels,
  create_label: createLabel,
  summarize_project: summarizeProject,
  add_comment: addComment,
  list_comments: listComments,
  create_smart_view: createSmartView,
  list_smart_views: listSmartViews,
  run_smart_view: runSmartView,
} satisfies Record<string, ToolHandler>;
