import type { Context } from 'hono';
import { FilterEngine, isValidTimeZone, type TaskService } from '@flowtask/domain';
import { ok, FilterGroupSchema, type FilterCondition, type FilterGroup } from '@flowtask/shared';

export const CURRENT_USER_TEMPLATE = '{{current_user}}';
export const UNSUPPORTED_PUBLIC_FILTER_CODE = 'UNSUPPORTED_PUBLIC_FILTER';
export const UNSUPPORTED_PUBLIC_FILTER_MESSAGE =
  'This view uses "Current user (me)" filters, which are not supported for public shares.';

export const VALID_TASK_SORT_BY = [
  'position',
  'created_at',
  'updated_at',
  'due_date',
  'priority',
  'sequence_number',
] as const;
export const VALID_TASK_SORT_ORDER = ['asc', 'desc'] as const;

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

/** Smart-view execution pages are capped at this many tasks. */
export const SMART_VIEW_MAX_LIMIT = 100;

/**
 * The viewer's IANA timezone from the `X-Timezone` request header, used for
 * day/week/month boundaries and `{{now ± N}}` in filters. Invalid or missing
 * values fall back to UTC.
 */
export function readTimezoneHeader(c: Context): string | undefined {
  const raw = c.req.header('x-timezone')?.trim();
  return raw && raw.length <= 64 && isValidTimeZone(raw) ? raw : undefined;
}

interface ExecuteSmartViewTaskListOptions {
  /** IANA timezone for date templates (see readTimezoneHeader). Defaults to UTC. */
  timezone?: string;
  view: {
    workspaceId: string;
    filters: unknown;
    sortBy: string | null;
    sortOrder: string | null;
  };
  taskService: TaskService;
  /**
   * Projects whose tasks may be returned: the viewer's accessible, non-archived
   * projects in the view's workspace (see AuthorizationService). Never derive
   * this from the workspace alone, or restricted projects leak.
   */
  projectIds: readonly string[];
  filterContextUserId: string;
  page: number;
  limit: number;
}

export function isFilterGroupValue(value: unknown): value is FilterGroup {
  return FilterGroupSchema.safeParse(value).success;
}

export async function executeSmartViewTaskList({
  view,
  taskService,
  projectIds,
  filterContextUserId,
  page,
  limit,
  timezone,
}: ExecuteSmartViewTaskListOptions) {
  const viewFilters = isFilterGroupValue(view.filters) ? view.filters : undefined;
  const filterContext = FilterEngine.createContext(filterContextUserId, { timezone });
  const filterSql = viewFilters?.conditions?.length
    ? FilterEngine.buildWhereClause(viewFilters, filterContext)
    : null;

  const requiredJoins = viewFilters?.conditions?.length
    ? FilterEngine.getRequiredJoins(viewFilters)
    : new Set<'task_states' | 'task_assignees' | 'task_labels'>();

  // No accessible projects means no tasks. Short-circuit to skip the count
  // + select round-trips. (TaskService.list also treats an empty projectIds
  // array as "match nothing", so this is an optimization, not the only guard.)
  if (projectIds.length === 0) {
    return ok({ tasks: [], total: 0 });
  }

  return taskService.list({
    filters: { projectIds: [...projectIds] },
    filterSql,
    requiredJoins,
    sortBy: resolveTaskSortBy(view.sortBy),
    sortOrder: resolveTaskSortOrder(view.sortOrder),
    page: Math.max(1, page),
    limit: Math.min(Math.max(1, limit), SMART_VIEW_MAX_LIMIT),
  });
}
