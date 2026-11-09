import { memo, useRef, useState, type ReactNode } from 'react';
import { useDroppable } from '@dnd-kit/core';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { ColorDot } from '../ui/ColorDot';
import { IconButton } from '../ui/IconButton';

interface GroupedKanbanColumnProps {
  id: string;
  name: string;
  color: string | null;
  taskCount: number;
  children: ReactNode;
  /** Opens quick-create pre-set to this column (header "+"). */
  onAddTask?: () => void;
  /** Inline "+ Add task" at the bottom; resolves once the task exists. */
  onQuickAdd?: (title: string) => Promise<void>;
  collapsible?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  /** Disable the droppable (read-only boards). */
  droppable?: boolean;
  emptyText?: string;
  /** Narrow columns for the grouped (rows) layout. */
  compact?: boolean;
}

function QuickAdd({ columnName, onCreate }: { columnName: string; onCreate: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center gap-1 rounded-lg px-2 py-1.5 text-left text-[12.5px] text-neutral-500 hover:bg-white hover:text-neutral-700"
      >
        <Plus aria-hidden className="h-3.5 w-3.5" />
        Add task
      </button>
    );
  }

  const submit = async () => {
    const value = title.trim();
    if (!value || saving) return;
    setSaving(true);
    try {
      await onCreate(value);
      setTitle('');
    } catch {
      // The global mutation handler toasts; keep the text so nothing is lost.
    } finally {
      setSaving(false);
      inputRef.current?.focus();
    }
  };

  return (
    <div className="rounded-[10px] border border-neutral-300 bg-white p-2 shadow-sm">
      <input
        ref={inputRef}
        autoFocus
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            void submit();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
            setTitle('');
          }
        }}
        onBlur={() => {
          if (!title.trim() && !saving) setOpen(false);
        }}
        disabled={saving}
        placeholder="Task title"
        aria-label={`New task in ${columnName}`}
        className="w-full bg-transparent text-base outline-none placeholder:text-neutral-400 md:text-sm"
      />
      <p className="mt-1 text-[11px] text-neutral-400">Enter to add · Esc to close</p>
    </div>
  );
}

export const GroupedKanbanColumn = memo(function GroupedKanbanColumn({
  id,
  name,
  color,
  taskCount,
  children,
  onAddTask,
  onQuickAdd,
  collapsible = false,
  collapsed = false,
  onToggleCollapsed,
  droppable = true,
  emptyText = 'No tasks',
  compact = false,
}: GroupedKanbanColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !droppable });

  if (collapsed) {
    return (
      <section aria-label={`${name}, ${taskCount} tasks, collapsed`} data-column={id} className="flex-shrink-0">
        <div
          ref={setNodeRef}
          className={clsx(
            'flex h-full min-h-[200px] w-10 flex-col items-center gap-2 rounded-xl py-2 transition-colors',
            isOver ? 'bg-primary-50' : 'bg-neutral-100/70'
          )}
        >
          <IconButton label={`Expand ${name}`} icon={<ChevronRight />} size="xs" onClick={onToggleCollapsed} aria-expanded={false} />
          <ColorDot color={color} size="sm" />
          <span className="text-xs font-medium text-neutral-500">{taskCount}</span>
          <span className="text-[13px] font-semibold text-neutral-700 [writing-mode:vertical-rl]">{name}</span>
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label={`${name}, ${taskCount} tasks`}
      data-column={id}
      className={clsx('flex flex-shrink-0 flex-col gap-2', compact ? 'w-60' : 'w-[264px]')}
    >
      <header className="flex items-center gap-[7px] px-1 py-0.5 text-[13px] font-semibold text-neutral-900">
        <ColorDot color={color} size="sm" />
        <h3 className="truncate">{name}</h3>
        <span className="font-medium text-neutral-400">{taskCount}</span>
        <span className="ml-auto flex items-center">
          {onAddTask && <IconButton label={`Add task to ${name}`} icon={<Plus />} size="xs" onClick={onAddTask} />}
          {collapsible && (
            <IconButton label={`Collapse ${name}`} icon={<ChevronDown />} size="xs" onClick={onToggleCollapsed} aria-expanded />
          )}
        </span>
      </header>

      <div
        ref={setNodeRef}
        className={clsx(
          'flex min-h-[120px] flex-1 flex-col gap-2 rounded-xl p-1.5 transition-colors',
          isOver ? 'bg-primary-50/70' : 'bg-neutral-100/70'
        )}
      >
        {children}
        {taskCount === 0 && <p className="px-2 py-3 text-center text-xs text-neutral-400">{emptyText}</p>}
        {onQuickAdd && <QuickAdd columnName={name} onCreate={onQuickAdd} />}
      </div>
    </section>
  );
});
