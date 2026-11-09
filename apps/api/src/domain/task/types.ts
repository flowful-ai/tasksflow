import type { SQL } from 'drizzle-orm';
import type { Task, TaskState, User, Label } from '../../db/index.js';
import type {
  CreateTask,
  UpdateTask,
  MoveTask,
  TaskPriority,
  TaskRelationType,
  JsonValue,
} from '@flowtask/shared';

export interface TaskAgent {
  id: string;
  name: string;
}

export interface TaskExternalLink {
  id: string;
  externalType: 'github_issue' | 'github_pr';
  externalId: string;
  externalUrl: string;
}

/** A task row as returned by TaskService (the generated search_vector is never selected). */
export type TaskRow = Omit<Task, 'searchVector' | 'parentId'>;

/** Minimal reference to another task (parent, sub-task, relation). */
export interface TaskRef {
  id: string;
  /** e.g. "TF-42" */
  key: string;
  title: string;
  projectId: string;
  stateId: string | null;
  stateCategory: string | null;
  /** True when the referenced task's state category is 'done'. */
  done: boolean;
}

export interface TaskWithRelations extends TaskRow {
  state: TaskState | null;
  assignees: User[];
  labels: Label[];
  project: {
    id: string;
    identifier: string;
    name: string;
    /** Always set by TaskService (optional only for hand-built fixtures). */
    workspaceId?: string;
  };
  agent: TaskAgent | null;
  externalLinks: TaskExternalLink[];
  // The fields below are always set by TaskService; they are optional in the
  // type only so that hand-built fixtures elsewhere keep compiling.
  /** Parent task id (sub-tasks). */
  parentId?: string | null;
  /** "TF-42" */
  key?: string;
  /** Number of non-deleted direct sub-tasks. */
  subtaskCount?: number;
  /** Sub-tasks whose state category is 'done'. */
  subtaskDoneCount?: number;
}

/** Task detail (getById): adds parent, sub-tasks and blocking relations. */
export interface TaskDetail extends TaskWithRelations {
  parent?: TaskRef | null;
  subtasks?: TaskRef[];
  /** Tasks this task blocks. */
  blocks?: TaskRef[];
  /** Tasks blocking this task. */
  blockedBy?: TaskRef[];
}

export interface TaskCreateInput extends CreateTask {
  projectId: string;
  createdBy: string | null;
  agentId?: string | null;
  mcpClientId?: string | null;
  /** The task is created from GitHub (issue sync); tags its domain event with origin 'github'. */
  skipGitHubSync?: boolean;
}

export interface TaskUpdateInput extends UpdateTask {
  updatedBy: string | null;
  mcpClientId?: string | null;
  /** Skip reverse sync to GitHub (used when update comes from GitHub webhook) */
  skipGitHubSync?: boolean;
}

export interface TaskMoveInput extends MoveTask {
  movedBy: string | null;
  mcpClientId?: string | null;
  /** Skip reverse sync to GitHub (used when update comes from GitHub webhook) */
  skipGitHubSync?: boolean;
}

export interface TaskFilters {
  /** Scope: at least one of projectId, projectIds or workspaceId is required. */
  projectId?: string;
  projectIds?: string[];
  workspaceId?: string;
  /** Restrict to these task ids (not a scope on its own). */
  ids?: string[];
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
  /** Sub-task filter: a task id returns its children, null returns top-level tasks only. */
  parentId?: string | null;
  includeDeleted?: boolean;
  /** Only soft-deleted tasks (trash). */
  onlyDeleted?: boolean;
  /** Full-text search (tsvector), prefix match, or a task key such as "TF-12". */
  search?: string;
}

export type TaskSortBy =
  | 'position'
  | 'created_at'
  | 'updated_at'
  | 'due_date'
  | 'priority'
  | 'sequence_number'
  | 'deleted_at';

export interface TaskListOptions {
  filters?: TaskFilters;
  /** Raw SQL filter clause from FilterEngine (for Smart Views) */
  filterSql?: SQL | null;
  /** Tables that need to be joined for the filterSql to work */
  requiredJoins?: Set<'task_states' | 'task_assignees' | 'task_labels'>;
  sortBy?: TaskSortBy;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface GetTaskOptions {
  /** Return soft-deleted tasks too (default false). */
  includeDeleted?: boolean;
}

export type TaskEventType =
  | 'created'
  | 'updated'
  | 'moved'
  | 'assigned'
  | 'unassigned'
  | 'labeled'
  | 'unlabeled'
  | 'commented'
  | 'deleted'
  | 'restored'
  | 'relation_added'
  | 'relation_removed';

export interface TaskEventInput {
  taskId: string;
  actorId: string | null;
  mcpClientId?: string | null;
  eventType: TaskEventType;
  fieldName?: string;
  oldValue?: JsonValue;
  newValue?: JsonValue;
  /** Display snapshot (names) for rendering history after referenced rows are gone. */
  metadata?: JsonValue;
}

export interface TaskRelationView {
  id: string;
  type: TaskRelationType;
  /** 'outgoing': this task → task (this blocks/duplicates it); 'incoming': task → this task. */
  direction: 'outgoing' | 'incoming';
  task: TaskRef;
  createdAt: Date;
  createdBy: string | null;
}
