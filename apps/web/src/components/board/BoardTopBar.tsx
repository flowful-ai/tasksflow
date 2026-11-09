/**
 * Project top bar (mockup section 1): breadcrumb, Board/List switch, filter
 * chips with a dashed "+ Filter" menu, live indicator with the true total and
 * a "New" button with its C hint.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { Plus, X } from 'lucide-react';
import type { ProjectViewMode } from '../../stores/workspace';
import { LiveIndicator } from '../realtime/ConnectionStatus';
import {
  ColorDot,
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Kbd,
  Spinner,
} from '../ui';
import {
  DUE_LABELS,
  EMPTY_FILTERS,
  PRIORITY_LABELS,
  PRIORITY_VALUES,
  clearDimension,
  describeFilters,
  toggleValue,
  type BoardFilters,
  type DueFilter,
} from './filters';
import { PriorityIcon } from './PriorityIcon';

export interface FilterOption {
  id: string;
  name: string;
  color?: string | null;
}

interface BoardTopBarProps {
  projectName: string;
  viewMode: ProjectViewMode;
  onViewModeChange: (mode: ProjectViewMode) => void;
  filters: BoardFilters;
  onFiltersChange: (filters: BoardFilters) => void;
  currentUserId: string | null;
  members: FilterOption[];
  labels: FilterOption[];
  total: number;
  isRefreshing: boolean;
  onNewTask: () => void;
  /** Extra controls at the end (project menu). */
  actions?: ReactNode;
}

const DUE_VALUES: readonly DueFilter[] = ['overdue', 'week', 'none'];

const chipBase =
  'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-[3px] text-[12.5px] transition-colors';

// Keep the menu open while toggling several values.
const keepOpen = (event: Event) => event.preventDefault();

