import { memo, type KeyboardEvent, type MouseEvent } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { CircleDot, GitPullRequest } from 'lucide-react';
import { githubLinkLabel } from '@flowtask/shared/utils';
import { TaskContextMenu, type ContextMenuState } from '../tasks/TaskContextMenu';
import { ColorDot } from '../ui/ColorDot';
import { PriorityIcon, priorityLabel } from '../board/PriorityIcon';
import { isOverdue } from '../board/filters';
import { projectColor } from '../../lib/color';

/** Modifier keys of the click/keypress that opened a card (ctrl/⌘ toggles selection, shift selects a range). */
export type TaskOpenEvent = { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean };

interface TaskCardTask {
  id: string;
  title: string;
  priority: string | null;
  dueDate: string | null;
  position?: string;
  /** "TF-42" (falls back to identifier-sequenceNumber). */
  key?: string;
  parentId?: string | null;
  subtaskCount?: number;
  subtaskDoneCount?: number;
  externalLinks?: {
    id: string;
    externalType: 'github_issue' | 'github_pr';
    externalId: string;
    externalUrl: string;
  }[];
  state: {
    id: string;
    name: string;
    color: string | null;
    category?: string;
  } | null;
  assignees: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl?: string | null;
  }[];
  labels: {
    id: string;
    name: string;
    color: string | null;
  }[];
  project: {
    id: string;
    identifier: string;
    name: string;
  };
  agent?: {
    id: string;
    name: string;
  } | null;
  sequenceNumber: number;
  updatedAt?: string | null;
}

export type TaskCardVariant = 'card' | 'row';

interface TaskCardProps {
  task: TaskCardTask;
  /** Stable callback: receives the task id so one function serves every card. */
  onOpen: (taskId: string, event: TaskOpenEvent) => void;
  showProject?: boolean;
  showState?: boolean;
  draggable?: boolean;
  isSelected?: boolean;
  states?: ContextMenuState[];
  variant?: TaskCardVariant;
}

export function taskKeyOf(task: Pick<TaskCardTask, 'key' | 'project' | 'sequenceNumber'>): string {
  return task.key ?? `${task.project.identifier}-${task.sequenceNumber}`;
}

// Dark enough for white initials at 9–10px (≥ 4.5:1).
const AVATAR_COLORS = [
  '#6d28d9',
  '#0e7490',
  '#c2410c',
  '#15803d',
  '#1d4ed8',
  '#be185d',
  '#4338ca',
  '#0f766e',
];

function avatarColor(id: string): string {
  // FNV-1a: spreads similar ids (sequential uuids) across the palette.
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length];
}

