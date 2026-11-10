import { getDatabase, type Database } from '../../db/index.js';
import {
  comments,
  projectIntegrations,
  projects,
  taskStates,
  tasks,
  users,
} from '../../db/index.js';
import { isJsonValue, parseSlackConfig, type SlackConfig } from '@flowtask/shared';
import { and, eq } from 'drizzle-orm';
import {
  NonRetryableError,
  registerBackgroundJob,
  scheduleBackgroundJob,
  type BackgroundJobPayload,
} from '../background.js';
import { invalidateCache, registerInvalidatedCache } from '../../lib/cache-invalidation.js';
import { decryptSecret } from '../crypto.js';
import { getWebUrl } from '../env.js';
import type { TaskNotification } from '../types.js';
import { createSlackClient, getEnvSlackBotToken, type SlackClient } from './client.js';
import { SlackNotifier } from './notify.js';
import { SlackApiError } from './web-api.js';

interface SlackTaskEventBase {
  taskId: string;
  /** FlowTask user who caused the event, if any. */
  actorUserId?: string | null;
  /** Display label when the actor isn't a FlowTask user (e.g. "GitHub", an agent name). */
  actorLabel?: string;
}

/** Task events that produce Slack notifications. */
export type SlackTaskEvent =
  | (SlackTaskEventBase & { type: 'task.created' })
  | (SlackTaskEventBase & { type: 'task.state_changed'; toStateId: string | null })
  | (SlackTaskEventBase & { type: 'task.assigned'; assigneeUserId: string })
  | (SlackTaskEventBase & { type: 'comment.added'; commentId: string });

const SETTING_FOR_EVENT: Record<SlackTaskEvent['type'], keyof SlackConfig['notifications']> = {
  'task.created': 'taskCreated',
  'task.state_changed': 'stateChanged',
  'task.assigned': 'assigned',
  'comment.added': 'commentAdded',
};

export type SlackDeliveryOutcome = 'sent' | 'skipped';

export interface SlackDeliveryDeps {
  createClient?: (botToken: string) => SlackClient;
}

async function userName(db: Database, userId: string | null | undefined): Promise<string | null> {
  if (!userId) return null;
  const [user] = await db
    .select({ name: users.name, email: users.email })
    .from(users)
    .where(eq(users.id, userId));
  return user ? user.name || user.email : null;
}

async function eventDetails(
  db: Database,
  event: SlackTaskEvent
): Promise<{ action: TaskNotification['action']; details?: string } | null> {
  switch (event.type) {
    case 'task.created':
      return { action: 'created' };
    case 'task.state_changed': {
      if (!event.toStateId) return { action: 'state_changed' };
      const [state] = await db
        .select({ name: taskStates.name, category: taskStates.category })
        .from(taskStates)
        .where(eq(taskStates.id, event.toStateId));
      if (!state) return { action: 'state_changed' };
      return {
        action: state.category === 'done' ? 'completed' : 'state_changed',
        details: `Now in ${state.name}`,
      };
    }
    case 'task.assigned': {
      const name = await userName(db, event.assigneeUserId);
      return { action: 'assigned', details: name ? `Assigned to ${name}` : undefined };
    }
    case 'comment.added': {
      const [comment] = await db
        .select({ content: comments.content })
        .from(comments)
        .where(and(eq(comments.id, event.commentId), eq(comments.taskId, event.taskId)));
      if (!comment) return null;
      return { action: 'commented', details: comment.content };
    }
  }
}

/**
 * Deliver one task event to the project's Slack channel, if the project has an
 * enabled Slack integration with that notification turned on.
 */
