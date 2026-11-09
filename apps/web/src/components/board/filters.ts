/**
 * Board filters. The task list API filters on one assignee, one label and one
 * priority; everything else (several values, due dates) is applied here. The
 * client pass always runs, so sending a value to the API is only an
 * optimisation and both stay consistent.
 */
import type { TaskPriority } from '@flowtask/shared';
import type { TaskListFilters } from '../../api/types';

export type DueFilter = 'overdue' | 'week' | 'none';

export interface BoardFilters {
  assigneeIds: string[];
  priorities: TaskPriority[];
  labelIds: string[];
  due: DueFilter[];
}

export const EMPTY_FILTERS: BoardFilters = {
  assigneeIds: [],
  priorities: [],
  labelIds: [],
  due: [],
};

export type FilterDimension = keyof BoardFilters;

export const DUE_LABELS: Record<DueFilter, string> = {
  overdue: 'Overdue',
  week: 'Due in 7 days',
  none: 'No due date',
};

export const PRIORITY_LABELS: Record<TaskPriority, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No priority',
};

export const PRIORITY_VALUES: readonly TaskPriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

export function hasActiveBoardFilters(filters: BoardFilters): boolean {
  return (
    filters.assigneeIds.length +
      filters.priorities.length +
      filters.labelIds.length +
      filters.due.length >
    0
  );
}

/** The part the API can apply (single values only). */
export function toApiFilters(filters: BoardFilters): TaskListFilters {
  // Sub-tasks live under their parent (detail view + progress chip), never as board cards.
  const api: TaskListFilters = { parentId: 'none' };
  if (filters.assigneeIds.length === 1) api.assigneeId = filters.assigneeIds[0];
  if (filters.labelIds.length === 1) api.labelId = filters.labelIds[0];
  // The API's priority=none matches nothing useful for null priorities; filter it here.
  if (filters.priorities.length === 1 && filters.priorities[0] !== 'none')
    api.priority = filters.priorities[0];
  return api;
}

export interface FilterableTask {
  parentId?: string | null;
  priority: string | null;
  dueDate: string | null;
  state: { category?: string } | null;
  assignees: { id: string }[];
  labels: { id: string }[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function startOfDay(now: Date): number {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Due before today and not done. */
export function isOverdue(
  task: Pick<FilterableTask, 'dueDate' | 'state'>,
  now: Date = new Date()
): boolean {
  if (!task.dueDate || task.state?.category === 'done') return false;
  const due = Date.parse(task.dueDate);
  return !Number.isNaN(due) && due < startOfDay(now);
}

function matchesDue(task: FilterableTask, due: DueFilter, now: Date): boolean {
  if (due === 'none') return !task.dueDate;
  if (due === 'overdue') return isOverdue(task, now);
  if (!task.dueDate) return false;
  const time = Date.parse(task.dueDate);
  const today = startOfDay(now);
  return time >= today && time < today + 8 * DAY_MS;
}

export function matchesBoardFilters(
  task: FilterableTask,
  filters: BoardFilters,
  now: Date = new Date()
): boolean {
  if (
    filters.assigneeIds.length > 0 &&
    !task.assignees.some((a) => filters.assigneeIds.includes(a.id))
  )
    return false;
  if (filters.labelIds.length > 0 && !task.labels.some((l) => filters.labelIds.includes(l.id)))
    return false;
  if (filters.priorities.length > 0) {
    const priority = task.priority ?? 'none';
    if (!filters.priorities.some((p) => p === priority)) return false;
  }
  if (filters.due.length > 0 && !filters.due.some((d) => matchesDue(task, d, now))) return false;
  return true;
}

export function applyBoardFilters<T extends FilterableTask>(
  tasks: T[],
  filters: BoardFilters,
  now: Date = new Date()
): T[] {
  // Sub-tasks can still reach the cache (realtime patches, smart-view results): keep them off the board.
  const topLevel = tasks.filter(isTopLevel);
  if (!hasActiveBoardFilters(filters)) return topLevel;
  return topLevel.filter((task) => matchesBoardFilters(task, filters, now));
}

export function isTopLevel(task: { parentId?: string | null }): boolean {
  return task.parentId == null;
}

export function toggleValue<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value];
}

export function clearDimension(filters: BoardFilters, dimension: FilterDimension): BoardFilters {
  switch (dimension) {
    case 'assigneeIds':
      return { ...filters, assigneeIds: [] };
    case 'priorities':
      return { ...filters, priorities: [] };
    case 'labelIds':
      return { ...filters, labelIds: [] };
    case 'due':
      return { ...filters, due: [] };
  }
}

export interface FilterChip {
  dimension: FilterDimension;
  label: string;
}

/** One removable chip per active dimension, e.g. "Assignee: me", "Priority: High, Urgent". */
export function describeFilters(
  filters: BoardFilters,
  names: {
    currentUserId?: string | null;
    members: Map<string, string>;
    labels: Map<string, string>;
  }
): FilterChip[] {
  const chips: FilterChip[] = [];
  if (filters.assigneeIds.length > 0) {
    const values = filters.assigneeIds.map((id) =>
      id === names.currentUserId ? 'me' : (names.members.get(id) ?? 'Unknown')
    );
    chips.push({ dimension: 'assigneeIds', label: `Assignee: ${values.join(', ')}` });
  }
  if (filters.priorities.length > 0) {
    chips.push({
      dimension: 'priorities',
      label: `Priority: ${filters.priorities.map((p) => PRIORITY_LABELS[p]).join(', ')}`,
    });
  }
  if (filters.labelIds.length > 0) {
    chips.push({
      dimension: 'labelIds',
      label: `Label: ${filters.labelIds.map((id) => names.labels.get(id) ?? 'Unknown').join(', ')}`,
    });
  }
  if (filters.due.length > 0) {
    chips.push({
      dimension: 'due',
      label: `Due: ${filters.due.map((d) => DUE_LABELS[d]).join(', ')}`,
    });
  }
  return chips;
}
