/**
 * One chronological activity stream (oldest first): task history as compact
 * lines ("Jo moved Todo → In progress · 1h ago") and comments as cards.
 * Older history pages load on demand; comments older than the oldest loaded
 * history entry wait for that page so the order stays right.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Bot, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { commentsApi } from '../../../api/tasks';
import { queryKeys } from '../../../api/queryKeys';
import type { CommentDto, HistoryDisplayValueDto, TaskHistoryItemDto } from '../../../api/types';
import { useDeleteComment, useTaskComments, useTaskHistory } from '../../../hooks/queries';
import {
  ConfirmDialog,
  ColorDot,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Avatar,
  IconButton,
  Spinner,
} from '../../ui';
import type { PickerMember } from '../AssigneePicker';
import { formatDateTime, relativeTime } from '../../../lib/time';
import { CommentComposer } from './CommentComposer';
import { Markdown } from './Markdown';
import { priorityLabel } from './types';

type TimelineEntry =
  | { kind: 'event'; at: string; id: string; event: TaskHistoryItemDto }
  | { kind: 'comment'; at: string; id: string; comment: CommentDto };

const RELATION_TEXT: Record<string, { outgoing: string; incoming: string }> = {
  blocks: { outgoing: 'blocking', incoming: 'blocked by' },
  relates: { outgoing: 'related to', incoming: 'related to' },
  duplicates: { outgoing: 'a duplicate of', incoming: 'duplicated by' },
};

function displayText(value: HistoryDisplayValueDto | null, field: string | null): ReactNode {
  if (!value) return null;
  switch (value.kind) {
    case 'state':
      return (
        <span className="inline-flex items-center gap-1">
          <ColorDot color={value.color} size="xs" />
          {value.name}
        </span>
      );
    case 'user':
      return value.name ?? 'someone';
    case 'label':
      return value.name;
    case 'task':
      return value.task.key;
    case 'comment':
      return value.excerpt ?? 'a comment';
    case 'relation':
      return value.task?.key ?? 'a task';
    case 'value': {
      const raw = value.value;
      if (raw === null) return null;
      if (field === 'priority' && typeof raw === 'string') return priorityLabel(raw);
      if ((field === 'dueDate' || field === 'startDate') && typeof raw === 'string') {
        return new Date(raw).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        });
      }
      return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean'
        ? String(raw)
        : null;
    }
  }
}

const B = ({ children }: { children: ReactNode }) => (
  <b className="font-medium text-neutral-800">{children}</b>
);

/** The sentence after the actor's name, or null for events the stream does not show. */
export function describeEvent(event: TaskHistoryItemDto): ReactNode | null {
  const from = displayText(event.from, event.field);
  const to = displayText(event.to, event.field);
  switch (event.type) {
    case 'created':
      return 'created the task';
    case 'deleted':
      return 'deleted the task';
    case 'restored':
      return 'restored the task';
    case 'commented':
      return null; // the comment card is the entry
    case 'assigned':
      return event.to?.kind === 'user' && event.actor?.id === event.to.id ? (
        'self-assigned the task'
      ) : (
        <>
          assigned <B>{to}</B>
        </>
      );
    case 'unassigned':
      return (
        <>
          unassigned <B>{from ?? to}</B>
        </>
      );
    case 'labeled':
      return (
        <>
          added label <B>{to}</B>
        </>
      );
    case 'unlabeled':
      return (
        <>
          removed label <B>{from ?? to}</B>
        </>
      );
    case 'linked':
      return (
        <>
          linked <B>{to}</B>
        </>
      );
    case 'relation_added':
    case 'relation_removed': {
      const relation = event.type === 'relation_added' ? event.to : (event.from ?? event.to);
      const verb = event.type === 'relation_added' ? 'marked this as' : 'removed the relation:';
      if (relation?.kind === 'relation') {
        const text = RELATION_TEXT[relation.type]?.[relation.direction] ?? relation.type;
        return (
          <>
            {verb} {text} <B>{relation.task?.key ?? 'a task'}</B>
          </>
        );
      }
      return event.type === 'relation_added' ? 'added a relation' : 'removed a relation';
    }
    case 'moved':
    case 'updated':
      switch (event.field) {
        case 'stateId':
          return from ? (
            <>
              moved {from} → <B>{to}</B>
            </>
          ) : (
            <>
              moved to <B>{to}</B>
            </>
          );
        case 'title':
          return (
            <>
              renamed the task to <B>{to}</B>
            </>
          );
        case 'description':
          return 'updated the description';
        case 'priority':
          return to ? (
            <>
              set priority to <B>{to}</B>
            </>
          ) : (
            'removed the priority'
          );
        case 'dueDate':
          return to ? (
            <>
              set the due date to <B>{to}</B>
            </>
          ) : (
            'removed the due date'
          );
        case 'startDate':
          return to ? (
            <>
              set the start date to <B>{to}</B>
            </>
          ) : (
            'removed the start date'
          );
        case 'parentId':
          return to ? (
            <>
              set the parent to <B>{to}</B>
            </>
          ) : (
            'removed the parent'
          );
        case 'position':
          return null; // reordering within a column is noise
        default:
          return event.type === 'moved' ? 'moved the task' : 'updated the task';
      }
    default:
      return 'updated the task';
  }
}

function actorName(event: TaskHistoryItemDto): string {
  return event.actor?.name ?? event.agent?.name ?? 'Someone';
}

