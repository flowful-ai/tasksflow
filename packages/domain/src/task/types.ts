import type { SQL } from 'drizzle-orm';
import type { Task, TaskState, User, Label } from '@flowtask/database';
import type { CreateTask, UpdateTask, MoveTask, TaskPriority } from '@flowtask/shared';

export interface TaskAgent {
  id: string;
  name: string;
}

export interface TaskWithRelations extends Task {
  state: TaskState | null;
  assignees: User[];
  labels: Label[];
  project: {
    id: string;
    identifier: string;
    name: string;
  };
  agent: TaskAgent | null;
}

export interface TaskCreateInput extends CreateTask {
  projectId: string;
  createdBy: string | null;
  agentId?: string | null;
}

export interface TaskUpdateInput extends UpdateTask {
  updatedBy: string | null;
}

export interface TaskMoveInput extends MoveTask {
  movedBy: string | null;
}

export interface TaskFilters {
  projectId?: string;
  projectIds?: string[];
  stateId?: string;
  stateIds?: string[];
  assigneeId?: string;
  assigneeIds?: string[];
  labelId?: string;
  labelIds?: string[];
  priority?: TaskPriority;
  priorities?: TaskPriority[];
  createdBy?: string;
  dueBefore?: Date;
  dueAfter?: Date;
  includeDeleted?: boolean;
  search?: string;
}

export interface TaskListOptions {
  filters?: TaskFilters;
  /** Raw SQL filter clause from FilterEngine (for Smart Views) */
  filterSql?: SQL | null;
  /** Tables that need to be joined for the filterSql to work */
  requiredJoins?: Set<'task_states' | 'task_assignees' | 'task_labels'>;
  sortBy?: 'position' | 'created_at' | 'updated_at' | 'due_date' | 'priority' | 'sequence_number';
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface TaskEventInput {
  taskId: string;
  actorId: string | null;
  eventType: 'created' | 'updated' | 'moved' | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled' | 'commented' | 'deleted' | 'restored';
  fieldName?: string;
  oldValue?: unknown;
  newValue?: unknown;
}
