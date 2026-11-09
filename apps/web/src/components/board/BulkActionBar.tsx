/**
 * Floating bulk bar (mockup section 1): "N selected · Status S · Assign A ·
 * Label L · Priority P · Delete ⌫ · ✕". Every action is one
 * POST /api/tasks/bulk (state changes across projects send one per target
 * state, since states belong to a project).
 */
import { forwardRef, useMemo, type ButtonHTMLAttributes } from 'react';
import type { BulkTaskOperation, TaskPriority } from '@flowtask/shared';
import { X } from 'lucide-react';
import clsx from 'clsx';
import { summarizeBulk, useBulkTasks } from '../../hooks/queries/tasks';
import { describeBulkSummary } from '../../lib/bulk';
import { AssigneeOptions } from '../tasks/AssigneePicker';
import { LabelOptions } from '../tasks/LabelPicker';
import {
  ColorDot,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
  Kbd,
  Popover,
  PopoverContent,
  PopoverTrigger,
  toast,
} from '../ui';
import { PRIORITY_LABELS, PRIORITY_VALUES } from './filters';
import { PriorityIcon } from './PriorityIcon';
import type { BulkPicker } from './useBoardKeyboard';

interface Person {
  id: string;
  name: string | null;
  email: string;
  avatarUrl?: string | null;
}

export interface BulkBarTask {
  id: string;
  project: { id: string; identifier: string };
  assignees: Person[];
  labels: { id: string; name: string; color: string | null }[];
}

export interface BulkBarState {
  id: string;
  name: string;
  color: string | null;
  category?: string;
  projectId?: string;
}

export interface BulkBarLabel {
  id: string;
  name: string;
  color: string | null;
}

export interface BulkActionBarProps {
  tasks: BulkBarTask[];
  picker: BulkPicker | null;
  onPickerChange: (picker: BulkPicker | null) => void;
  onClear: () => void;
  states: BulkBarState[];
  members: { userId: string; user: Person }[];
  labelsByProject: Map<string, BulkBarLabel[]>;
  /** Single deletes use the undo toast instead of a confirmation. */
  onDeleteOne: (taskId: string) => void;
}

const CATEGORY_ORDER = ['backlog', 'in_progress', 'done'];
const CATEGORY_NAMES: Record<string, string> = {
  backlog: 'Backlog',
  in_progress: 'In progress',
  done: 'Done',
};

interface StatusOption {
  key: string;
  name: string;
  color: string | null;
  /** State id to apply, per project. */
  stateFor: (projectId: string) => string | null;
}

/** Values every selected task has (shown as current in the pickers). */
function intersect<T extends { id: string }>(lists: T[][]): T[] {
  if (lists.length === 0) return [];
  const [first, ...rest] = lists;
  return (first ?? []).filter((item) =>
    rest.every((list) => list.some((other) => other.id === item.id))
  );
}

interface BarButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  shortcut: string;
}

/** A bar action with its key hint; forwards ref/props so it works as a Radix trigger. */
const BarButton = forwardRef<HTMLButtonElement, BarButtonProps>(function BarButton(
  { label, shortcut, className, ...props },
  ref
) {
  return (
    <button
      ref={ref}
      type="button"
      aria-keyshortcuts={shortcut === '⌫' ? 'Backspace' : shortcut}
      className={clsx(
        'inline-flex items-center gap-1.5 rounded-[7px] bg-white/10 px-2.5 py-1 text-[12.5px] font-medium text-white hover:bg-white/20 data-[state=open]:bg-white/25 focus-visible:ring-offset-neutral-900',
        className
      )}
      {...props}
    >
      {label}
      <Kbd tone="dark" aria-hidden className="!border-white/20 !bg-transparent !text-neutral-300">
        {shortcut}
      </Kbd>
    </button>
  );
});

