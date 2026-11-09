import type { JsonValue, WorkspaceRole } from '@flowtask/shared';
import type { TaskWithRelations } from '../task/types.js';
import type { CommentWithUser } from '../comment/types.js';

/** A tracked scalar field change on a task (values are JSON: dates as ISO strings). */
export interface TaskFieldChange {
  field: 'title' | 'description' | 'stateId' | 'priority' | 'dueDate' | 'startDate' | 'parentId';
  from: JsonValue;
  to: JsonValue;
}

interface TaskEventBase {
  workspaceId: string;
  projectId: string;
  /** User who performed the change (null for system/GitHub/agent-without-user). */
  actorId: string | null;
  mcpClientId?: string | null;
  /** Set when the change came from GitHub (webhook/sync): never push it back to GitHub. */
  origin?: 'github';
}

export interface TaskCreatedEvent extends TaskEventBase {
  task: TaskWithRelations;
}

export interface TaskUpdatedEvent extends TaskEventBase {
  task: TaskWithRelations;
  changes: TaskFieldChange[];
  addedAssigneeIds: string[];
  removedAssigneeIds: string[];
  addedLabelIds: string[];
  removedLabelIds: string[];
  /** Description before the change (for mention diffing); undefined when unchanged. */
  previousDescription?: string | null;
}

export interface TaskMovedEvent extends TaskEventBase {
  task: TaskWithRelations;
  fromStateId: string | null;
  toStateId: string | null;
  /** True when only the position inside the same column changed. */
  positionOnly: boolean;
}

export interface TaskDeletedEvent extends TaskEventBase {
  taskId: string;
  title: string;
  sequenceNumber: number;
}

export interface TaskRestoredEvent extends TaskEventBase {
  task: TaskWithRelations;
}

/** Positions of other tasks in a column were rewritten (clients should refetch the column). */
export interface TasksRekeyedEvent {
  workspaceId: string;
  projectId: string;
  stateId: string | null;
}

interface CommentEventBase {
  workspaceId: string;
  projectId: string;
  taskId: string;
  actorId: string | null;
  mcpClientId?: string | null;
  /** Set for comments synced from GitHub: never push them back to GitHub. */
  origin?: 'github';
}

/**
 * A comment was created. CommentService emits it after commit; realtime,
 * Slack, GitHub comment sync, notifications and outgoing webhooks subscribe.
 * It carries the task's key and title so subscribers need not re-query it.
 */
export interface CommentCreatedEvent extends CommentEventBase {
  commentId: string;
  content: string;
  comment: CommentWithUser;
  /** e.g. "FLOW-123" */
  taskKey: string;
  taskTitle: string;
  /** The task's creator, for notifications. */
  taskCreatedBy: string | null;
  /** The task was in the trash when the comment was written. */
  taskDeleted: boolean;
  /** Display label when the author isn't a FlowTask user (e.g. "@octocat on GitHub"). */
  actorLabel?: string;
}

export interface CommentUpdatedEvent extends CommentEventBase {
  comment: CommentWithUser;
}

export interface CommentDeletedEvent extends CommentEventBase {
  commentId: string;
}

/**
 * A project, its states, labels or access changed. `accessChanged` means
 * who can see the project may have changed (create, delete, ACL edit).
 */
export interface ProjectUpdatedEvent {
  workspaceId: string;
  projectId: string;
  accessChanged: boolean;
}

export interface MemberJoinedEvent {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

export interface MemberLeftEvent {
  workspaceId: string;
  userId: string;
}

export interface MemberRoleChangedEvent {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
}

/** The workspace and all its memberships are gone. */
export interface WorkspaceDeletedEvent {
  workspaceId: string;
}

export interface DomainEventMap {
  'task.created': TaskCreatedEvent;
  'task.updated': TaskUpdatedEvent;
  'task.moved': TaskMovedEvent;
  'task.deleted': TaskDeletedEvent;
  'task.restored': TaskRestoredEvent;
  'tasks.rekeyed': TasksRekeyedEvent;
  'comment.created': CommentCreatedEvent;
  'comment.updated': CommentUpdatedEvent;
  'comment.deleted': CommentDeletedEvent;
  'project.updated': ProjectUpdatedEvent;
  'member.joined': MemberJoinedEvent;
  'member.left': MemberLeftEvent;
  'member.role_changed': MemberRoleChangedEvent;
  'workspace.deleted': WorkspaceDeletedEvent;
}

export type DomainEventName = keyof DomainEventMap;