export async function deliverSlackTaskEvent(
  db: Database,
  event: SlackTaskEvent,
  deps: SlackDeliveryDeps = {}
): Promise<SlackDeliveryOutcome> {
  const [row] = await db
    .select({
      title: tasks.title,
      sequenceNumber: tasks.sequenceNumber,
      deletedAt: tasks.deletedAt,
      projectId: projects.id,
      projectName: projects.name,
      identifier: projects.identifier,
      integrationConfig: projectIntegrations.config,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .innerJoin(
      projectIntegrations,
      and(
        eq(projectIntegrations.projectId, projects.id),
        eq(projectIntegrations.integrationType, 'slack'),
        eq(projectIntegrations.isEnabled, true)
      )
    )
    .where(eq(tasks.id, event.taskId));

  if (!row || row.deletedAt) return 'skipped';
  const config = parseSlackConfig(row.integrationConfig);
  if (!config || !config.notifications[SETTING_FOR_EVENT[event.type]]) return 'skipped';

  const botToken = config.botTokenEncrypted
    ? decryptSecret(config.botTokenEncrypted)
    : getEnvSlackBotToken();
  if (!botToken) return 'skipped';

  const detail = await eventDetails(db, event);
  if (!detail) return 'skipped';

  const actorName = event.actorLabel ?? (await userName(db, event.actorUserId)) ?? undefined;
  const notification: TaskNotification = {
    taskId: event.taskId,
    taskTitle: row.title,
    taskUrl: `${getWebUrl()}/task/${event.taskId}`,
    projectName: row.projectName,
    taskKey: `${row.identifier}-${row.sequenceNumber}`,
    action: detail.action,
    actorName,
    details: detail.details,
  };

  const client = (deps.createClient ?? createSlackClient)(botToken);
  try {
    await new SlackNotifier(client, config.channelId).sendTaskNotification(notification);
  } catch (error) {
    // channel_not_found, not_in_channel, invalid_auth, ... won't succeed on retry.
    if (error instanceof SlackApiError) {
      throw new NonRetryableError(error.message, { cause: error });
    }
    throw error;
  }
  return 'sent';
}

/**
 * Notify Slack about a task event. Fire-and-forget: runs through the
 * background seam with retries and never throws.
 *
 * Call it after task created, state changed, assigned and comment added.
 */
export const SLACK_NOTIFY_JOB = 'slack.notify_task_event';

function slackEventFromPayload(payload: BackgroundJobPayload): SlackTaskEvent {
  const str = (key: string): string | undefined => {
    const value = payload[key];
    return typeof value === 'string' ? value : undefined;
  };
  const taskId = str('taskId');
  if (!taskId) throw new NonRetryableError('Slack job payload is missing taskId');
  const base = { taskId, actorUserId: str('actorUserId') ?? null, actorLabel: str('actorLabel') };
  switch (str('type')) {
    case 'task.created':
      return { ...base, type: 'task.created' };
    case 'task.state_changed':
      return { ...base, type: 'task.state_changed', toStateId: str('toStateId') ?? null };
    case 'task.assigned': {
      const assigneeUserId = str('assigneeUserId');
      if (!assigneeUserId)
        throw new NonRetryableError('Slack job payload is missing assigneeUserId');
      return { ...base, type: 'task.assigned', assigneeUserId };
    }
    case 'comment.added': {
      const commentId = str('commentId');
      if (!commentId) throw new NonRetryableError('Slack job payload is missing commentId');
      return { ...base, type: 'comment.added', commentId };
    }
    default:
      throw new NonRetryableError('Unknown Slack job event type');
  }
}

registerBackgroundJob(SLACK_NOTIFY_JOB, async (payload) => {
  await deliverSlackTaskEvent(getDatabase(), slackEventFromPayload(payload));
});

/** How long a project's "has an enabled Slack integration" answer is reused. */
export const SLACK_PROJECT_CACHE_TTL_MS = 30_000;
const SLACK_PROJECT_CACHE_MAX = 5_000;

const slackProjectCache = new Map<string, { expiresAt: number; enabled: Promise<boolean> }>();

async function projectHasEnabledSlack(db: Database, projectId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: projectIntegrations.id })
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.projectId, projectId),
        eq(projectIntegrations.integrationType, 'slack'),
        eq(projectIntegrations.isEnabled, true)
      )
    )
    .limit(1);
  return Boolean(row);
}

/**
 * Whether the project has an enabled Slack integration, cached per project
 * for SLACK_PROJECT_CACHE_TTL_MS (the job re-checks everything when it runs).
 * A failed lookup answers true so the event is still enqueued.
 */
export function slackEnabledForProject(
  projectId: string,
  db: Database = getDatabase(),
  now: number = Date.now()
): Promise<boolean> {
  const hit = slackProjectCache.get(projectId);
  if (hit && hit.expiresAt > now) return hit.enabled;
  if (slackProjectCache.size >= SLACK_PROJECT_CACHE_MAX) {
    for (const [key, entry] of slackProjectCache) {
      if (entry.expiresAt <= now) slackProjectCache.delete(key);
    }
    if (slackProjectCache.size >= SLACK_PROJECT_CACHE_MAX) slackProjectCache.clear();
  }
  const enabled = projectHasEnabledSlack(db, projectId).catch((error: unknown) => {
    console.error('[slack] integration lookup failed:', error);
    return true;
  });
  slackProjectCache.set(projectId, { expiresAt: now + SLACK_PROJECT_CACHE_TTL_MS, enabled });
  return enabled;
}

const SLACK_PROJECT_CACHE = 'slack.project_enabled';

registerInvalidatedCache(SLACK_PROJECT_CACHE, (projectId) => {
  if (projectId) slackProjectCache.delete(projectId);
  else slackProjectCache.clear();
});

/**
 * Forget the cached answer after a project's Slack integration is saved or
 * deleted, on this instance and (over the realtime NOTIFY channel) on every
 * other one, so no replica keeps dropping notifications until the TTL ends.
 */
export function clearSlackProjectCache(projectId?: string): void {
  invalidateCache(SLACK_PROJECT_CACHE, projectId ?? null);
}

/**
 * Enqueue a Slack notification for a task event of `projectId`, unless the
 * project has no enabled Slack integration.
 */
export function notifySlackForTaskEvent(projectId: string, event: SlackTaskEvent): void {
  void slackEnabledForProject(projectId).then((enabled) => {
    if (enabled) scheduleSlackTaskEvent(event);
  });
}

function scheduleSlackTaskEvent(event: SlackTaskEvent): void {
  const payload: BackgroundJobPayload = {};
  for (const [key, value] of Object.entries(event)) {
    if (isJsonValue(value)) payload[key] = value;
  }
  scheduleBackgroundJob(SLACK_NOTIFY_JOB, payload, {
    context: { eventType: event.type, taskId: event.taskId },
  });
}
