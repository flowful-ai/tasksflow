import type { TaskPriority } from '@flowtask/shared';
import type { TaskExternalLinkDto, TaskRefDto } from '../../../api/types';

/**
 * The fields the detail view displays. Both TaskDetailDto (authenticated) and
 * the public share task satisfy it.
 */
export interface TaskDetail {
  id: string;
  title: string;
  description: string | null;
  priority: string | null;
  stateId: string | null;
  state: { id: string; name: string; color: string | null; category?: string } | null;
  project: { id: string; identifier: string; name: string };
  assignees: { id: string; name: string | null; email: string; avatarUrl?: string | null }[];
  labels: { id: string; name: string; color: string | null }[];
  externalLinks?: TaskExternalLinkDto[];
  sequenceNumber: number;
  dueDate: string | null;
  startDate?: string | null;
  createdAt: string;
  updatedAt?: string | null;
  parentId?: string | null;
  parent?: TaskRefDto | null;
  subtasks?: TaskRefDto[];
  blocks?: TaskRefDto[];
  blockedBy?: TaskRefDto[];
}

/** A state as the detail view needs it. */
export interface DetailState {
  id: string;
  name: string;
  color: string | null;
  category: string;
  position?: string;
}

export const taskKeyOf = (task: Pick<TaskDetail, 'project' | 'sequenceNumber'>): string =>
  `${task.project.identifier}-${task.sequenceNumber}`;

export const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'No priority' },
];

export function priorityLabel(priority: string | null | undefined): string {
  return PRIORITY_OPTIONS.find((o) => o.value === priority)?.label ?? 'No priority';
}

/** Where to go when a related task is clicked (sheet swaps in place, page navigates). */
export type OpenTaskHandler = (taskId: string) => void;
