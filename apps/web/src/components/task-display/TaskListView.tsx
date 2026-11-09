import { memo, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { TaskCard, type TaskCardTask, type TaskOpenEvent } from './TaskCard';
import {
  COLUMN_RENDER_LIMIT,
  DONE_COLUMN_INITIAL_LIMIT,
  groupTasks,
  sortTasksForColumn,
  taskMatchesGroup,
  type AvailableState,
  type GroupBy,
  type TaskGroup,
} from './grouping';
import { isDoneCategory } from '../board/ordering';
import { ColorDot } from '../ui/ColorDot';
import { IconButton } from '../ui/IconButton';
import type { ContextMenuState } from '../tasks/TaskContextMenu';

interface TaskListViewProps {
  tasks: TaskCardTask[];
  groupBy: GroupBy;
  secondaryGroupBy?: GroupBy;
  /** Keep this stable (useCallback): every row receives it. */
  onTaskClick: (taskId: string, event: TaskOpenEvent) => void;
  showProject?: boolean;
  availableStates?: AvailableState[];
  mergeStatesByCategory?: boolean;
  selectedTaskIds?: Set<string>;
  /** Group header "+" (project lists grouped by state). */
  onAddTask?: (stateId: string) => void;
}

export function TaskListView({
  tasks,
  groupBy,
  secondaryGroupBy,
  onTaskClick,
  showProject = true,
  availableStates,
  mergeStatesByCategory,
  selectedTaskIds,
  onAddTask,
}: TaskListViewProps) {
  const statesByProject = useMemo(() => {
    const map = new Map<string, ContextMenuState[]>();
    for (const state of availableStates ?? []) {
      if (!state.projectId) continue;
      map.set(state.projectId, [...(map.get(state.projectId) ?? []), state]);
    }
    return map;
  }, [availableStates]);

  const sections = useMemo(() => {
    const sortGroups = (groups: TaskGroup[]) =>
      groups.map((group) => ({ ...group, tasks: sortTasksForColumn(group.tasks, group.category) }));
    if (!secondaryGroupBy)
      return [
        {
          outer: null,
          groups: sortGroups(groupTasks(tasks, groupBy, availableStates, mergeStatesByCategory)),
        },
      ];
    return groupTasks(tasks, secondaryGroupBy, undefined, mergeStatesByCategory).map((outer) => ({
      outer,
      groups: sortGroups(
        groupTasks(
          tasks.filter((task) =>
            taskMatchesGroup(task, secondaryGroupBy, outer.id, mergeStatesByCategory)
          ),
          groupBy,
          availableStates,
          mergeStatesByCategory
        )
      ),
    }));
  }, [tasks, groupBy, secondaryGroupBy, availableStates, mergeStatesByCategory]);

  const isStateGrouping = groupBy === 'state' || secondaryGroupBy === 'state';
  const effectiveShowProject =
    showProject && groupBy !== 'project' && secondaryGroupBy !== 'project';
  const canAdd =
    groupBy === 'state' && !secondaryGroupBy && !mergeStatesByCategory ? onAddTask : undefined;

  if (tasks.length === 0 && groupBy === 'none') {
    return <p className="py-8 text-center text-neutral-500">No tasks found</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {sections.map(({ outer, groups }) => {
        const content = groups.map((group) => (
          <ListGroup
            key={group.id}
            group={group}
            onTaskClick={onTaskClick}
            showProject={effectiveShowProject}
            showState={!isStateGrouping}
            selectedTaskIds={selectedTaskIds}
            statesByProject={statesByProject}
            onAddTask={canAdd}
          />
        ));
        if (!outer)
          return (
            <div key="all" className="flex flex-col gap-3">
              {content}
            </div>
          );
        return (
          <section key={outer.id} aria-label={outer.name} className="flex flex-col gap-2">
            <h3 className="flex items-center gap-2 px-1 text-[13px] font-semibold text-neutral-900">
              <ColorDot color={outer.color} />
              {outer.name}
              <span className="font-medium text-neutral-400">{outer.tasks.length}</span>
            </h3>
            {content}
          </section>
        );
      })}
    </div>
  );
}

interface ListGroupProps {
  group: TaskGroup;
  onTaskClick: (taskId: string, event: TaskOpenEvent) => void;
  showProject: boolean;
  showState: boolean;
  selectedTaskIds?: Set<string>;
  statesByProject: Map<string, ContextMenuState[]>;
  onAddTask?: (stateId: string) => void;
}

const ListGroup = memo(function ListGroup({
  group,
  onTaskClick,
  showProject,
  showState,
  selectedTaskIds,
  statesByProject,
  onAddTask,
}: ListGroupProps) {
  const isDone = isDoneCategory(group.category);
  const [isExpanded, setIsExpanded] = useState(!isDone || group.tasks.length <= 5);
  const [limit, setLimit] = useState(isDone ? DONE_COLUMN_INITIAL_LIMIT : COLUMN_RENDER_LIMIT);
  const visible = group.tasks.slice(0, limit);
  const hidden = group.tasks.length - visible.length;
  const panelId = `list-group-${group.id}`;

  return (
    <section data-column={group.id} aria-label={`${group.name}, ${group.tasks.length} tasks`}>
      <div className="flex items-center gap-1 px-1 py-1">
        <button
          type="button"
          onClick={() => setIsExpanded((value) => !value)}
          aria-expanded={isExpanded}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-center gap-[7px] rounded-md py-0.5 text-left text-[13px] font-semibold text-neutral-900"
        >
          {isExpanded ? (
            <ChevronDown aria-hidden className="h-4 w-4 text-neutral-400" />
          ) : (
            <ChevronRight aria-hidden className="h-4 w-4 text-neutral-400" />
          )}
          <ColorDot color={group.color} />
          <span className="truncate">{group.name}</span>
          <span className="font-medium text-neutral-400">{group.tasks.length}</span>
        </button>
        {onAddTask && (
          <IconButton
            label={`Add task to ${group.name}`}
            icon={<Plus />}
            size="xs"
            onClick={() => onAddTask(group.id)}
          />
        )}
      </div>
      {isExpanded && (
        <div id={panelId} className="overflow-hidden rounded-xl border border-neutral-200 bg-white">
          {group.tasks.length === 0 ? (
            <p className="px-3 py-3 text-sm text-neutral-400">No tasks</p>
          ) : (
            <>
              {visible.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  variant="row"
                  onOpen={onTaskClick}
                  showProject={showProject}
                  showState={showState}
                  isSelected={selectedTaskIds?.has(task.id) ?? false}
                  states={statesByProject.get(task.project.id)}
                />
              ))}
              {hidden > 0 && (
                <button
                  type="button"
                  onClick={() => setLimit((value) => value + COLUMN_RENDER_LIMIT)}
                  className="w-full border-t border-neutral-100 px-3 py-2 text-left text-[12.5px] text-neutral-500 hover:bg-neutral-50"
                >
                  Show {Math.min(hidden, COLUMN_RENDER_LIMIT)} more
                </button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
});
