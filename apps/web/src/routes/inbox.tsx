/**
 * Inbox (mockup section 5): notifications on the left, the task detail inline
 * on the right. On small screens one pane that drills in.
 *
 * Keys: J/K move, Enter opens (and marks read), E done/archive, H snooze to
 * tomorrow 9:00, U toggle unread, Shift+I mark all read.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  CheckCheck,
  Clock,
  Inbox as InboxIcon,
  Mail,
  MailOpen,
} from 'lucide-react';
import clsx from 'clsx';
import type { NotificationFilter } from '@flowtask/shared';
import type { NotificationDto } from '../api/types';
import { useCurrentWorkspace, useNotificationActions, useNotifications } from '../hooks/queries';
import { useHotkey } from '../lib/hotkeys';
import { useMediaQuery } from '../lib/useMediaQuery';
import { shortRelativeTime, tomorrowMorning } from '../lib/time';
import { useUiStore } from '../stores/ui';
import {
  Avatar,
  Button,
  EmptyState,
  ErrorState,
  IconButton,
  Kbd,
  PageSpinner,
  Spinner,
  toast,
} from '../components/ui';
import { TaskDetailView } from '../components/tasks/detail/TaskDetailView';
import {
  describeNotification,
  initials,
  notificationSentence,
} from '../components/inbox/notificationText';
import { projectColor } from '../lib/color';

const TABS: { filter: NotificationFilter; label: string }[] = [
  { filter: 'inbox', label: 'Inbox' },
  { filter: 'unread', label: 'Unread' },
  { filter: 'snoozed', label: 'Snoozed' },
  { filter: 'archived', label: 'Archived' },
];

const EMPTY: Record<string, { title: string; body: string }> = {
  inbox: {
    title: "You're all caught up",
    body: 'Mentions, assignments and comments on your tasks show up here.',
  },
  unread: { title: "You're all caught up", body: 'No unread notifications.' },
  snoozed: {
    title: 'Nothing snoozed',
    body: 'Press H on a notification to snooze it until tomorrow morning.',
  },
  archived: { title: 'No archived notifications', body: 'Press E to mark a notification done.' },
};

function ActorAvatar({ notification }: { notification: NotificationDto }) {
  const system = notification.type === 'overdue' || notification.type === 'due_soon';
  const gh = notification.type === 'github' && !notification.actor;
  return (
    <Avatar
      src={notification.actor?.avatarUrl}
      size="md"
      color={
        system
          ? '#ef4444'
          : gh
            ? '#57534e'
            : projectColor(notification.actor?.id ?? notification.id)
      }
    >
      {system ? <Clock /> : gh ? 'GH' : initials(notification.actor?.name)}
    </Avatar>
  );
}

function NotificationRow({
  notification,
  active,
  opened,
  onOpen,
  onHover,
  rowRef,
}: {
  notification: NotificationDto;
  active: boolean;
  opened: boolean;
  onOpen: () => void;
  onHover: () => void;
  rowRef?: (el: HTMLButtonElement | null) => void;
}) {
  const t = describeNotification(notification);
  const unread = !notification.readAt;
  return (
    <li>
      <button
        ref={rowRef}
        type="button"
        onClick={onOpen}
        onMouseMove={onHover}
        aria-current={opened ? 'true' : undefined}
        aria-label={`${unread ? 'Unread: ' : ''}${notificationSentence(notification)}. ${t.snippet}`}
        className={clsx(
          'relative flex w-full items-start gap-3 border-b border-neutral-100 px-4 py-3 text-left transition-colors',
          unread ? 'bg-primary-50/50' : 'bg-white',
          opened ? 'bg-neutral-100' : 'hover:bg-neutral-50',
          active && 'outline-solid outline-2 -outline-offset-2 outline-primary-300'
        )}
      >
        {unread && (
          <span
            aria-hidden
            className="absolute left-1.5 top-[22px] h-1.5 w-1.5 rounded-full bg-primary-500"
          />
        )}
        <ActorAvatar notification={notification} />
        <span className="min-w-0 flex-1">
          <span
            className={clsx(
              'block truncate text-sm',
              unread ? 'text-neutral-900' : 'text-neutral-600'
            )}
          >
            {t.actor && <b className="font-semibold">{t.actor}</b>} {t.verb}{' '}
            <span className="font-mono text-xs text-neutral-500">
              {notification.task?.key ?? 'a task'}
            </span>
            {t.suffix && ` ${t.suffix}`}
          </span>
          {t.snippet && (
            <span className="mt-0.5 block truncate text-[13px] text-neutral-500">{t.snippet}</span>
          )}
        </span>
        <time
          dateTime={notification.createdAt}
          className="shrink-0 pt-0.5 text-xs tabular-nums text-neutral-400"
        >
          {shortRelativeTime(notification.createdAt)}
        </time>
      </button>
    </li>
  );
}

export function InboxPage() {
  const { workspaceId } = useCurrentWorkspace();
  const [filter, setFilter] = useState<NotificationFilter>('inbox');
  const list = useNotifications(workspaceId, filter);
  const { notifications } = list;
  const actions = useNotificationActions(workspaceId ?? '');
  const openTaskSheet = useUiStore((s) => s.openTaskSheet);
  const isDesktop = useMediaQuery('(min-width: 1024px)');

  const [activeIndex, setActiveIndex] = useState(0);
  const [openedId, setOpenedId] = useState<string | null>(null);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());

  // Keep the cursor inside the list as it changes.
  useEffect(() => {
    setActiveIndex((i) => Math.max(0, Math.min(i, notifications.length - 1)));
  }, [notifications.length]);
  useEffect(() => {
    setActiveIndex(0);
    setOpenedId(null);
  }, [filter, workspaceId]);

  // Keep the opened notification even when it leaves the list (e.g. archived).
  const [openedSnapshot, setOpenedSnapshot] = useState<NotificationDto | null>(null);
  const opened = useMemo(
    () =>
      notifications.find((n) => n.id === openedId) ??
      (openedSnapshot?.id === openedId ? openedSnapshot : null),
    [notifications, openedId, openedSnapshot]
  );
  const active = notifications[activeIndex];

  const open = (notification: NotificationDto, index: number) => {
    setActiveIndex(index);
    setOpenedId(notification.id);
    setOpenedSnapshot(notification);
    if (!notification.readAt) actions.markRead.mutate(notification.id);
  };

  const archiveToggle = (n: NotificationDto) => {
    if (n.archivedAt) {
      actions.unarchive.mutate(n.id, { onSuccess: () => toast.success('Moved back to the inbox') });
    } else {
      actions.archive.mutate(n.id, { onSuccess: () => toast.success('Marked done') });
    }
  };
  const snooze = (n: NotificationDto) => {
    const until = tomorrowMorning();
    actions.snooze.mutate(
      { id: n.id, until: until.toISOString() },
      {
        onSuccess: () =>
          toast.success(
            `Snoozed until ${until.toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' })}`
          ),
      }
    );
  };
  const toggleRead = (n: NotificationDto) =>
    n.readAt ? actions.markUnread.mutate(n.id) : actions.markRead.mutate(n.id);

  const move = (delta: number) => {
    if (notifications.length === 0) return;
    const next = Math.max(0, Math.min(notifications.length - 1, activeIndex + delta));
    setActiveIndex(next);
    const n = notifications[next];
    if (n) rowRefs.current.get(n.id)?.scrollIntoView({ block: 'nearest' });
  };
  const target = () => active ?? opened ?? undefined;

  useHotkey('j', () => move(1));
  useHotkey('arrowdown', () => move(1));
  useHotkey('k', () => move(-1));
  useHotkey('arrowup', () => move(-1));
  // Enter on a focused control keeps its native action (a focused row opens itself).
  useHotkey('enter', () => active && open(active, activeIndex), {
    enabled: Boolean(active),
    when: (event) =>
      !(event.target instanceof HTMLElement) ||
      event.target === document.body ||
      event.target.id === 'main',
  });
  useHotkey('e', () => {
    const n = target();
    if (n) archiveToggle(n);
  });
  useHotkey('h', () => {
    const n = target();
    if (n && !n.archivedAt) snooze(n);
  });
  useHotkey('u', () => {
    const n = target();
    if (n) toggleRead(n);
  });
  useHotkey('shift+i', () =>
    actions.readAll.mutate(undefined, { onSuccess: () => toast.success('All marked as read') })
  );
  useHotkey('escape', () => setOpenedId(null), { enabled: !isDesktop && openedId !== null });

  if (!workspaceId) return <PageSpinner label="Loading inbox" />;

  const showList = isDesktop || !opened;
  const showPreview = isDesktop || Boolean(opened);
  const empty = EMPTY[filter] ?? EMPTY.inbox;

  return (
    <div className="flex flex-col lg:-m-10 lg:h-screen lg:flex-row">
      {showList && (
        <section
          aria-labelledby="inbox-title"
          className="flex min-h-0 flex-col border-neutral-200 lg:w-[420px] lg:shrink-0 lg:border-r"
        >
          <header className="border-b border-neutral-200 px-4 pb-0 pt-4 lg:pt-6">
            <div className="mb-3 flex items-center gap-2">
              <h1 id="inbox-title" className="text-xl font-bold text-neutral-900">
                Inbox
              </h1>
              {list.isFetching && !list.isLoading && <Spinner size="sm" label="Refreshing" />}
              <button
                type="button"
                onClick={() =>
                  actions.readAll.mutate(undefined, {
                    onSuccess: () => toast.success('All marked as read'),
                  })
                }
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                aria-keyshortcuts="Shift+I"
              >
                <CheckCheck aria-hidden className="h-4 w-4" />
                Mark all read
              </button>
            </div>
            <div role="tablist" aria-label="Filter notifications" className="-mb-px flex gap-4">
              {TABS.map((tab) => (
                <button
                  key={tab.filter}
                  type="button"
                  role="tab"
                  aria-selected={filter === tab.filter}
                  aria-controls="inbox-list"
                  onClick={() => setFilter(tab.filter)}
                  className={clsx(
                    'border-b-2 pb-2 text-sm font-medium transition-colors',
                    filter === tab.filter
                      ? 'border-primary-500 text-neutral-900'
                      : 'border-transparent text-neutral-500 hover:text-neutral-800'
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </header>

          <div
            id="inbox-list"
            role="tabpanel"
            aria-label={`${TABS.find((t) => t.filter === filter)?.label} notifications`}
            className="min-h-0 flex-1 overflow-y-auto"
          >
            {list.isLoading ? (
              <PageSpinner label="Loading notifications" />
            ) : list.isError && notifications.length === 0 ? (
              <ErrorState error={list.error} resource="inbox" onRetry={() => void list.refetch()} />
            ) : notifications.length === 0 ? (
              <EmptyState icon={<InboxIcon />} title={empty.title} body={empty.body} />
            ) : (
              <>
                <ul aria-label="Notifications">
                  {notifications.map((n, index) => (
                    <NotificationRow
                      key={n.id}
                      notification={n}
                      active={index === activeIndex}
                      opened={n.id === openedId}
                      onOpen={() => open(n, index)}
                      onHover={() => setActiveIndex(index)}
                      rowRef={(el) => {
                        if (el) rowRefs.current.set(n.id, el);
                        else rowRefs.current.delete(n.id);
                      }}
                    />
                  ))}
                </ul>
                {list.hasNextPage && (
                  <div className="p-3 text-center">
                    <Button
                      variant="secondary"
                      disabled={list.isFetchingNextPage}
                      onClick={() => void list.fetchNextPage()}
                    >
                      {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
                    </Button>
                  </div>
                )}
              </>
            )}
          </div>

          <p
            className="hidden items-center gap-3 border-t border-neutral-200 px-4 py-2 text-xs text-neutral-500 lg:flex"
            aria-hidden
          >
            <span>
              <Kbd>J</Kbd> <Kbd>K</Kbd> move
            </span>
            <span>
              <Kbd>↵</Kbd> open
            </span>
            <span>
              <Kbd>E</Kbd> done
            </span>
            <span>
              <Kbd>H</Kbd> snooze
            </span>
            <span>
              <Kbd>U</Kbd> unread
            </span>
          </p>
        </section>
      )}

      {showPreview && (
        <section aria-label="Preview" className="flex min-h-0 min-w-0 flex-1 flex-col bg-white">
          {opened ? (
            <>
              <div className="flex items-center gap-1 border-b border-neutral-200 px-2 py-1.5 sm:px-4">
                {!isDesktop && (
                  <IconButton
                    label="Back to the inbox"
                    icon={<ArrowLeft />}
                    onClick={() => setOpenedId(null)}
                  />
                )}
                <span className="truncate px-1 text-sm text-neutral-600">
                  {notificationSentence(opened)}
                </span>
                <span className="ml-auto flex shrink-0 items-center">
                  <IconButton
                    label={opened.archivedAt ? 'Move to inbox' : 'Mark done'}
                    shortcut="E"
                    icon={opened.archivedAt ? <ArchiveRestore /> : <Archive />}
                    onClick={() => archiveToggle(opened)}
                  />
                  {!opened.archivedAt && (
                    <IconButton
                      label="Snooze until tomorrow 9:00"
                      shortcut="H"
                      icon={<Clock />}
                      onClick={() => snooze(opened)}
                    />
                  )}
                  <IconButton
                    label={opened.readAt ? 'Mark unread' : 'Mark read'}
                    shortcut="U"
                    icon={opened.readAt ? <Mail /> : <MailOpen />}
                    onClick={() => toggleRead(opened)}
                  />
                </span>
              </div>
              <div className="min-h-0 flex-1">
                {opened.task && !opened.task.deleted ? (
                  <TaskDetailView
                    key={opened.task.id}
                    taskId={opened.task.id}
                    mode="inline"
                    onOpenTask={openTaskSheet}
                  />
                ) : (
                  <EmptyState
                    icon={<Archive />}
                    title="This task was deleted"
                    body="It may still be in the project trash."
                    action={
                      opened.task ? (
                        <Button asChild variant="secondary">
                          <Link to={`/project/${opened.task.projectId}/trash`}>Open trash</Link>
                        </Button>
                      ) : undefined
                    }
                  />
                )}
              </div>
            </>
          ) : (
            <div className="hidden h-full items-center justify-center p-8 text-center text-sm text-neutral-500 lg:flex">
              <div>
                <p className="mb-2 font-medium text-neutral-700">
                  Select a notification to preview its task
                </p>
                <p>
                  <Kbd>J</Kbd> <Kbd>K</Kbd> to move, <Kbd>↵</Kbd> to open, <Kbd>E</Kbd> marks done,{' '}
                  <Kbd>H</Kbd> snoozes until tomorrow.
                </p>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