export function BoardTopBar({
  projectName,
  viewMode,
  onViewModeChange,
  filters,
  onFiltersChange,
  currentUserId,
  members,
  labels,
  total,
  isRefreshing,
  onNewTask,
  actions,
}: BoardTopBarProps) {
  const chips = describeFilters(filters, {
    currentUserId,
    members: new Map(members.map((m) => [m.id, m.name])),
    labels: new Map(labels.map((l) => [l.id, l.name])),
  });
  const set = (patch: Partial<BoardFilters>) => onFiltersChange({ ...filters, ...patch });

  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2.5 gap-y-2 border-b border-neutral-200 pb-3">
      <nav aria-label="Breadcrumb" className="min-w-0 max-w-full">
        <ol className="flex min-w-0 items-center gap-1 text-[15px]">
          <li className="shrink-0">
            <Link to="/projects" className="font-medium text-neutral-400 hover:text-neutral-600">
              Projects
            </Link>
          </li>
          <li aria-hidden className="text-neutral-300">
            /
          </li>
          <li className="min-w-0">
            <h1 aria-current="page" className="truncate font-semibold text-neutral-900">
              {projectName}
            </h1>
          </li>
        </ol>
      </nav>

      <div
        role="group"
        aria-label="View"
        className="flex overflow-hidden rounded-lg border border-neutral-200 text-[12.5px]"
      >
        {(['kanban', 'list'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={viewMode === mode}
            onClick={() => onViewModeChange(mode)}
            className={clsx(
              'px-2.5 py-1 font-medium',
              viewMode === mode
                ? 'bg-neutral-100 font-semibold text-neutral-900'
                : 'text-neutral-500 hover:text-neutral-800'
            )}
          >
            {mode === 'kanban' ? 'Board' : 'List'}
          </button>
        ))}
      </div>

      {filters.assigneeIds.length === 0 && currentUserId && (
        <button
          type="button"
          aria-pressed={false}
          onClick={() => set({ assigneeIds: [currentUserId] })}
          className={clsx(
            chipBase,
            'border-neutral-200 bg-white text-neutral-600 hover:border-neutral-300'
          )}
        >
          Assignee: me
        </button>
      )}

      {chips.map((chip) => (
        <span
          key={chip.dimension}
          className={clsx(chipBase, 'border-primary-500 bg-primary-50 pr-1 text-primary-700')}
        >
          <span className="max-w-[14rem] truncate">{chip.label}</span>
          <button
            type="button"
            aria-label={`Remove filter ${chip.label}`}
            onClick={() => onFiltersChange(clearDimension(filters, chip.dimension))}
            className="rounded-full p-0.5 hover:bg-primary-100"
          >
            <X aria-hidden className="h-3 w-3" />
          </button>
        </span>
      ))}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={clsx(
              chipBase,
              'border-dashed border-neutral-300 bg-white text-neutral-600 hover:border-neutral-400'
            )}
          >
            <Plus aria-hidden className="h-3 w-3" />
            Filter
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" aria-label="Add a filter">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Priority</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {PRIORITY_VALUES.map((priority) => (
                <DropdownMenuCheckboxItem
                  key={priority}
                  checked={filters.priorities.includes(priority)}
                  onSelect={keepOpen}
                  onCheckedChange={() =>
                    set({ priorities: toggleValue(filters.priorities, priority) })
                  }
                >
                  <span className="flex items-center gap-2">
                    <span className="flex w-3.5 justify-center">
                      <PriorityIcon priority={priority} />
                    </span>
                    {PRIORITY_LABELS[priority]}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Label</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {labels.length === 0 && (
                <p className="px-2.5 py-2 text-sm text-neutral-400">No labels in this project</p>
              )}
              {labels.map((label) => (
                <DropdownMenuCheckboxItem
                  key={label.id}
                  checked={filters.labelIds.includes(label.id)}
                  onSelect={keepOpen}
                  onCheckedChange={() => set({ labelIds: toggleValue(filters.labelIds, label.id) })}
                >
                  <span className="flex items-center gap-2">
                    <ColorDot color={label.color} />
                    {label.name}
                  </span>
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Assignee</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="max-h-72 overflow-y-auto">
              {members.map((member) => (
                <DropdownMenuCheckboxItem
                  key={member.id}
                  checked={filters.assigneeIds.includes(member.id)}
                  onSelect={keepOpen}
                  onCheckedChange={() =>
                    set({ assigneeIds: toggleValue(filters.assigneeIds, member.id) })
                  }
                >
                  {member.id === currentUserId ? `${member.name} (me)` : member.name}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>Due date</DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {DUE_VALUES.map((due) => (
                <DropdownMenuCheckboxItem
                  key={due}
                  checked={filters.due.includes(due)}
                  onSelect={keepOpen}
                  onCheckedChange={() => set({ due: toggleValue(filters.due, due) })}
                >
                  {DUE_LABELS[due]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>

      {chips.length > 1 && (
        <button
          type="button"
          onClick={() => onFiltersChange(EMPTY_FILTERS)}
          className="text-[12.5px] text-neutral-500 hover:text-neutral-800"
        >
          Clear all
        </button>
      )}

      <div className="ml-auto flex items-center gap-2">
        {isRefreshing && <Spinner size="sm" label="Refreshing tasks" />}
        <LiveIndicator suffix={`${total} task${total === 1 ? '' : 's'}`} />
        <button
          type="button"
          onClick={onNewTask}
          aria-keyshortcuts="C"
          className="inline-flex items-center gap-1.5 rounded-lg bg-neutral-900 px-3 py-1.5 text-[12.5px] font-semibold text-white hover:bg-neutral-800"
        >
          <Plus aria-hidden className="h-3.5 w-3.5" />
          New
          <Kbd
            aria-hidden
            className="hidden !border-neutral-600 !bg-transparent !text-neutral-300 md:inline-flex"
          >
            C
          </Kbd>
        </button>
        {actions}
      </div>
    </div>
  );
}
