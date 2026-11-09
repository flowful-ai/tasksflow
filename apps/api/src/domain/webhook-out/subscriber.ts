import { eq } from 'drizzle-orm';
import { projects, type Database } from '../../db/index.js';
import type { JsonObject, JsonValue, OutgoingWebhookEvent } from '@flowtask/shared';
import { domainEvents, type DomainEventBus } from '../events/bus.js';
import type { TaskFieldChange } from '../events/types.js';
import type { TaskWithRelations } from '../task/types.js';
import { OutgoingWebhookService } from './service.js';

/**
 * Compact, email-free task representation sent to webhook receivers.
 */
export function toWebhookTask(task: TaskWithRelations): JsonObject {
  const parentId: string | null | undefined = task.parentId;
  return {
    id: task.id,
    key: `${task.project.identifier}-${task.sequenceNumber}`,
    projectId: task.projectId,
    title: task.title,
    description: task.description,
    priority: task.priority,
    state: task.state
      ? { id: task.state.id, name: task.state.name, category: task.state.category }
      : null,
    assignees: task.assignees.map((user) => ({ id: user.id, name: user.name })),
    labels: task.labels.map((label) => ({ id: label.id, name: label.name, color: label.color })),
    dueDate: task.dueDate ? task.dueDate.toISOString() : null,
    startDate: task.startDate ? task.startDate.toISOString() : null,
    parentId: parentId ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
  };
}

function toChanges(changes: TaskFieldChange[]): JsonValue[] {
  return changes.map((change) => ({ field: change.field, from: change.from, to: change.to }));
}

/**
 * Subscribe outgoing webhooks to domain events. Returns an unsubscribe function.
 */
export function registerOutgoingWebhookSubscribers(
  db: Database,
  bus: DomainEventBus = domainEvents,
  service: OutgoingWebhookService = new OutgoingWebhookService(db)
): () => void {
  const dispatch = async (workspaceId: string, event: OutgoingWebhookEvent, data: JsonObject) => {
    const result = await service.dispatchEvent(workspaceId, event, data);
    if (!result.ok) console.error(`[outgoing-webhooks] dispatch of ${event} failed:`, result.error);
  };

  const unsubscribers = [
    bus.on('task.created', (e) =>
      dispatch(e.workspaceId, 'task.created', { task: toWebhookTask(e.task), actorId: e.actorId })
    ),
    bus.on('task.updated', (e) =>
      dispatch(e.workspaceId, 'task.updated', {
        task: toWebhookTask(e.task),
        actorId: e.actorId,
        changes: toChanges(e.changes),
        addedAssigneeIds: e.addedAssigneeIds,
        removedAssigneeIds: e.removedAssigneeIds,
        addedLabelIds: e.addedLabelIds,
        removedLabelIds: e.removedLabelIds,
      })
    ),
    bus.on('task.moved', (e) =>
      dispatch(e.workspaceId, 'task.moved', {
        task: toWebhookTask(e.task),
        actorId: e.actorId,
        fromStateId: e.fromStateId,
        toStateId: e.toStateId,
        positionOnly: e.positionOnly,
      })
    ),
    bus.on('task.restored', (e) =>
      dispatch(e.workspaceId, 'task.restored', { task: toWebhookTask(e.task), actorId: e.actorId })
    ),
    bus.on('task.deleted', async (e) => {
      const [project] = await db
        .select({ identifier: projects.identifier })
        .from(projects)
        .where(eq(projects.id, e.projectId));
      await dispatch(e.workspaceId, 'task.deleted', {
        task: {
          id: e.taskId,
          key: project ? `${project.identifier}-${e.sequenceNumber}` : null,
          projectId: e.projectId,
          title: e.title,
        },
        actorId: e.actorId,
      });
    }),
    bus.on('comment.created', async (e) => {
      await dispatch(e.workspaceId, 'comment.created', {
        comment: { id: e.commentId, content: e.content },
        task: { id: e.taskId, key: e.taskKey, projectId: e.projectId, title: e.taskTitle },
        actorId: e.actorId,
      });
    }),
  ];

  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe();
  };
}
