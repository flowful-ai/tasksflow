import type { TaskCardTask } from './TaskCard';

export type GroupBy = 'state' | 'assignee' | 'project' | 'priority' | 'label' | 'none';

export interface TaskGroup {
  id: string;
  name: string;
  color: string | null;
  category?: string;
  tasks: TaskCardTask[];
}

export interface AvailableState {
  id: string;
  name: string;
  color: string | null;
}

const priorityOrder: Record<string, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

const stateCategoryOrder: Record<string, number> = {
  backlog: 0,
  in_progress: 1,
  done: 2,
};

const categoryLabels: Record<string, string> = {
  backlog: 'Backlog',
  in_progress: 'In Progress',
  done: 'Done',
};

const categoryColors: Record<string, string> = {
  backlog: '#6b7280',
  in_progress: '#3b82f6',
  done: '#22c55e',
};

const priorityLabels: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No Priority',
};

const priorityColors: Record<string, string> = {
  urgent: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#22c55e',
  none: '#6b7280',
};

/**
 * Groups tasks by the specified field
 * @param availableStates - When groupBy is 'state', ensures all states appear even if empty
 * @param mergeStatesByCategory - When true, merge states by their category (backlog, in_progress, done)
 */
export function groupTasks(
  tasks: TaskCardTask[],
  groupBy: GroupBy,
  availableStates?: AvailableState[],
  mergeStatesByCategory?: boolean
): TaskGroup[] {
  if (groupBy === 'none') {
    return [
      {
        id: 'all',
        name: 'All Tasks',
        color: null,
        tasks,
      },
    ];
  }

  const groupMap = new Map<string, TaskGroup>();

  // For state grouping with availableStates, pre-populate all states to ensure empty columns appear
  if (groupBy === 'state' && availableStates) {
    for (const state of availableStates) {
      groupMap.set(state.id, {
        id: state.id,
        name: state.name,
        color: state.color,
        tasks: [],
      });
    }
  }

  for (const task of tasks) {
    const groupInfos = getGroupInfo(task, groupBy, mergeStatesByCategory);

    for (const { id, name, color, category } of groupInfos) {
      if (!groupMap.has(id)) {
        groupMap.set(id, { id, name, color, category, tasks: [] });
      }
      groupMap.get(id)!.tasks.push(task);
    }
  }

  // Sort groups based on groupBy type
  const groups = Array.from(groupMap.values());
  return sortGroups(groups, groupBy, availableStates);
}

/**
 * Gets group information for a task based on groupBy field
 * Returns an array because a task can belong to multiple groups (e.g., multiple assignees)
 */
function getGroupInfo(
  task: TaskCardTask,
  groupBy: GroupBy,
  mergeStatesByCategory?: boolean
): { id: string; name: string; color: string | null; category?: string }[] {
  switch (groupBy) {
    case 'state':
      if (!task.state) {
        return [{ id: 'no-state', name: 'No Status', color: '#6b7280', category: undefined }];
      }
      // When merging by category, use category as the group ID
      if (mergeStatesByCategory) {
        const category = task.state.category || 'backlog';
        return [{
          id: category,
          name: categoryLabels[category] || category,
          color: categoryColors[category] || '#6b7280',
          category,
        }];
      }
      return [{
        id: task.state.id,
        name: task.state.name,
        color: task.state.color,
        category: task.state.category,
      }];

    case 'assignee':
      if (task.assignees.length === 0) {
        return [{ id: 'unassigned', name: 'Unassigned', color: '#6b7280' }];
      }
      return task.assignees.map((a) => ({
        id: a.id,
        name: a.name || a.email,
        color: null,
      }));

    case 'project':
      return [{ id: task.project.id, name: task.project.name, color: null }];

    case 'priority':
      const priority = task.priority || 'none';
      return [{
        id: priority,
        name: priorityLabels[priority] || priority,
        color: priorityColors[priority] || '#6b7280',
      }];

    case 'label':
      if (task.labels.length === 0) {
        return [{ id: 'no-label', name: 'No Label', color: '#6b7280' }];
      }
      return task.labels.map((l) => ({
        id: l.id,
        name: l.name,
        color: l.color,
      }));

    default:
      return [{ id: 'all', name: 'All Tasks', color: null }];
  }
}

export function taskMatchesGroup(
  task: TaskCardTask,
  groupBy: GroupBy,
  groupId: string,
  mergeStatesByCategory?: boolean
): boolean {
  return getGroupInfo(task, groupBy, mergeStatesByCategory).some((group) => group.id === groupId);
}

/**
 * Sorts groups based on the groupBy type
 */
function sortGroups(
  groups: TaskGroup[],
  groupBy: GroupBy,
  availableStates?: AvailableState[]
): TaskGroup[] {
  switch (groupBy) {
    case 'priority':
      return groups.sort((a, b) => {
        const aOrder = priorityOrder[a.id] ?? 999;
        const bOrder = priorityOrder[b.id] ?? 999;
        return aOrder - bOrder;
      });

    case 'state':
      // Sort states according to availableStates order if provided
      if (availableStates) {
        const stateOrder = new Map(availableStates.map((s, i) => [s.id, i]));
        return groups.sort((a, b) => {
          const aOrder = stateOrder.get(a.id) ?? 999;
          const bOrder = stateOrder.get(b.id) ?? 999;
          return aOrder - bOrder;
        });
      }
      // Sort by category when no availableStates (e.g., in smart views)
      return groups.sort((a, b) => {
        const aOrder = stateCategoryOrder[a.category || ''] ?? 999;
        const bOrder = stateCategoryOrder[b.category || ''] ?? 999;
        if (aOrder !== bOrder) return aOrder - bOrder;
        return a.name.localeCompare(b.name);
      });

    case 'assignee':
    case 'project':
    case 'label':
      // Sort alphabetically, but put "unassigned" / "no label" at the end
      return groups.sort((a, b) => {
        const aIsSpecial = a.id === 'unassigned' || a.id === 'no-label' || a.id === 'no-state';
        const bIsSpecial = b.id === 'unassigned' || b.id === 'no-label' || b.id === 'no-state';
        if (aIsSpecial && !bIsSpecial) return 1;
        if (!aIsSpecial && bIsSpecial) return -1;
        return a.name.localeCompare(b.name);
      });

    default:
      return groups;
  }
}

/**
 * Gets a display-friendly label for a groupBy value
 */
export function getGroupByLabel(groupBy: GroupBy): string {
  switch (groupBy) {
    case 'state':
      return 'Status';
    case 'assignee':
      return 'Assignee';
    case 'project':
      return 'Project';
    case 'priority':
      return 'Priority';
    case 'label':
      return 'Label';
    case 'none':
      return 'None';
  }
}
