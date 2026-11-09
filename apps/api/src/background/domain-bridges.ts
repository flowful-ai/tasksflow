/**
 * Domain events → side effects. Every write path (REST routes, MCP and agent
 * tools, bulk, trash, GitHub sync) goes through the domain services, which
 * emit on `domainEvents` after commit. Subscribing here, once, is what keeps
 * realtime, Slack and GitHub reverse sync consistent across all of them;
 * callers no longer publish or notify by hand.
 */
import { externalLinks, type Database } from '../db/index.js';
import {
  domainEvents,
  onNotificationCreated,
  type TaskFieldChange,
  type TaskUpdatedEvent,
  type TaskWithRelations,
} from '../domain/index.js';
import {
  GitHubReverseSyncService,
  notifySlackForTaskEvent,
  type SlackTaskEvent,
  type TaskChangesForGitHub,
} from '../integrations/index.js';
import { REALTIME_EVENTS } from '@flowtask/shared';
import { and, eq } from 'drizzle-orm';
import {
  notifyAccessChanged,
  notifyMemberRemoved,
  publishEvent,
  publishUserEvent,
} from '../sse/manager.js';

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

/** The kinds of change GitHub mirrors in an update event (values are read when the job runs). */
function githubChanges(event: TaskUpdatedEvent): TaskChangesForGitHub | null {
  const changes: TaskChangesForGitHub = {};
  for (const change of event.changes) {
    if (change.field === 'title') changes.title = true;
    if (change.field === 'description') changes.description = true;
    if (change.field === 'stateId') changes.state = true;
  }
  if (event.addedLabelIds.length > 0 || event.removedLabelIds.length > 0) {
    changes.labels = true;
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
      publishEvent(event.workspaceId, REALTIME_EVENTS.TASK_CREATED, event.task, {
        projectId: event.projectId,
      });
      notifySlackForTaskEvent(event.projectId, {
        type: 'task.created',
        taskId: event.task.id,
        ...slackActor(event),
      });
    }),

    domainEvents.on('task.updated', (event) => {
      publishEvent(event.workspaceId, REALTIME_EVENTS.TASK_UPDATED, event.task, {
        projectId: event.projectId,
      });

      const stateChange = event.changes.find((change) => change.field === 'stateId');
      if (stateChange) {
        notifySlackForTaskEvent(event.projectId, {
          type: 'task.state_changed',
          taskId: event.task.id,
          toStateId: stringOrNull(stateChange.to),
          ...slackActor(event),
        });
      }
      for (const assigneeUserId of event.addedAssigneeIds) {
        notifySlackForTaskEvent(event.projectId, {
          type: 'task.assigned',
          taskId: event.task.id,
          assigneeUserId,
          ...slackActor(event),
        });
      }

      if (event.origin !== 'github' && hasGitHubIssue(event.task)) {
        const changes = githubChanges(event);
        if (changes) reverseSync.scheduleTaskSync(event.task.id, changes);
      }
    }),

    domainEvents.on('task.moved', (event) => {
      publishEvent(event.workspaceId, REALTIME_EVENTS.TASK_MOVED, event.task, {
        projectId: event.projectId,
      });
      if (event.positionOnly) return;
      notifySlackForTaskEvent(event.projectId, {
        type: 'task.state_changed',
        taskId: event.task.id,
        toStateId: event.toStateId,
        ...slackActor(event),
      });
      if (event.origin !== 'github' && hasGitHubIssue(event.task)) {
        reverseSync.scheduleTaskSync(event.task.id, { state: true });
      }
    }),

    domainEvents.on('task.deleted', async (event) => {
      publishEvent(
        event.workspaceId,
        REALTIME_EVENTS.TASK_DELETED,
        { id: event.taskId, projectId: event.projectId },
        { projectId: event.projectId }
      );
      if (event.origin !== 'github' && (await taskHasGitHubIssue(event.taskId))) {
        reverseSync.scheduleIssueStateSync(event.taskId);
      }
    }),

    domainEvents.on('task.restored', (event) => {
      // Clients treat a restored task like a newly created one.
      publishEvent(event.workspaceId, REALTIME_EVENTS.TASK_CREATED, event.task, {
        projectId: event.projectId,
      });
      // Deleting closed the issue; reopen it unless the task is done (decided at run time).
      if (event.origin !== 'github' && hasGitHubIssue(event.task)) {
        reverseSync.scheduleIssueStateSync(event.task.id);
      }
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
      publishEvent(
        event.workspaceId,
        REALTIME_EVENTS.COMMENT_CREATED,
        { taskId: event.taskId, projectId: event.projectId, comment: event.comment },
        { projectId: event.projectId }
      );
      notifySlackForTaskEvent(event.projectId, {
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

    domainEvents.on('comment.updated', (event) => {
      publishEvent(
        event.workspaceId,
        REALTIME_EVENTS.COMMENT_UPDATED,
        { taskId: event.taskId, projectId: event.projectId, comment: event.comment },
        { projectId: event.projectId }
      );
    }),

    domainEvents.on('comment.deleted', (event) => {
      publishEvent(
        event.workspaceId,
        REALTIME_EVENTS.COMMENT_DELETED,
        { taskId: event.taskId, projectId: event.projectId, commentId: event.commentId },
        { projectId: event.projectId }
      );
    }),

    domainEvents.on('project.updated', (event) => {
      // Refresh cached project access first so the event reaches the right clients.
      if (event.accessChanged) notifyAccessChanged(event.workspaceId);
      publishEvent(
        event.workspaceId,
        REALTIME_EVENTS.PROJECT_UPDATED,
        { id: event.projectId, projectId: event.projectId },
        { projectId: event.projectId }
      );
    }),

    domainEvents.on('member.joined', (event) => {
      publishEvent(
        event.workspaceId,
        REALTIME_EVENTS.MEMBER_JOINED,
        { workspaceId: event.workspaceId, userId: event.userId },
        'workspace'
      );
    }),

    domainEvents.on('member.left', (event) => {
      // Close the removed user's realtime streams on every instance immediately.
      notifyMemberRemoved(event.workspaceId, event.userId);
      publishEvent(
        event.workspaceId,
        REALTIME_EVENTS.MEMBER_LEFT,
        { workspaceId: event.workspaceId, userId: event.userId },
        'workspace'
      );
    }),

    domainEvents.on('member.role_changed', (event) => {
      notifyAccessChanged(event.workspaceId, event.userId);
    }),

    domainEvents.on('workspace.deleted', (event) => {
      // Memberships are gone: refreshing access closes every stream of the workspace.
      notifyAccessChanged(event.workspaceId);
    }),

    onNotificationCreated((notification) => {
      publishUserEvent(notification.userId, REALTIME_EVENTS.NOTIFICATION_CREATED, notification);
    }),
  ];

  return () => {
    for (const unsubscribe of off) unsubscribe();
  };
}