function EventLine({ event }: { event: TaskHistoryItemDto }) {
  const text = describeEvent(event);
  if (!text) return null;
  return (
    <li className="relative flex items-start gap-2 py-1 pl-6 text-[13px] text-neutral-500">
      <span
        aria-hidden
        className="absolute left-[7px] top-[11px] h-1.5 w-1.5 rounded-full bg-neutral-300"
      />
      <p className="min-w-0">
        <B>{actorName(event)}</B> {text}
        {event.agent && event.actor && (
          <span className="text-neutral-400"> via {event.agent.name}</span>
        )}
        <span className="text-neutral-400">
          {' · '}
          <time dateTime={event.createdAt} title={formatDateTime(event.createdAt)}>
            {relativeTime(event.createdAt)}
          </time>
        </span>
      </p>
    </li>
  );
}

interface CommentCardProps {
  comment: CommentDto;
  taskId: string;
  currentUserId: string | undefined;
  canModerate: boolean;
  members: PickerMember[];
}

function CommentCard({ comment, taskId, currentUserId, canModerate, members }: CommentCardProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const remove = useDeleteComment(taskId);
  const update = useMutation({
    mutationFn: (content: string) => commentsApi.update(taskId, comment.id, content),
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.tasks.comments(taskId) }),
    meta: { errorMessage: 'Could not update the comment' },
  });

  const author = comment.agent?.name || comment.user?.name || comment.user?.email || 'Unknown user';
  const isOwn = Boolean(currentUserId) && comment.userId === currentUserId;
  const edited = comment.updatedAt && comment.updatedAt !== comment.createdAt;

  return (
    <li className="py-1.5">
      <article
        aria-label={`Comment by ${author}`}
        className="rounded-xl border border-neutral-200 bg-white px-3 py-2.5 shadow-card"
      >
        <header className="mb-1 flex items-center gap-2 text-[13px]">
          {comment.agent ? (
            <span
              aria-hidden
              className="grid h-5 w-5 place-items-center rounded-full bg-purple-100 text-purple-700"
            >
              <Bot className="h-3 w-3" />
            </span>
          ) : (
            comment.user && (
              <Avatar
                src={comment.user.avatarUrl}
                name={comment.user.name}
                email={comment.user.email}
                size="xs"
              />
            )
          )}
          <b className="font-semibold text-neutral-900">{author}</b>
          {comment.agent && (
            <span className="rounded bg-purple-100 px-1.5 text-[11px] font-medium text-purple-700">
              Agent
            </span>
          )}
          <span className="text-neutral-400">
            ·{' '}
            <time dateTime={comment.createdAt} title={formatDateTime(comment.createdAt)}>
              {relativeTime(comment.createdAt)}
            </time>
            {edited && ' · edited'}
          </span>
          {(isOwn || canModerate) && !editing && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  label="Comment actions"
                  size="xs"
                  icon={<MoreHorizontal />}
                  className="ml-auto"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isOwn && (
                  <DropdownMenuItem icon={<Pencil />} onSelect={() => setEditing(true)}>
                    Edit
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem
                  icon={<Trash2 />}
                  destructive
                  onSelect={() => setConfirmDelete(true)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </header>
        {editing ? (
          <CommentComposer
            members={members}
            initialContent={comment.content}
            submitLabel="Save"
            isSubmitting={update.isPending}
            autoFocus
            onCancel={() => setEditing(false)}
            onSubmit={async (content) => {
              await update.mutateAsync(content);
              setEditing(false);
            }}
          />
        ) : (
          <Markdown>{comment.content}</Markdown>
        )}
      </article>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this comment?"
        description="It will be removed for everyone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={() => remove.mutateAsync(comment.id).then(() => undefined)}
      />
    </li>
  );
}

interface TimelineProps {
  taskId: string;
  currentUserId: string | undefined;
  canModerate: boolean;
  members: PickerMember[];
}

export function Timeline({ taskId, currentUserId, canModerate, members }: TimelineProps) {
  const history = useTaskHistory(taskId, 30);
  const { data: comments = [], isLoading: commentsLoading } = useTaskComments(taskId);

  const entries = useMemo<TimelineEntry[]>(() => {
    const events: TimelineEntry[] = history.items
      .filter((event) => describeEvent(event) !== null)
      .map((event) => ({ kind: 'event', at: event.createdAt, id: event.id, event }));
    const oldestLoaded = history.items.at(-1)?.createdAt;
    const visibleComments: TimelineEntry[] = comments
      .filter((c) => !history.hasNextPage || !oldestLoaded || c.createdAt >= oldestLoaded)
      .map((comment) => ({ kind: 'comment', at: comment.createdAt, id: comment.id, comment }));
    return [...events, ...visibleComments].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  }, [history.items, history.hasNextPage, comments]);

  const loading = (history.isLoading || commentsLoading) && entries.length === 0;

  return (
    <div>
      {history.hasNextPage && (
        <button
          type="button"
          onClick={() => void history.fetchNextPage()}
          disabled={history.isFetchingNextPage}
          className="mb-1 ml-6 text-xs font-medium text-neutral-500 hover:text-neutral-800 disabled:opacity-60"
        >
          {history.isFetchingNextPage ? 'Loading…' : 'Show older activity'}
        </button>
      )}
      {loading ? (
        <div className="flex justify-center py-4">
          <Spinner size="sm" label="Loading activity" />
        </div>
      ) : (
        <ol
          aria-label="Activity"
          className="relative before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-neutral-200"
        >
          {entries.map((entry) =>
            entry.kind === 'event' ? (
              <EventLine key={entry.id} event={entry.event} />
            ) : (
              <CommentCard
                key={entry.id}
                comment={entry.comment}
                taskId={taskId}
                currentUserId={currentUserId}
                canModerate={canModerate}
                members={members}
              />
            )
          )}
        </ol>
      )}
      {history.isError && (
        <p className="mt-2 text-xs text-primary-700">Couldn't load the activity history.</p>
      )}
    </div>
  );
}
