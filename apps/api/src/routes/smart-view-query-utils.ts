import { FilterEngine, type ProjectService, type TaskService } from '@flowtask/domain';
import type { FilterCondition, FilterGroup } from '@flowtask/shared';

export const CURRENT_USER_TEMPLATE = '{{current_user}}';
export const UNSUPPORTED_PUBLIC_FILTER_CODE = 'UNSUPPORTED_PUBLIC_FILTER';
export const UNSUPPORTED_PUBLIC_FILTER_MESSAGE =
  'This view uses "Current user (me)" filters, which are not supported for public shares.';

const VALID_TASK_SORT_BY = ['position', 'created_at', 'updated_at', 'due_date', 'priority', 'sequence_number'] as const;
const VALID_TASK_SORT_ORDER = ['asc', 'desc'] as const;

type TaskSortBy = (typeof VALID_TASK_SORT_BY)[number];
type TaskSortOrder = (typeof VALID_TASK_SORT_ORDER)[number];

function isFilterGroup(condition: FilterCondition | FilterGroup): condition is FilterGroup {
  return 'operator' in condition && 'conditions' in condition;
}

function valueContainsTemplate(value: unknown, template: string): boolean {
  if (value === template) {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((item) => valueContainsTemplate(item, template));
  }

  if (value && typeof value === 'object') {
    return Object.values(value).some((item) => valueContainsTemplate(item, template));
  }

  return false;
}

export function smartViewUsesCurrentUserTemplate(filters: FilterGroup | null | undefined): boolean {
  if (!filters?.conditions?.length) {
    return false;
  }

  function walk(group: FilterGroup): boolean {
    for (const condition of group.conditions) {
      if (isFilterGroup(condition)) {
        if (walk(condition)) {
          return true;
        }
      } else if (valueContainsTemplate(condition.value, CURRENT_USER_TEMPLATE)) {
        return true;
      }
    }

    return false;
  }

  return walk(filters);
}

function isValidTaskSortBy(value: string): value is TaskSortBy {
  return (VALID_TASK_SORT_BY as readonly string[]).includes(value);
}

function isValidTaskSortOrder(value: string): value is TaskSortOrder {
  return (VALID_TASK_SORT_ORDER as readonly string[]).includes(value);
}

function resolveTaskSortBy(value: string | null): TaskSortBy {
  if (!value) return 'position';
  return isValidTaskSortBy(value) ? value : 'position';
}

function resolveTaskSortOrder(value: string | null): TaskSortOrder {
  if (!value) return 'asc';
  return isValidTaskSortOrder(value) ? value : 'asc';
}

interface ExecuteSmartViewTaskListOptions {
  view: {
    workspaceId: string;
    filters: unknown;
    sortBy: string | null;
    sortOrder: string | null;
  };
  taskService: TaskService;
  projectService: ProjectService;
  filterContextUserId: string;
  page: number;
  limit: number;
}

export async function executeSmartViewTaskList({
  view,
  taskService,
  projectService,
  filterContextUserId,
  page,
  limit,
}: ExecuteSmartViewTaskListOptions) {
  const viewFilters = view.filters as FilterGroup | undefined;
  const filterContext = FilterEngine.createContext(filterContextUserId);
  const filterSql = viewFilters?.conditions?.length ? FilterEngine.buildWhereClause(viewFilters, filterContext) : null;

  const requiredJoins = viewFilters?.conditions?.length
    ? FilterEngine.getRequiredJoins(viewFilters)
    : new Set<'task_states' | 'task_assignees' | 'task_labels'>();

  const projectsResult = await projectService.list({ filters: { workspaceId: view.workspaceId } });
  const projectIds = projectsResult.ok ? projectsResult.value.map((project) => project.id) : [];

  return taskService.list({
    filters: { projectIds },
    filterSql,
    requiredJoins,
    sortBy: resolveTaskSortBy(view.sortBy),
    sortOrder: resolveTaskSortOrder(view.sortOrder),
    page,
    limit,
  });
}