export function BulkActionBar({
  tasks,
  picker,
  onPickerChange,
  onClear,
  states,
  members,
  labelsByProject,
  onDeleteOne,
}: BulkActionBarProps) {
  const bulk = useBulkTasks();
  const ids = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const projectIds = useMemo(() => [...new Set(tasks.map((t) => t.project.id))], [tasks]);
  const isMultiProject = projectIds.length > 1;

  const run = async (
    action: string,
    groups: Array<{ taskIds: string[]; op: BulkTaskOperation }>,
    skipped = 0
  ) => {
    const runnable = groups.filter((g) => g.taskIds.length > 0);
    if (runnable.length === 0) {
      toast.warning(`${action}: nothing to change.`);
      return;
    }
    let updated = 0;
    let unchanged = skipped;
    let failed = 0;
    try {
      for (const group of runnable) {
        const summary = summarizeBulk(await bulk.mutateAsync(group));
        updated += summary.updated;
        unchanged += summary.unchanged;
        failed += summary.failed;
      }
    } catch {
      return; // toasted by the global mutation handler
    }
    const { level, message } = describeBulkSummary(action, {
      updated,
      unchanged,
      failed,
      results: [],
    });
    toast[level](message);
  };

  const statusOptions = useMemo<StatusOption[]>(() => {
    if (!isMultiProject) {
      const projectId = projectIds[0];
      return states
        .filter((s) => !s.projectId || s.projectId === projectId)
        .map((s) => ({ key: s.id, name: s.name, color: s.color, stateFor: () => s.id }));
    }
    const categories = CATEGORY_ORDER.filter((category) =>
      projectIds.every((projectId) =>
        states.some((s) => s.projectId === projectId && s.category === category)
      )
    );
    return categories.map((category) => ({
      key: category,
      name: CATEGORY_NAMES[category] ?? category,
      color: states.find((s) => s.category === category)?.color ?? null,
      stateFor: (projectId) =>
        states.find((s) => s.projectId === projectId && s.category === category)?.id ?? null,
    }));
  }, [isMultiProject, projectIds, states]);

  const applyStatus = (option: StatusOption) => {
    const byState = new Map<string, string[]>();
    let skipped = 0;
    for (const task of tasks) {
      const stateId = option.stateFor(task.project.id);
      if (!stateId) {
        skipped += 1;
        continue;
      }
      byState.set(stateId, [...(byState.get(stateId) ?? []), task.id]);
    }
    void run(
      `Status → ${option.name}`,
      [...byState].map(([stateId, taskIds]) => ({ taskIds, op: { stateId } })),
      skipped
    );
  };

  const applyPriority = (priority: TaskPriority) => {
    void run(`Priority → ${PRIORITY_LABELS[priority]}`, [
      { taskIds: ids, op: { priority: priority === 'none' ? null : priority } },
    ]);
  };

  // Label ids are "projectId:labelId" when the selection spans projects.
  const labelOptions = useMemo<BulkBarLabel[]>(
    () =>
      projectIds.flatMap((projectId) => {
        const identifier = tasks.find((t) => t.project.id === projectId)?.project.identifier ?? '';
        return (labelsByProject.get(projectId) ?? []).map((label) =>
          isMultiProject
            ? { ...label, id: `${projectId}:${label.id}`, name: `${identifier} · ${label.name}` }
            : label
        );
      }),
    [projectIds, labelsByProject, isMultiProject, tasks]
  );
  const commonLabels = useMemo(() => {
    const common = intersect(tasks.map((t) => t.labels));
    return isMultiProject ? [] : common;
  }, [tasks, isMultiProject]);
  const commonAssignees = useMemo(() => intersect(tasks.map((t) => t.assignees)), [tasks]);

  const labelAction = (optionId: string, mode: 'add' | 'remove') => {
    const [projectId, labelId] = isMultiProject ? optionId.split(':') : [projectIds[0], optionId];
    if (!projectId || !labelId) return;
    const taskIds = tasks.filter((t) => t.project.id === projectId).map((t) => t.id);
    const name = labelOptions.find((l) => l.id === optionId)?.name ?? 'label';
    void run(mode === 'add' ? `Added ${name}` : `Removed ${name}`, [
      { taskIds, op: mode === 'add' ? { addLabelIds: [labelId] } : { removeLabelIds: [labelId] } },
    ]);
  };

  const assigneeAction = (userId: string, mode: 'add' | 'remove') => {
    const member = members.find((m) => m.user.id === userId)?.user;
    const name = member ? member.name || member.email : 'member';
    void run(mode === 'add' ? `Assigned ${name}` : `Unassigned ${name}`, [
      {
        taskIds: ids,
        op: mode === 'add' ? { addAssigneeIds: [userId] } : { removeAssigneeIds: [userId] },
      },
    ]);
  };

  const openChange = (which: BulkPicker) => (open: boolean) => onPickerChange(open ? which : null);
  const count = tasks.length;
  if (count === 0) return null;

  return (
    <>
      <div
        role="toolbar"
        data-board-scope
        aria-label={`Bulk actions for ${count} selected task${count === 1 ? '' : 's'}`}
        className={clsx(
          'fixed inset-x-3 bottom-4 z-40 flex flex-wrap items-center gap-1.5 rounded-xl bg-neutral-900 py-2 pl-3.5 pr-2 text-[12.5px] text-white shadow-[0_12px_30px_rgb(0_0_0/0.25)]',
          'sm:inset-x-auto sm:left-1/2 sm:-translate-x-1/2 sm:flex-nowrap sm:whitespace-nowrap'
        )}
      >
        <span className="mr-1.5 font-semibold" aria-live="polite">
          {count} selected
        </span>

        <DropdownMenu open={picker === 'status'} onOpenChange={openChange('status')}>
          <DropdownMenuTrigger asChild>
            <BarButton label="Status" shortcut="S" />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            aria-label="Set status"
            className="max-h-80 overflow-y-auto"
          >
            <DropdownMenuLabel>Move {count} to…</DropdownMenuLabel>
            {statusOptions.map((option) => (
              <DropdownMenuItem
                key={option.key}
                icon={<ColorDot color={option.color} size="md" />}
                onSelect={() => applyStatus(option)}
              >
                {option.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Popover open={picker === 'assign'} onOpenChange={openChange('assign')}>
          <PopoverTrigger asChild>
            <BarButton label="Assign" shortcut="A" />
          </PopoverTrigger>
          <PopoverContent side="top" className="w-72 p-0" aria-label="Assign selected tasks">
            <AssigneeOptions
              currentAssignees={commonAssignees}
              workspaceMembers={members}
              onToggle={(userId) =>
                assigneeAction(
                  userId,
                  commonAssignees.some((a) => a.id === userId) ? 'remove' : 'add'
                )
              }
              isLoading={bulk.isPending}
            />
          </PopoverContent>
        </Popover>

        <Popover open={picker === 'label'} onOpenChange={openChange('label')}>
          <PopoverTrigger asChild>
            <BarButton label="Label" shortcut="L" />
          </PopoverTrigger>
          <PopoverContent side="top" className="w-72 p-0" aria-label="Label selected tasks">
            <LabelOptions
              currentLabels={commonLabels}
              projectLabels={labelOptions}
              onToggle={(id) =>
                labelAction(id, commonLabels.some((l) => l.id === id) ? 'remove' : 'add')
              }
              isLoading={bulk.isPending}
            />
          </PopoverContent>
        </Popover>

        <DropdownMenu open={picker === 'priority'} onOpenChange={openChange('priority')}>
          <DropdownMenuTrigger asChild>
            <BarButton label="Priority" shortcut="P" />
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" aria-label="Set priority">
            {PRIORITY_VALUES.map((priority) => (
              <DropdownMenuItem
                key={priority}
                icon={<PriorityIcon priority={priority} />}
                onSelect={() => applyPriority(priority)}
              >
                {PRIORITY_LABELS[priority]}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <BarButton
          label="Delete"
          shortcut="⌫"
          onClick={() => {
            if (count === 1 && tasks[0]) {
              onDeleteOne(tasks[0].id);
              onClear();
            } else onPickerChange('delete');
          }}
        />

        <button
          type="button"
          onClick={onClear}
          aria-label="Clear selection"
          title="Clear selection (Esc)"
          className="ml-auto rounded-[7px] p-1.5 text-neutral-300 hover:bg-white/10 hover:text-white sm:ml-0"
        >
          <X aria-hidden className="h-4 w-4" />
        </button>
      </div>

      <ConfirmDialog
        open={picker === 'delete'}
        onOpenChange={openChange('delete')}
        variant="danger"
        title={`Delete ${count} task${count === 1 ? '' : 's'}?`}
        description={`${count === 1 ? 'It moves' : 'They move'} to the project trash, where ${count === 1 ? 'it' : 'they'} can be restored for 30 days.`}
        confirmLabel="Delete"
        isLoading={bulk.isPending}
        onConfirm={async () => {
          await run('Delete', [{ taskIds: ids, op: { delete: true } }]);
          onClear();
        }}
      />
    </>
  );
}
