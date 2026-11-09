import type { JsonValue } from '@flowtask/shared';
import type { TaskWithRelations } from '../task/types.js';

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

/**
 * A comment was created. CommentService (owned by another workstream) is
 * expected to emit this after insert; NotificationService and outgoing
 * webhooks subscribe to it.
 */
export interface CommentCreatedEvent {
  commentId: string;
  taskId: string;
  actorId: string | null;
  content: string;
  mcpClientId?: string | null;
  /** Set for comments imported from GitHub: never push them back to GitHub. */
  origin?: 'github';
  /** Display label when the author isn't a FlowTask user (e.g. "@octocat on GitHub"). */
  actorLabel?: string;
}

export interface DomainEventMap {
  'task.created': TaskCreatedEvent;
  'task.updated': TaskUpdatedEvent;
  'task.moved': TaskMovedEvent;
  'task.deleted': TaskDeletedEvent;
  'task.restored': TaskRestoredEvent;
  'tasks.rekeyed': TasksRekeyedEvent;
  'comment.created': CommentCreatedEvent;
}

export type DomainEventName = keyof DomainEventMap;

export const DOMAIN_EVENT_NAMES: readonly DomainEventName[] = [
  'task.created',
  'task.updated',
  'task.moved',
  'task.deleted',
  'task.restored',
  'tasks.rekeyed',
  'comment.created',
];
