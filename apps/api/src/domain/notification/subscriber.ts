/**
 * Turns domain events into Inbox notifications.
 *
 * - assigned: users added as assignees (task.created / task.updated)
 * - status_changed: assignees + creator when the state changes
 * - mentioned: users newly @-mentioned in a description or a comment
 * - commented: task participants (assignees, creator, previous commenters)
 * The actor is never notified, and recipients must be able to access the
 * project (NotificationService.createMany checks both).
 */
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { comments, projects, taskAssignees, taskStates, tasks } from '../../db/index.js';
import {
  extractMentionedUserIds,
  newlyMentionedUserIds,
  stripMentions,
  type JsonObject,
} from '@flowtask/shared';
import { domainEvents, type DomainEventBus } from '../events/bus.js';
import type { TaskWithRelations } from '../task/types.js';
import { NotificationService, type NotificationInput } from './service.js';

function excerpt(text: string | null | undefined, max = 160): string | null {
  if (!text) return null;
  const plain = stripMentions(text).replace(/\s+/g, ' ').trim();
  return plain.length > max ? `${plain.slice(0, max - 1)}…` : plain;
}

function stateRef(task: TaskWithRelations): JsonObject | null {
  return task.state
    ? { id: task.state.id, name: task.state.name, category: task.state.category }
    : null;
}

async function loadStateRef(db: Database, stateId: string | null): Promise<JsonObject | null> {
  if (!stateId) return null;
  const [state] = await db
    .select({ id: taskStates.id, name: taskStates.name, category: taskStates.category })
    .from(taskStates)
    .where(eq(taskStates.id, stateId));
  return state ?? null;
}

interface TaskContext {
  workspaceId: string;
  projectId: string;
  taskId: string;
}

function ctxOf(task: TaskWithRelations, workspaceId: string): TaskContext {
  return { workspaceId, projectId: task.projectId, taskId: task.id };
}

function base(
  ctx: TaskContext,
  actorId: string | null
): Omit<NotificationInput, 'userIds' | 'type'> {
  return { workspaceId: ctx.workspaceId, projectId: ctx.projectId, taskId: ctx.taskId, actorId };
}

export function registerNotificationSubscribers(
  db: Database,
  bus: DomainEventBus = domainEvents
): () => void {
  const service = new NotificationService(db);

  const statusChanged = async (
    task: TaskWithRelations,
    workspaceId: string,
    actorId: string | null,
    fromStateId: string | null
  ) => {
    const recipients = [
      ...task.assignees.map((a) => a.id),
      ...(task.createdBy ? [task.createdBy] : []),
    ];
    await service.createMany([
      {
        ...base(ctxOf(task, workspaceId), actorId),
        userIds: recipients,
        type: 'status_changed',
        data: { fromState: await loadStateRef(db, fromStateId), toState: stateRef(task) },
      },
    ]);
  };

  const unsubscribers = [
    bus.on('task.created', async (e) => {
      const ctx = ctxOf(e.task, e.workspaceId);
      const assigned = e.task.assignees.map((a) => a.id);
      const mentioned = extractMentionedUserIds(e.task.description).filter(
        (id) => !assigned.includes(id)
      );
      await service.createMany([
        { ...base(ctx, e.actorId), userIds: assigned, type: 'assigned', data: {} },
        {
          ...base(ctx, e.actorId),
          userIds: mentioned,
          type: 'mentioned',
          data: { source: 'description', excerpt: excerpt(e.task.description) },
        },
      ]);
    }),

    bus.on('task.updated', async (e) => {
      const ctx = ctxOf(e.task, e.workspaceId);
      const inputs: NotificationInput[] = [];
      if (e.addedAssigneeIds.length) {
        inputs.push({
          ...base(ctx, e.actorId),
          userIds: e.addedAssigneeIds,
          type: 'assigned',
          data: {},
        });
      }
      if (e.previousDescription !== undefined) {
        const mentioned = newlyMentionedUserIds(e.previousDescription, e.task.description).filter(
          (id) => !e.addedAssigneeIds.includes(id)
        );
        if (mentioned.length) {
          inputs.push({
            ...base(ctx, e.actorId),
            userIds: mentioned,
            type: 'mentioned',
            data: { source: 'description', excerpt: excerpt(e.task.description) },
          });
        }
      }
      if (inputs.length) await service.createMany(inputs);
      const stateChange = e.changes.find((c) => c.field === 'stateId');
      if (stateChange) {
        await statusChanged(
          e.task,
          e.workspaceId,
          e.actorId,
          typeof stateChange.from === 'string' ? stateChange.from : null
        );
      }
    }),

    bus.on('task.moved', async (e) => {
      if (e.positionOnly || e.fromStateId === e.toStateId) return;
      await statusChanged(e.task, e.workspaceId, e.actorId, e.fromStateId);
    }),

    bus.on('comment.created', async (e) => {
      const [task] = await db
        .select({
          id: tasks.id,
          projectId: tasks.projectId,
          createdBy: tasks.createdBy,
          workspaceId: projects.workspaceId,
        })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .where(and(eq(tasks.id, e.taskId), isNull(tasks.deletedAt)));
      if (!task) return;
      const ctx: TaskContext = {
        workspaceId: task.workspaceId,
        projectId: task.projectId,
        taskId: task.id,
      };

      const [assigneeRows, commenterRows] = await Promise.all([
        db
          .select({ id: taskAssignees.userId })
          .from(taskAssignees)
          .where(eq(taskAssignees.taskId, task.id)),
        db
          .selectDistinct({ id: comments.userId })
          .from(comments)
          .where(
            and(
              eq(comments.taskId, task.id),
              isNull(comments.deletedAt),
              isNotNull(comments.userId)
            )
          ),
      ]);
      const mentioned = extractMentionedUserIds(e.content);
      const participants = [
        ...assigneeRows.map((r) => r.id),
        ...(task.createdBy ? [task.createdBy] : []),
        ...commenterRows.flatMap((r) => (r.id ? [r.id] : [])),
      ].filter((id) => !mentioned.includes(id));
      const data = { commentId: e.commentId, excerpt: excerpt(e.content) };
      await service.createMany([
        {
          ...base(ctx, e.actorId),
          userIds: mentioned,
          type: 'mentioned',
          data: { ...data, source: 'comment' },
        },
        { ...base(ctx, e.actorId), userIds: participants, type: 'commented', data },
      ]);
    }),
  ];

  return () => {
    for (const off of unsubscribers) off();
  };
}
