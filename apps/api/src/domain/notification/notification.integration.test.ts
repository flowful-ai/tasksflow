/**
 * Notifications integration tests (skipped unless TEST_DATABASE_URL is set).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { notifications, tasks } from '../../db/index.js';
import { formatMention } from '@flowtask/shared';
import { DomainEventBus, domainEvents } from '../events/bus.js';
import { TaskService } from '../task/service.js';
import {
  TEST_DATABASE_URL,
  createProject,
  createUser,
  createWorkspace,
  testDb,
  unwrap,
  type ProjectFixture,
  type WorkspaceFixture,
} from '../task/test-fixtures.js';
import { workspaceMembers } from '../../db/index.js';
import { runDueDateReminders } from './reminders.js';
import { NotificationService, onNotificationCreated } from './service.js';
import { registerNotificationSubscribers } from './subscriber.js';

describe.skipIf(!TEST_DATABASE_URL)('notifications (integration)', () => {
  let ws: WorkspaceFixture;
  let project: ProjectFixture;
  let service: TaskService;
  let inbox: NotificationService;
  let off: () => void;
  let third: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    const db = testDb();
    service = new TaskService(db);
    inbox = new NotificationService(db);
    off = registerNotificationSubscribers(db);
    ws = await createWorkspace(db);
    third = await createUser(db, 'Third');
    await db
      .insert(workspaceMembers)
      .values({ workspaceId: ws.workspaceId, userId: third.id, role: 'member' });
    project = await createProject(db, ws.workspaceId);
  });

  afterAll(async () => {
    await domainEvents.idle();
    off();
  });

  async function inboxOf(userId: string) {
    await domainEvents.idle();
    return unwrap(
      await inbox.list(userId, { workspaceId: ws.workspaceId, filter: 'all', limit: 100 })
    ).items;
  }

  it('notifies assignees, never the actor, and pushes through onNotificationCreated', async () => {
    const pushed: string[] = [];
    const unsubscribe = onNotificationCreated((n) => {
      pushed.push(n.userId);
    });
    const task = unwrap(
      await service.create({
        projectId: project.projectId,
        title: 'Assign me',
        assigneeIds: [ws.member.id, ws.owner.id],
        createdBy: ws.owner.id,
      })
    );
    const memberInbox = await inboxOf(ws.member.id);
    const item = memberInbox.find((n) => n.task?.id === task.id && n.type === 'assigned');
    expect(item).toBeDefined();
    expect(item!.actor?.name).toBe('Owner');
    expect(item!.task?.key).toBe(task.key);
    expect((await inboxOf(ws.owner.id)).some((n) => n.task?.id === task.id)).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    unsubscribe();
    expect(pushed).toContain(ws.member.id);
    expect(pushed).not.toContain(ws.owner.id);
  });

  it('notifies assignees and the creator on status change, and new mentions in descriptions', async () => {
    const task = unwrap(
      await service.create({
        projectId: project.projectId,
        title: 'Status',
        assigneeIds: [ws.member.id],
        createdBy: ws.owner.id,
      })
    );
    unwrap(await service.move(task.id, { stateId: project.states.progress, movedBy: third.id }));
    const memberItems = (await inboxOf(ws.member.id)).filter(
      (n) => n.task?.id === task.id && n.type === 'status_changed'
    );
    const ownerItems = (await inboxOf(ws.owner.id)).filter(
      (n) => n.task?.id === task.id && n.type === 'status_changed'
    );
    expect(memberItems).toHaveLength(1);
    expect(ownerItems).toHaveLength(1);
    expect(memberItems[0]!.data.toState).toMatchObject({ name: 'In progress' });
    expect(memberItems[0]!.data.fromState).toMatchObject({ name: 'Todo' });

    const mention = formatMention('Third', third.id);
    unwrap(
      await service.update(task.id, { description: `ping ${mention}`, updatedBy: ws.owner.id })
    );
    // Editing again with the same mention does not notify twice.
    unwrap(
      await service.update(task.id, {
        description: `ping ${mention} again`,
        updatedBy: ws.owner.id,
      })
    );
    const mentions = (await inboxOf(third.id)).filter(
      (n) => n.task?.id === task.id && n.type === 'mentioned'
    );
    expect(mentions).toHaveLength(1);
    expect(mentions[0]!.data.excerpt).toBe('ping @Third');
  });

  it('does not notify users without access to a restricted project', async () => {
    const restricted = await createProject(testDb(), ws.workspaceId, { access: 'admin' });
    const task = unwrap(
      await service.create({
        projectId: restricted.projectId,
        title: 'secret',
        description: formatMention('Member', ws.member.id),
        createdBy: ws.owner.id,
      })
    );
    expect((await inboxOf(ws.member.id)).some((n) => n.task?.id === task.id)).toBe(false);
  });

  it('notifies participants and mentioned users on comment.created', async () => {
    const task = unwrap(
      await service.create({
        projectId: project.projectId,
        title: 'Comments',
        assigneeIds: [ws.member.id],
        createdBy: ws.owner.id,
      })
    );
    domainEvents.emit('comment.created', {
      commentId: '00000000-0000-4000-8000-0000000000aa',
      taskId: task.id,
      actorId: ws.member.id,
      content: `hey ${formatMention('Third', third.id)}`,
    });
    const owner = (await inboxOf(ws.owner.id)).filter((n) => n.task?.id === task.id);
    expect(owner.map((n) => n.type)).toEqual(['commented']);
    const thirdItems = (await inboxOf(third.id)).filter((n) => n.task?.id === task.id);
    expect(thirdItems.map((n) => n.type)).toEqual(['mentioned']);
    expect(
      (await inboxOf(ws.member.id)).some((n) => n.task?.id === task.id && n.type === 'commented')
    ).toBe(false);
  });

  it('reads, archives, snoozes and counts', async () => {
    const task = unwrap(
      await service.create({
        projectId: project.projectId,
        title: 'Inbox ops',
        assigneeIds: [third.id],
        createdBy: ws.owner.id,
      })
    );
    const [item] = (await inboxOf(third.id)).filter((n) => n.task?.id === task.id);
    const before = unwrap(await inbox.unreadCount(third.id, ws.workspaceId));
    unwrap(await inbox.markRead(third.id, item!.id));
    expect(unwrap(await inbox.unreadCount(third.id, ws.workspaceId))).toBe(before - 1);
    // Someone else's notification is not found.
    expect(unwrap(await inbox.markRead(ws.owner.id, item!.id))).toBeNull();

    unwrap(await inbox.snooze(third.id, item!.id, new Date(Date.now() + 3_600_000)));
    const listInbox = unwrap(
      await inbox.list(third.id, { workspaceId: ws.workspaceId, filter: 'inbox', limit: 100 })
    );
    expect(listInbox.items.some((n) => n.id === item!.id)).toBe(false);
    const snoozed = unwrap(
      await inbox.list(third.id, { workspaceId: ws.workspaceId, filter: 'snoozed' })
    );
    expect(snoozed.items.map((n) => n.id)).toContain(item!.id);

    unwrap(await inbox.archive(third.id, item!.id));
    const archived = unwrap(
      await inbox.list(third.id, { workspaceId: ws.workspaceId, filter: 'archived' })
    );
    expect(archived.items.map((n) => n.id)).toContain(item!.id);

    unwrap(await inbox.markAllRead(third.id, ws.workspaceId));
    expect(unwrap(await inbox.unreadCount(third.id, ws.workspaceId))).toBe(0);
  });

  it('paginates with a cursor', async () => {
    const user = await createUser(testDb(), 'Pager');
    await testDb()
      .insert(workspaceMembers)
      .values({ workspaceId: ws.workspaceId, userId: user.id, role: 'member' });
    await inbox.createMany(
      Array.from({ length: 5 }, (_, i) => ({
        userIds: [user.id],
        workspaceId: ws.workspaceId,
        projectId: null,
        taskId: null,
        actorId: null,
        type: 'github' as const,
        data: { i },
      }))
    );
    const first = unwrap(await inbox.list(user.id, { workspaceId: ws.workspaceId, limit: 2 }));
    const second = unwrap(
      await inbox.list(user.id, {
        workspaceId: ws.workspaceId,
        limit: 2,
        cursor: first.nextCursor!,
      })
    );
    const third = unwrap(
      await inbox.list(user.id, {
        workspaceId: ws.workspaceId,
        limit: 2,
        cursor: second.nextCursor!,
      })
    );
    const ids = [...first.items, ...second.items, ...third.items].map((n) => n.id);
    expect(new Set(ids).size).toBe(5);
    expect(third.nextCursor).toBeNull();
  });

  it('sends due_soon / overdue reminders once per task per day', async () => {
    const db = testDb();
    const soon = unwrap(
      await service.create({
        projectId: project.projectId,
        title: 'Due soon',
        assigneeIds: [ws.member.id],
        dueDate: new Date(Date.now() + 3_600_000),
        createdBy: ws.owner.id,
      })
    );
    const late = unwrap(
      await service.create({
        projectId: project.projectId,
        title: 'Overdue',
        assigneeIds: [ws.member.id],
        dueDate: new Date(Date.now() - 3_600_000),
        createdBy: ws.owner.id,
      })
    );
    const done = unwrap(
      await service.create({
        projectId: project.projectId,
        title: 'Done already',
        stateId: project.states.done,
        assigneeIds: [ws.member.id],
        dueDate: new Date(Date.now() - 3_600_000),
        createdBy: ws.owner.id,
      })
    );
    await runDueDateReminders(db);
    await runDueDateReminders(db);
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, ws.member.id));
    const forTask = (id: string) =>
      rows
        .filter((r) => r.taskId === id)
        .map((r) => r.type)
        .filter((t) => t !== 'assigned');
    expect(forTask(soon.id)).toEqual(['due_soon']);
    expect(forTask(late.id)).toEqual(['overdue']);
    expect(forTask(done.id)).toEqual([]);
    await db.update(tasks).set({ deletedAt: new Date() }).where(eq(tasks.id, late.id));
  });

  it('isolates listeners per bus', () => {
    const bus = new DomainEventBus();
    expect(bus.listenerCount('task.created')).toBe(0);
  });
});
