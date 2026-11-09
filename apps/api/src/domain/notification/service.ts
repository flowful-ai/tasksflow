/**
 * Inbox notifications: storage, listing and state changes (read, archive,
 * snooze). Producers (domain-event subscribers, reminder jobs) call
 * `createMany`, which drops the actor, checks project access and dedupes.
 */
import { decodeKeysetCursor, encodeKeysetCursor } from '../keyset-cursor.js';
import { and, desc, eq, gt, isNotNull, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { notifications, projects, tasks, users, type Notification } from '../../db/index.js';
import {
  formatTaskKey,
  ok,
  err,
  toJsonObject,
  type JsonObject,
  type NotificationFilter,
  type NotificationItem,
  type NotificationType,
  type Result,
} from '@flowtask/shared';
import { filterUsersWithProjectAccess } from '../task/access.js';
import { toError } from '../task/errors.js';

export interface NotificationInput {
  userIds: readonly string[];
  workspaceId: string;
  type: NotificationType;
  taskId: string | null;
  /** Project of the task; recipients without access to it are dropped. */
  projectId: string | null;
  actorId: string | null;
  data?: JsonObject;
  /** Per-recipient idempotency key (the user id is part of the unique index). */
  dedupeKey?: string;
}

export type NotificationRecord = Notification;
export type NotificationCreatedListener = (
  notification: NotificationRecord
) => void | Promise<void>;

const createdListeners = new Set<NotificationCreatedListener>();

/**
 * Subscribe to newly stored notifications (e.g. to push them over SSE with
 * publishUserEvent). Returns an unsubscribe function.
 */
export function onNotificationCreated(listener: NotificationCreatedListener): () => void {
  createdListeners.add(listener);
  return () => {
    createdListeners.delete(listener);
  };
}

function notifyListeners(rows: readonly NotificationRecord[]): void {
  for (const row of rows) {
    for (const listener of createdListeners) {
      void Promise.resolve()
        .then(() => listener(row))
        .catch((error: unknown) => console.error('[notifications] listener failed:', error));
    }
  }
}

const NOTIFICATION_TYPES: readonly string[] = [
  'assigned',
  'mentioned',
  'commented',
  'status_changed',
  'due_soon',
  'overdue',
  'github',
];

function isNotificationType(value: string): value is NotificationType {
  return NOTIFICATION_TYPES.includes(value);
}

export function notificationFilterCondition(
  filter: NotificationFilter,
  now: Date
): SQL | undefined {
  const notSnoozed = or(isNull(notifications.snoozedUntil), lte(notifications.snoozedUntil, now))!;
  switch (filter) {
    case 'inbox':
      return and(isNull(notifications.archivedAt), notSnoozed);
    case 'unread':
      return and(isNull(notifications.archivedAt), isNull(notifications.readAt), notSnoozed);
    case 'archived':
      return isNotNull(notifications.archivedAt);
    case 'snoozed':
      return and(isNull(notifications.archivedAt), gt(notifications.snoozedUntil, now));
    case 'all':
      return undefined;
  }
}

export class NotificationService {
  constructor(private db: Database) {}

  /** Store notifications for recipients (actor excluded, access-checked, deduped). */
  async createMany(inputs: readonly NotificationInput[]): Promise<NotificationRecord[]> {
    const values: (typeof notifications.$inferInsert)[] = [];
    for (const input of inputs) {
      let recipients = [...new Set(input.userIds)].filter((id) => id && id !== input.actorId);
      if (recipients.length === 0) continue;
      if (input.projectId) {
        recipients = await filterUsersWithProjectAccess(this.db, input.projectId, recipients);
      }
      for (const userId of recipients) {
        values.push({
          userId,
          workspaceId: input.workspaceId,
          type: input.type,
          taskId: input.taskId,
          actorId: input.actorId,
          data: input.data ?? {},
          dedupeKey: input.dedupeKey ?? null,
        });
      }
    }
    if (values.length === 0) return [];
    const rows = await this.db
      .insert(notifications)
      .values(values)
      .onConflictDoNothing()
      .returning();
    notifyListeners(rows);
    return rows;
  }

  async list(
    userId: string,
    query: { workspaceId: string; filter?: NotificationFilter; cursor?: string; limit?: number }
  ): Promise<Result<{ items: NotificationItem[]; nextCursor: string | null }, Error>> {
    try {
      const limit = Math.max(1, Math.min(100, query.limit ?? 30));
      const conditions: SQL[] = [
        eq(notifications.userId, userId),
        eq(notifications.workspaceId, query.workspaceId),
      ];
      const filterCondition = notificationFilterCondition(query.filter ?? 'inbox', new Date());
      if (filterCondition) conditions.push(filterCondition);
      const cursor = decodeKeysetCursor(query.cursor);
      if (cursor) {
        conditions.push(
          sql`(${notifications.createdAt}, ${notifications.id}) < (${cursor.ts}::timestamptz, ${cursor.id}::uuid)`
        );
      }

      const rows = await this.db
        .select({
          n: notifications,
          cursorTs: sql<string>`${notifications.createdAt}::text`,
          taskTitle: tasks.title,
          taskSeq: tasks.sequenceNumber,
          taskProjectId: tasks.projectId,
          taskDeletedAt: tasks.deletedAt,
          identifier: projects.identifier,
          actorName: users.name,
          actorAvatar: users.avatarUrl,
        })
        .from(notifications)
        .leftJoin(tasks, eq(notifications.taskId, tasks.id))
        .leftJoin(projects, eq(tasks.projectId, projects.id))
        .leftJoin(users, eq(notifications.actorId, users.id))
        .where(and(...conditions))
        .orderBy(desc(notifications.createdAt), desc(notifications.id))
        .limit(limit + 1);

      const page = rows.slice(0, limit);
      const items: NotificationItem[] = page.flatMap((row) => {
        const n = row.n;
        if (!isNotificationType(n.type)) return [];
        return [
          {
            id: n.id,
            workspaceId: n.workspaceId,
            type: n.type,
            task:
              n.taskId &&
              row.taskTitle !== null &&
              row.taskSeq !== null &&
              row.identifier !== null &&
              row.taskProjectId
                ? {
                    id: n.taskId,
                    key: formatTaskKey(row.identifier, row.taskSeq),
                    title: row.taskTitle,
                    projectId: row.taskProjectId,
                    deleted: row.taskDeletedAt !== null,
                  }
                : null,
            actor: n.actorId
              ? { id: n.actorId, name: row.actorName, avatarUrl: row.actorAvatar }
              : null,
            data: toNotificationData(toJsonObject(n.data)),
            readAt: n.readAt,
            archivedAt: n.archivedAt,
            snoozedUntil: n.snoozedUntil,
            createdAt: n.createdAt,
          },
        ];
      });
      const last = page[page.length - 1];
      const nextCursor =
        rows.length > limit && last
          ? encodeKeysetCursor({ ts: last.cursorTs, id: last.n.id })
          : null;
      return ok({ items, nextCursor });
    } catch (error) {
      return err(toError(error));
    }
  }

  /** Unread, unarchived, not-snoozed notifications in a workspace. */
  async unreadCount(userId: string, workspaceId: string): Promise<Result<number, Error>> {
    try {
      const [row] = await this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(notifications)
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.workspaceId, workspaceId),
            notificationFilterCondition('unread', new Date())
          )
        );
      return ok(Number(row?.count ?? 0));
    } catch (error) {
      return err(toError(error));
    }
  }

  private async updateOwn(
    userId: string,
    notificationId: string,
    set: Partial<typeof notifications.$inferInsert>
  ): Promise<Result<NotificationRecord | null, Error>> {
    try {
      const [row] = await this.db
        .update(notifications)
        .set(set)
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
        .returning();
      return ok(row ?? null);
    } catch (error) {
      return err(toError(error));
    }
  }

  markRead(userId: string, notificationId: string) {
    return this.updateOwn(userId, notificationId, { readAt: new Date() });
  }

  markUnread(userId: string, notificationId: string) {
    return this.updateOwn(userId, notificationId, { readAt: null });
  }

  /** Archive ("done"); also marks it read. */
  async archive(
    userId: string,
    notificationId: string
  ): Promise<Result<NotificationRecord | null, Error>> {
    try {
      const [row] = await this.db
        .update(notifications)
        .set({ archivedAt: new Date(), readAt: sql`coalesce(${notifications.readAt}, now())` })
        .where(and(eq(notifications.id, notificationId), eq(notifications.userId, userId)))
        .returning();
      return ok(row ?? null);
    } catch (error) {
      return err(toError(error));
    }
  }

  unarchive(userId: string, notificationId: string) {
    return this.updateOwn(userId, notificationId, { archivedAt: null });
  }

  /** Hide until `until`; it comes back unread. */
  snooze(userId: string, notificationId: string, until: Date) {
    return this.updateOwn(userId, notificationId, { snoozedUntil: until, readAt: null });
  }

  async markAllRead(userId: string, workspaceId: string): Promise<Result<number, Error>> {
    try {
      const rows = await this.db
        .update(notifications)
        .set({ readAt: new Date() })
        .where(
          and(
            eq(notifications.userId, userId),
            eq(notifications.workspaceId, workspaceId),
            isNull(notifications.readAt)
          )
        )
        .returning({ id: notifications.id });
      return ok(rows.length);
    } catch (error) {
      return err(toError(error));
    }
  }
}

type NotificationDataValue = NotificationItem['data'][string];

function isStateRef(
  value: JsonObject[string]
): value is { id: string; name: string; category: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.category === 'string'
  );
}

function toNotificationData(data: JsonObject): NotificationItem['data'] {
  const out: Record<string, NotificationDataValue> = {};
  for (const [key, value] of Object.entries(data)) {
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      out[key] = value;
    } else if (isStateRef(value)) {
      out[key] = { id: value.id, name: value.name, category: value.category };
    }
  }
  return out;
}
