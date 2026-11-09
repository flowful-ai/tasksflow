/**
 * Properties panel (mockup section 4, right column): each row is a
 * click-to-edit popover that reuses the shared pickers' option lists.
 */
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, X } from 'lucide-react';
import clsx from 'clsx';
import type { TaskPriority } from '@flowtask/shared';
import { ColorDot, Popover, PopoverContent, PopoverTrigger } from '../../ui';
import { AssigneeOptions, Avatar, type PickerMember } from '../AssigneePicker';
import { LabelOptions } from '../LabelPicker';
import { DueDateOptions } from '../DueDatePicker';
import { GitHubLinkSection } from '../GitHubLinkSection';
import { PriorityIcon } from './PriorityIcon';
import { TaskSearchPopover } from './TaskSearchPopover';
import { PRIORITY_OPTIONS, priorityLabel, type DetailState, type OpenTaskHandler, type TaskDetail } from './types';

export interface PropertiesProps {
  task: TaskDetail;
  states: DetailState[];
  projectLabels: { id: string; name: string; color: string | null }[];
  members: PickerMember[];
  workspaceId: string | null | undefined;
  readOnly?: boolean;
  onUpdate: (input: { stateId?: string; priority?: TaskPriority | null; dueDate?: string | null; parentId?: string | null }) => void;
  onToggleAssignee: (userId: string) => void;
  onToggleLabel: (labelId: string) => void;
  onOpenTask: OpenTaskHandler;
  onUpdated?: () => void;
}

const formatDue = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function isOverdue(iso: string, done: boolean): boolean {
  if (done) return false;
  const due = new Date(iso);
  const today = new Date();
  return due.getTime() < Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
}

const valueClass =
  'flex min-h-[32px] w-full min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-left text-sm text-neutral-800 transition-colors hover:bg-neutral-100 data-[state=open]:bg-neutral-100 disabled:cursor-default disabled:hover:bg-transparent';

interface RowProps {
  id: string;
  label: string;
  value: ReactNode;
  /** Popover body; omit for read-only rows. */
  editor?: (close: () => void) => ReactNode;
  editorLabel?: string;
  editorClassName?: string;
}

function PropertyRow({ id, label, value, editor, editorLabel, editorClassName }: RowProps) {
  const [open, setOpen] = useState(false);
  const labelId = `prop-${id}`;
  return (
    <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2 py-0.5">
      <dt id={labelId} className="text-[13px] text-neutral-500">
        {label}
      </dt>
      <dd className="min-w-0">
        {editor ? (
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <button type="button" aria-labelledby={`${labelId} ${labelId}-value`} className={valueClass}>
                <span id={`${labelId}-value`} className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                  {value}
                </span>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" aria-label={editorLabel ?? label} className={clsx('p-1', editorClassName)}>
              {editor(() => setOpen(false))}
            </PopoverContent>
          </Popover>
        ) : (
          <div className={clsx(valueClass, 'hover:bg-transparent')}>{value}</div>
        )}
      </dd>
    </div>
  );
}

function OptionButton({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={clsx(
        'flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm text-neutral-700 hover:bg-neutral-100 focus-visible:bg-neutral-100',
        selected && 'font-medium text-neutral-900'
      )}
    >
      {children}
      {selected && <Check aria-hidden className="ml-auto h-4 w-4 text-primary-600" />}
    </button>
  );
}

const muted = (text: string) => <span className="text-neutral-400">{text}</span>;

