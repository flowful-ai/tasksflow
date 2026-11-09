/**
 * Domain events → side effects. Every write path (REST routes, MCP and agent
 * tools, bulk, trash, GitHub sync) goes through the domain services, which
 * emit on `domainEvents` after commit. Subscribing here, once, is what keeps
 * realtime, Slack and GitHub reverse sync consistent across all of them;
 * callers no longer publish or notify by hand.
 */
import { externalLinks, type Database } from '@flowtask/database';
import {
  domainEvents,
  onNotificationCreated,
  type TaskFieldChange,
  type TaskUpdatedEvent,
  type TaskWithRelations,
} from '@flowtask/domain';
import {
  GitHubReverseSyncService,
  notifySlackForTaskEvent,
  type SlackTaskEvent,
  type TaskChangesForGitHub,
} from '@flowtask/integrations';
import { REALTIME_EVENTS } from '@flowtask/shared';
import { and, eq } from 'drizzle-orm';
import { publishEvent, publishUserEvent } from '../sse/manager.js';

interface EventActor {
  actorId: string | null;
  mcpClientId?: string | null;
  origin?: 'github';
}

/** Slack attribution: a FlowTask user, else where the change came from. */
function slackActor(event: EventActor): Pick<SlackTaskEvent, 'actorUserId' | 'actorLabel'> {
  if (event.actorId) return { actorUserId: event.actorId };
  if (event.origin === 'github') return { actorUserId: null, actorLabel: 'GitHub' };
  if (event.mcpClientId) return { actorUserId: null, actorLabel: 'AI agent' };
  return { actorUserId: null };
}

function hasGitHubIssue(task: TaskWithRelations): boolean {
  return task.externalLinks.some((link) => link.externalType === 'github_issue');
}

function stringOrNull(value: TaskFieldChange['to']): string | null {
  return typeof value === 'string' ? value : null;
}

/** The fields GitHub mirrors, from an update event (labels sent as the full current set). */
function githubChanges(event: TaskUpdatedEvent): TaskChangesForGitHub | null {
  const changes: TaskChangesForGitHub = {};
  for (const change of event.changes) {
    if (change.field === 'title' && typeof change.to === 'string') changes.title = change.to;
    if (change.field === 'description') changes.description = stringOrNull(change.to) ?? '';
    if (change.field === 'stateId') changes.stateId = stringOrNull(change.to);
    if (change.field === 'priority') changes.priority = stringOrNull(change.to);
  }
  if (event.addedLabelIds.length > 0 || event.removedLabelIds.length > 0) {
    changes.labelIds = event.task.labels.map((label) => label.id);
  }
  return Object.keys(changes).length > 0 ? changes : null;
}

export function registerDomainEventBridges(db: Database): () => void {
  const reverseSync = new GitHubReverseSyncService(db);

  async function taskHasGitHubIssue(taskId: string): Promise<boolean> {
    const [link] = await db
      .select({ id: externalLinks.id })
      .from(externalLinks)
      .where(and(eq(externalLinks.taskId, taskId), eq(externalLinks.externalType, 'github_issue')))
      .limit(1);
    return Boolean(link);
  }

  const off = [
    domainEvents.on('task.created', (event) => {
      publishEvent(event.workspaceId, REALTIME_EVENTS.TASK_CREATED, event.task, { projectId: event.projectId });
      notifySlackForTaskEvent({ type: 'task.created', taskId: event.task.id, ...slackActor(event) });
    }),

    domainEvents.on('task.updated', (event) => {
      publishEvent(event.workspaceId, REALTIME_EVENTS.TASK_UPDATED, event.task, { projectId: event.projectId });

      const stateChange = event.changes.find((change) => change.field === 'stateId');
      if (stateChange) {
        notifySlackForTaskEvent({
          type: 'task.state_changed',
          taskId: event.task.id,
          toStateId: stringOrNull(stateChange.to),
          ...slackActor(event),
        });
      }
      for (const assigneeUserId of event.addedAssigneeIds) {
        notifySlackForTaskEvent({ type: 'task.assigned', taskId: event.task.id, assigneeUserId, ...slackActor(event) });
      }

      if (event.origin !== 'github' && hasGitHubIssue(event.task)) {
        const changes = githubChanges(event);
        if (changes) reverseSync.scheduleTaskSync(event.task.id, changes);
      }
    }),

    domainEvents.on('task.moved', (event) => {
      publishEvent(event.workspaceId, REALTIME_EVENTS.TASK_MOVED, event.task, { projectId: event.projectId });
      if (event.positionOnly) return;
      notifySlackForTaskEvent({
        type: 'task.state_changed',
        taskId: event.task.id,
        toStateId: event.toStateId,
        ...slackActor(event),
      });
      if (event.origin !== 'github' && hasGitHubIssue(event.task)) {
        reverseSync.scheduleTaskSync(event.task.id, { stateId: event.toStateId });
      }
    }),

    domainEvents.on('task.deleted', async (event) => {
      publishEvent(event.workspaceId, REALTIME_EVENTS.TASK_DELETED, { id: event.taskId, projectId: event.projectId });
      if (event.origin !== 'github' && (await taskHasGitHubIssue(event.taskId))) {
        reverseSync.scheduleIssueClose(event.taskId);
      }
    }),

    domainEvents.on('task.restored', (event) => {
      // Clients treat a restored task like a newly created one.
      publishEvent(event.workspaceId, REALTIME_EVENTS.TASK_CREATED, event.task, { projectId: event.projectId });
    }),

    domainEvents.on('tasks.rekeyed', (event) => {
      publishEvent(
        event.workspaceId,
        REALTIME_EVENTS.TASKS_REKEYED,
        { projectId: event.projectId, stateId: event.stateId },
        { projectId: event.projectId }
      );
    }),

    domainEvents.on('comment.created', async (event) => {
      notifySlackForTaskEvent({
        type: 'comment.added',
        taskId: event.taskId,
        commentId: event.commentId,
        ...slackActor(event),
        ...(event.actorLabel ? { actorLabel: event.actorLabel } : {}),
      });
      if (event.origin !== 'github' && (await taskHasGitHubIssue(event.taskId))) {
        reverseSync.scheduleCommentSync(event.taskId, {
          content: event.content,
          authorId: event.actorId,
          commentId: event.commentId,
        });
      }
    }),

    onNotificationCreated((notification) => {
      publishUserEvent(notification.userId, REALTIME_EVENTS.NOTIFICATION_CREATED, notification);
    }),
  ];

  return () => {
    for (const unsubscribe of off) unsubscribe();
  };
}
