import { z } from 'zod';

export const NotificationTypeSchema = z.enum([
  'assigned',
  'mentioned',
  'commented',
  'status_changed',
  'due_soon',
  'overdue',
  'github',
]);
export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/** Inbox filter: `inbox` = not archived and not currently snoozed (default). */
export const NotificationFilterSchema = z.enum(['inbox', 'unread', 'archived', 'snoozed', 'all']);
export type NotificationFilter = z.infer<typeof NotificationFilterSchema>;

export const ListNotificationsQuerySchema = z.object({
  workspaceId: z.string().uuid(),
  filter: NotificationFilterSchema.default('inbox'),
  /** Opaque cursor returned as `nextCursor` by the previous page. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export type ListNotificationsQuery = z.infer<typeof ListNotificationsQuerySchema>;

export const UnreadCountQuerySchema = z.object({
  workspaceId: z.string().uuid(),
});

export const ReadAllNotificationsSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const SnoozeNotificationSchema = z.object({
  until: z.coerce.date(),
});
export type SnoozeNotification = z.infer<typeof SnoozeNotificationSchema>;

export interface NotificationActor {
  id: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface NotificationTaskRef {
  id: string;
  /** e.g. "TF-42" */
  key: string;
  title: string;
  projectId: string;
  deleted: boolean;
}

/** Shape returned by GET /api/notifications. Dates are ISO strings over the wire. */
export interface NotificationItem {
  id: string;
  workspaceId: string;
  type: NotificationType;
  task: NotificationTaskRef | null;
  actor: NotificationActor | null;
  /**
   * Type-specific details:
   * - mentioned/commented: { commentId?, excerpt }
   * - status_changed: { fromState: {id,name,category}|null, toState: {id,name,category}|null }
   * - due_soon/overdue: { dueDate }
   * - assigned: {}
   */
  data: Record<
    string,
    string | number | boolean | null | { id: string; name: string; category: string }
  >;
  readAt: Date | null;
  archivedAt: Date | null;
  snoozedUntil: Date | null;
  createdAt: Date;
}