export function Properties({
  task,
  states,
  projectLabels,
  members,
  workspaceId,
  readOnly = false,
  onUpdate,
  onToggleAssignee,
  onToggleLabel,
  onOpenTask,
  onUpdated,
}: PropertiesProps) {
  const editable = !readOnly;
  const done = task.state?.category === 'done';
  const excludeFromParent = new Set([task.id, ...(task.subtasks ?? []).map((s) => s.id)]);

  return (
    <div className="space-y-5">
      <dl className="space-y-0.5" aria-label="Properties">
        <PropertyRow
          id="status"
          label="Status"
          value={
            task.state ? (
              <>
                <ColorDot color={task.state.color} />
                {task.state.name}
              </>
            ) : (
              muted('No status')
            )
          }
          editorLabel="Change status"
          editorClassName="w-56"
          editor={
            editable && states.length > 0
              ? (close) => (
                  <div role="listbox" aria-label="Statuses">
                    {states.map((state) => (
                      <OptionButton
                        key={state.id}
                        selected={state.id === task.stateId}
                        onClick={() => {
                          close();
                          if (state.id !== task.stateId) onUpdate({ stateId: state.id });
                        }}
                      >
                        <ColorDot color={state.color} />
                        {state.name}
                      </OptionButton>
                    ))}
                  </div>
                )
              : undefined
          }
        />

        <PropertyRow
          id="priority"
          label="Priority"
          value={
            <>
              <PriorityIcon priority={task.priority} />
              {task.priority && task.priority !== 'none' ? priorityLabel(task.priority) : muted('No priority')}
            </>
          }
          editorLabel="Change priority"
          editorClassName="w-48"
          editor={
            editable
              ? (close) => (
                  <div role="listbox" aria-label="Priorities">
                    {PRIORITY_OPTIONS.map((option) => (
                      <OptionButton
                        key={option.value}
                        selected={(task.priority ?? 'none') === option.value}
                        onClick={() => {
                          close();
                          onUpdate({ priority: option.value === 'none' ? null : option.value });
                        }}
                      >
                        <PriorityIcon priority={option.value} />
                        {option.label}
                      </OptionButton>
                    ))}
                  </div>
                )
              : undefined
          }
        />

        <PropertyRow
          id="assignees"
          label="Assignees"
          value={
            task.assignees.length > 0
              ? task.assignees.map((a) => (
                  <span key={a.id} className="inline-flex min-w-0 items-center gap-1.5">
                    <Avatar person={a} size="sm" />
                    <span className="truncate">{a.name || a.email}</span>
                  </span>
                ))
              : muted('Unassigned')
          }
          editorLabel="Change assignees"
          editorClassName="w-64 !p-0 overflow-hidden"
          editor={
            editable
              ? () => (
                  <AssigneeOptions currentAssignees={task.assignees} workspaceMembers={members} onToggle={onToggleAssignee} />
                )
              : undefined
          }
        />

        <PropertyRow
          id="labels"
          label="Labels"
          value={
            task.labels.length > 0
              ? task.labels.map((label) => (
                  <span
                    key={label.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-neutral-200 bg-white px-2 py-0.5 text-xs font-medium text-neutral-700"
                  >
                    <ColorDot color={label.color} />
                    {label.name}
                  </span>
                ))
              : muted('No labels')
          }
          editorLabel="Change labels"
          editorClassName="w-56 !p-0 overflow-hidden"
          editor={
            editable
              ? () => <LabelOptions currentLabels={task.labels} projectLabels={projectLabels} onToggle={onToggleLabel} />
              : undefined
          }
        />

        <PropertyRow
          id="due"
          label="Due"
          value={
            task.dueDate ? (
              <span className={clsx(isOverdue(task.dueDate, done) && 'font-medium text-primary-700')}>
                {isOverdue(task.dueDate, done) && 'Overdue · '}
                {formatDue(task.dueDate)}
              </span>
            ) : (
              muted('No due date')
            )
          }
          editorLabel="Change due date"
          editorClassName="w-60 !p-3"
          editor={
            editable
              ? (close) => (
                  <DueDateOptions
                    value={task.dueDate}
                    onChange={(date) => {
                      close();
                      onUpdate({ dueDate: date });
                    }}
                  />
                )
              : undefined
          }
        />

        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2 py-0.5">
          <dt className="text-[13px] text-neutral-500">Parent</dt>
          <dd className="flex min-w-0 items-center gap-1">
            {task.parent ? (
              <button
                type="button"
                onClick={() => onOpenTask(task.parent!.id)}
                className={clsx(valueClass, 'flex-1')}
                title={task.parent.title}
              >
                <span className="shrink-0 font-mono text-xs text-neutral-500">{task.parent.key}</span>
                <span className="truncate">{task.parent.title}</span>
              </button>
            ) : (
              !editable && <span className={clsx(valueClass, 'hover:bg-transparent text-neutral-400')}>None</span>
            )}
            {editable && (
              <TaskSearchPopover
                workspaceId={workspaceId}
                label="Set parent task"
                projectId={task.project.id}
                excludeIds={excludeFromParent}
                onPick={(hit) => onUpdate({ parentId: hit.id })}
                trigger={
                  task.parent ? (
                    <button
                      type="button"
                      className="rounded-md px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-800"
                    >
                      Change
                    </button>
                  ) : (
                    <button type="button" className={clsx(valueClass, 'flex-1 text-neutral-400')} aria-label="Parent: none. Set parent">
                      None
                    </button>
                  )
                }
              />
            )}
            {editable && task.parent && (
              <button
                type="button"
                aria-label="Remove parent"
                onClick={() => onUpdate({ parentId: null })}
                className="rounded-md p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"
              >
                <X aria-hidden className="h-3.5 w-3.5" />
              </button>
            )}
          </dd>
        </div>

        <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-2 py-0.5">
          <dt className="text-[13px] text-neutral-500">Project</dt>
          <dd className="min-w-0 px-2 py-1 text-sm text-neutral-800">
            {readOnly ? (
              task.project.name
            ) : (
              <Link to={`/project/${task.project.id}`} className="hover:underline">
                {task.project.name}
              </Link>
            )}
          </dd>
        </div>
      </dl>

      {!readOnly && (
        <div className="border-t border-neutral-200 pt-4">
          <GitHubLinkSection
            taskId={task.id}
            projectId={task.project.id}
            externalLinks={task.externalLinks ?? []}
            onUpdated={onUpdated}
          />
        </div>
      )}

      <p className="px-0.5 text-xs text-neutral-400">
        Created {new Date(task.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
        {task.updatedAt && ` · updated ${new Date(task.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
      </p>
    </div>
  );
}
