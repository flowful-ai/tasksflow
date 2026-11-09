/**
 * Sub-task checklist with progress. Checking moves a sub-task to the
 * project's first "done" state, unchecking to the first backlog state.
 */
import { useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import clsx from 'clsx';
import { useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../../api/queryKeys';
import type { TaskRefDto } from '../../../api/types';
import { useCreateTask, useUpdateTask } from '../../../hooks/queries';
import { Button, Checkbox, Input } from '../../ui';
import type { DetailState, OpenTaskHandler } from './types';

interface SubtasksProps {
  taskId: string;
  projectId: string;
  subtasks: TaskRefDto[];
  states: DetailState[];
  readOnly?: boolean;
  onOpenTask: OpenTaskHandler;
}

export function firstStateOf(
  states: DetailState[],
  category: 'done' | 'backlog'
): DetailState | undefined {
  return states.find((s) => s.category === category);
}

export function Subtasks({
  taskId,
  projectId,
  subtasks,
  states,
  readOnly = false,
  onOpenTask,
}: SubtasksProps) {
  const queryClient = useQueryClient();
  const updateTask = useUpdateTask();
  const createTask = useCreateTask();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  /** Optimistic checkbox values until the parent detail refetches. */
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshParent = () =>
    queryClient.invalidateQueries({ queryKey: queryKeys.tasks.detail(taskId) });
  const isDone = (sub: TaskRefDto) => pending[sub.id] ?? sub.done;
  const doneCount = subtasks.filter(isDone).length;
  const doneState = firstStateOf(states, 'done');
  const openState = firstStateOf(states, 'backlog') ?? states.find((s) => s.category !== 'done');

  const toggle = async (sub: TaskRefDto) => {
    const next = !isDone(sub);
    const target = next ? doneState : openState;
    if (!target) return;
    setPending((p) => ({ ...p, [sub.id]: next }));
    try {
      await updateTask.mutateAsync({ taskId: sub.id, stateId: target.id });
    } catch {
      // toasted globally
    } finally {
      await refreshParent();
      setPending((p) => {
        const { [sub.id]: _removed, ...rest } = p;
        return rest;
      });
    }
  };

  const add = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    try {
      await createTask.mutateAsync({ projectId, title: trimmed, parentId: taskId });
      setTitle('');
      await refreshParent();
      inputRef.current?.focus();
    } catch {
      // toasted globally; keep the draft
    }
  };

  if (readOnly && subtasks.length === 0) return null;
  const progress = subtasks.length > 0 ? Math.round((doneCount / subtasks.length) * 100) : 0;

  return (
    <section
      aria-labelledby={`subtasks-${taskId}`}
      className="rounded-xl border border-neutral-200"
    >
      <div className="flex items-center gap-3 border-b border-neutral-100 px-3 py-2">
        <h3 id={`subtasks-${taskId}`} className="text-sm font-semibold text-neutral-800">
          Sub-tasks
        </h3>
        {subtasks.length > 0 && (
          <>
            <span
              className="text-xs tabular-nums text-neutral-500"
              aria-label={`${doneCount} of ${subtasks.length} done`}
            >
              {doneCount}/{subtasks.length}
            </span>
            <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-neutral-100">
              <span
                className="block h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </span>
          </>
        )}
        {!readOnly && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
              window.setTimeout(() => inputRef.current?.focus(), 0);
            }}
            className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
          >
            <Plus aria-hidden className="h-3.5 w-3.5" />
            Add
          </button>
        )}
      </div>

      {subtasks.length > 0 && (
        <ul className="py-1">
          {subtasks.map((sub) => {
            const done = isDone(sub);
            return (
              <li
                key={sub.id}
                className="group flex items-center gap-2.5 px-3 py-1.5 hover:bg-neutral-50"
              >
                <Checkbox
                  checked={done}
                  disabled={readOnly || (done ? !openState : !doneState)}
                  onChange={() => void toggle(sub)}
                  aria-label={`${done ? 'Reopen' : 'Complete'} ${sub.key}: ${sub.title}`}
                  className="text-emerald-600 focus:ring-emerald-500"
                />
                <button
                  type="button"
                  onClick={() => onOpenTask(sub.id)}
                  className={clsx(
                    'min-w-0 flex-1 truncate text-left text-sm hover:underline',
                    done ? 'text-neutral-400 line-through' : 'text-neutral-800'
                  )}
                >
                  {sub.title}
                </button>
                <span className="shrink-0 font-mono text-xs text-neutral-400">{sub.key}</span>
              </li>
            );
          })}
        </ul>
      )}

      {!readOnly && (adding || subtasks.length === 0) && (
        <form
          className="flex items-center gap-2 px-3 py-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Plus aria-hidden className="h-4 w-4 shrink-0 text-neutral-400" />
          <Input
            bare
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape' && title === '') {
                e.preventDefault();
                setAdding(false);
              }
            }}
            data-escape-cancels={title === '' && adding ? true : undefined}
            placeholder="Add a sub-task and press Enter"
            aria-label="New sub-task title"
            disabled={createTask.isPending}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-base placeholder:text-neutral-400 focus:ring-0 md:text-sm"
          />
          {title.trim() && (
            <Button type="submit" size="xs" disabled={createTask.isPending}>
              Add
            </Button>
          )}
        </form>
      )}
    </section>
  );
}