function initials(name: string | null, email: string): string {
  const source = (name || email).trim();
  const parts = source.split(/[\s._@-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2);
  return letters.toUpperCase();
}

function formatDue(dueDate: string): string {
  const date = new Date(dueDate);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function AvatarStack({
  assignees,
  max = 3,
}: {
  assignees: TaskCardTask['assignees'];
  max?: number;
}) {
  if (assignees.length === 0) return null;
  const names = assignees.map((a) => a.name || a.email).join(', ');
  return (
    <span className="flex shrink-0 items-center -space-x-1.5" title={names}>
      <span className="sr-only">Assigned to {names}</span>
      {assignees.slice(0, max).map((assignee) =>
        assignee.avatarUrl ? (
          <img
            key={assignee.id}
            src={assignee.avatarUrl}
            alt=""
            className="h-5 w-5 rounded-full border-2 border-white object-cover"
          />
        ) : (
          <span
            key={assignee.id}
            aria-hidden
            className="grid h-5 w-5 place-items-center rounded-full border-2 border-white text-[9px] font-bold text-white"
            style={{ backgroundColor: avatarColor(assignee.id) }}
          >
            {initials(assignee.name, assignee.email)}
          </span>
        )
      )}
      {assignees.length > max && (
        <span
          aria-hidden
          className="grid h-5 w-5 place-items-center rounded-full border-2 border-white bg-neutral-200 text-[9px] font-bold text-neutral-700"
        >
          +{assignees.length - max}
        </span>
      )}
    </span>
  );
}

function SubtaskProgress({ done, total }: { done: number; total: number }) {
  const pct = Math.round((Math.min(done, total) / total) * 100);
  return (
    <span className="flex items-center gap-1.5 text-[11.5px] text-neutral-500">
      <span aria-hidden className="h-1 w-10 overflow-hidden rounded bg-neutral-200">
        <span className="block h-full rounded bg-emerald-600" style={{ width: `${pct}%` }} />
      </span>
      {done}/{total} sub-tasks
    </span>
  );
}

function GitHubChip({ links }: { links: NonNullable<TaskCardTask['externalLinks']> }) {
  const link = links.find((l) => l.externalType === 'github_pr') ?? links[0];
  if (!link) return null;
  const isPr = link.externalType === 'github_pr';
  const Icon = isPr ? GitPullRequest : CircleDot;
  const label = githubLinkLabel(link);
  return (
    <span
      title={label.full}
      className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-1.5 text-[11.5px] text-neutral-600"
    >
      <Icon aria-hidden className="h-3 w-3" />
      <span className="sr-only">
        {isPr ? 'Pull request' : 'Issue'} {label.full}
      </span>
      <span aria-hidden>{label.short}</span>
    </span>
  );
}

function LabelPills({ labels, max }: { labels: TaskCardTask['labels']; max: number }) {
  return (
    <>
      {labels.slice(0, max).map((label) => (
        <span
          key={label.id}
          className="inline-flex max-w-[9rem] items-center gap-1 rounded-full border border-neutral-200 px-1.5 text-[11.5px] text-neutral-600"
        >
          <ColorDot color={label.color} size="sm" />
          <span className="truncate">{label.name}</span>
        </span>
      ))}
      {labels.length > max && (
        <span className="text-[11.5px] text-neutral-500">+{labels.length - max}</span>
      )}
    </>
  );
}

function StateChip({ state }: { state: NonNullable<TaskCardTask['state']> }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-neutral-200 px-1.5 text-[11.5px] font-medium text-neutral-700">
      <ColorDot color={state.color} size="sm" />
      {state.name}
    </span>
  );
}

function DueChip({ task }: { task: TaskCardTask }) {
  if (!task.dueDate) return null;
  const late = isOverdue(task);
  return (
    <span
      className={clsx(
        'whitespace-nowrap text-[11.5px]',
        late ? 'font-semibold text-primary-700' : 'text-neutral-500'
      )}
    >
      {late ? 'Overdue · ' : <span className="sr-only">Due </span>}
      {formatDue(task.dueDate)}
    </span>
  );
}

interface BodyProps {
  task: TaskCardTask;
  showState: boolean;
  showProject: boolean;
  variant: TaskCardVariant;
}

/** Card content; memoised so drag re-renders of the sortable wrapper stay cheap. */
const TaskCardBody = memo(function TaskCardBody({
  task,
  showState,
  showProject,
  variant,
}: BodyProps) {
  const key = taskKeyOf(task);
  const isDone = task.state?.category === 'done';
  const subtaskTotal = task.subtaskCount ?? 0;
  const links = task.externalLinks ?? [];

  if (variant === 'row') {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 md:flex-nowrap">
        <span className="order-1 flex w-4 justify-center">
          <PriorityIcon priority={task.priority} />
        </span>
        <span className="order-1 shrink-0 font-mono text-[11.5px] font-semibold text-neutral-400">
          {key}
        </span>
        <span
          className={clsx(
            'order-3 basis-full text-sm font-medium text-neutral-900 line-clamp-2 md:order-2 md:basis-auto md:flex-1 md:truncate md:line-clamp-none',
            isDone && 'text-neutral-500 line-through'
          )}
        >
          {task.title}
        </span>
        <span className="order-2 ml-auto flex min-w-0 items-center gap-1.5 md:order-3 md:ml-0">
          <span className="hidden items-center gap-1.5 lg:flex">
            <LabelPills labels={task.labels} max={2} />
          </span>
          {showState && task.state && <StateChip state={task.state} />}
          {subtaskTotal > 0 && (
            <span className="hidden sm:inline">
              <SubtaskProgress done={task.subtaskDoneCount ?? 0} total={subtaskTotal} />
            </span>
          )}
          {links.length > 0 && (
            <span className="hidden sm:inline-flex">
              <GitHubChip links={links} />
            </span>
          )}
          <DueChip task={task} />
          <AvatarStack assignees={task.assignees} />
        </span>
      </div>
    );
  }

  const hasMeta =
    task.labels.length > 0 ||
    links.length > 0 ||
    task.dueDate ||
    task.assignees.length > 0 ||
    task.agent;
  return (
    <div className={clsx('flex flex-col gap-[7px]', isDone && 'opacity-60')}>
      <div className="flex items-center gap-1.5">
        <PriorityIcon priority={task.priority} />
        <span className="font-mono text-[11.5px] font-semibold text-neutral-400">{key}</span>
        {showProject && (
          <span className="flex min-w-0 items-center gap-1 truncate text-[11.5px] text-neutral-400">
            <ColorDot color={projectColor(task.project.id)} />
            {task.project.name}
          </span>
        )}
        {showState && task.state && (
          <span className="ml-auto">
            <StateChip state={task.state} />
          </span>
        )}
      </div>
      <p
        className={clsx(
          'text-sm font-medium leading-snug text-neutral-900 line-clamp-2 break-words',
          isDone && 'line-through'
        )}
      >
        {task.title}
      </p>
      {subtaskTotal > 0 && (
        <SubtaskProgress done={task.subtaskDoneCount ?? 0} total={subtaskTotal} />
      )}
      {hasMeta && (
        <div className="flex flex-wrap items-center gap-1.5">
          <LabelPills labels={task.labels} max={3} />
          {links.length > 0 && <GitHubChip links={links} />}
          {task.agent && (
            <span className="inline-flex items-center rounded-full border border-neutral-200 px-1.5 text-[11.5px] text-neutral-600">
              {task.agent.name}
            </span>
          )}
          <DueChip task={task} />
          <span className="ml-auto">
            <AvatarStack assignees={task.assignees} />
          </span>
        </div>
      )}
    </div>
  );
});

function openEvent(event: MouseEvent | KeyboardEvent): TaskOpenEvent {
  return { ctrlKey: event.ctrlKey, metaKey: event.metaKey, shiftKey: event.shiftKey };
}

function cardClassName(variant: TaskCardVariant, isSelected: boolean): string {
  return clsx(
    'relative cursor-pointer bg-white outline-none transition-[border-color,box-shadow]',
    variant === 'card'
      ? 'rounded-[10px] border border-neutral-200 px-[11px] py-2.5 hover:border-neutral-300 hover:shadow-sm'
      : 'border-b border-neutral-100 px-3 py-2 last:border-b-0 hover:bg-neutral-50',
    'focus-visible:ring-2 focus-visible:ring-primary-500/60 focus-visible:ring-offset-1',
    isSelected &&
      (variant === 'card'
        ? 'outline outline-2 -outline-offset-1 outline-primary-500'
        : 'bg-primary-50/60')
  );
}

function ariaLabel(task: TaskCardTask): string {
  const priority = priorityLabel(task.priority);
  return `${taskKeyOf(task)}: ${task.title}${priority ? `, ${priority} priority` : ''}`;
}

function withContextMenu(
  task: TaskCardTask,
  states: ContextMenuState[] | undefined,
  card: JSX.Element
) {
  if (!states || states.length === 0) return card;
  return (
    <TaskContextMenu
      taskId={task.id}
      projectId={task.project.id}
      currentPriority={task.priority}
      currentStateId={task.state?.id ?? null}
      assigneeIds={task.assignees.map((a) => a.id)}
      states={states}
    >
      {card}
    </TaskContextMenu>
  );
}

/** A draggable card on the board. While dragged, it renders as the drop placeholder. */
const SortableTaskCard = memo(function SortableTaskCard({
  task,
  onOpen,
  showProject = false,
  showState = false,
  isSelected = false,
  states,
  variant = 'card',
}: TaskCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      onOpen(task.id, openEvent(event));
      return;
    }
    // Space picks the card up (dnd-kit keyboard sensor).
    listeners?.onKeyDown?.(event);
  };

  const card = (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...attributes}
      {...listeners}
      data-task-id={task.id}
      role="button"
      tabIndex={0}
      aria-roledescription="draggable task"
      aria-label={ariaLabel(task)}
      aria-pressed={isSelected || undefined}
      onClick={(event) => onOpen(task.id, openEvent(event))}
      onKeyDown={handleKeyDown}
      className={clsx(
        cardClassName(variant, isSelected),
        isDragging &&
          '!border-2 !border-dashed !border-neutral-300 !bg-transparent !shadow-none !outline-none'
      )}
    >
      <div className={clsx(isDragging && 'invisible')}>
        <TaskCardBody
          task={task}
          showState={showState}
          showProject={showProject}
          variant={variant}
        />
      </div>
    </div>
  );
  return withContextMenu(task, states, card);
});

/** A card without drag (list view, read-only boards). */
const StaticTaskCard = memo(function StaticTaskCard({
  task,
  onOpen,
  showProject = false,
  showState = false,
  isSelected = false,
  states,
  variant = 'card',
}: TaskCardProps) {
  const card = (
    <div
      data-task-id={task.id}
      role="button"
      tabIndex={0}
      aria-label={ariaLabel(task)}
      aria-pressed={isSelected || undefined}
      onClick={(event) => onOpen(task.id, openEvent(event))}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onOpen(task.id, openEvent(event));
        }
      }}
      className={cardClassName(variant, isSelected)}
    >
      <TaskCardBody task={task} showState={showState} showProject={showProject} variant={variant} />
    </div>
  );
  return withContextMenu(task, states, card);
});

export function TaskCard({ draggable = false, ...props }: TaskCardProps) {
  return draggable ? <SortableTaskCard {...props} /> : <StaticTaskCard {...props} />;
}

/** The card under the pointer while dragging (DragOverlay): tilted, lifted, not focusable. */
export function TaskCardOverlay({
  task,
  showState = false,
  showProject = false,
}: Pick<TaskCardProps, 'task' | 'showState' | 'showProject'>) {
  return (
    <div className="rotate-2 cursor-grabbing rounded-[10px] border border-neutral-200 bg-white px-[11px] py-2.5 shadow-[0_10px_24px_rgb(0_0_0/0.15)]">
      <TaskCardBody task={task} showState={showState} showProject={showProject} variant="card" />
    </div>
  );
}

// Export the task type for reuse
export type { TaskCardTask };
