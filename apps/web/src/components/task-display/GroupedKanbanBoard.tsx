import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import { SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { KeyboardCode } from '@dnd-kit/core';
import { TaskCard, TaskCardOverlay, taskKeyOf, type TaskCardTask, type TaskOpenEvent } from './TaskCard';
import { GroupedKanbanColumn } from './GroupedKanbanColumn';
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
import { isDoneCategory, moveItem, neighboursAt } from '../board/ordering';
import type { ContextMenuState } from '../tasks/TaskContextMenu';
import type { MoveTaskInput } from '../../api/types';

interface GroupedKanbanBoardProps {
  tasks: TaskCardTask[];
  groupBy: GroupBy;
  secondaryGroupBy?: GroupBy;
  /** Keep this stable (useCallback): every card receives it. */
  onTaskClick: (taskId: string, event: TaskOpenEvent) => void;
  /** Called on drop with the target state and the neighbours the task lands between. */
  onTaskMove?: (move: MoveTaskInput) => void | Promise<void>;
  onInvalidDrop?: (message: string) => void;
  showProject?: boolean;
  allowDragDrop?: boolean;
  availableStates?: AvailableState[];
  mergeStatesByCategory?: boolean;
  selectedTaskIds?: Set<string>;
  /** Column header "+": quick-create pre-set to that state (project boards). */
  onAddTask?: (stateId: string) => void;
  /** Inline "+ Add task" at the column bottom (project boards). */
  onQuickAdd?: (stateId: string, title: string) => Promise<void>;
}

/** A droppable list of cards: a column, or a cell of the grouped (rows × columns) layout. */
interface BoardContainer {
  id: string;
  column: TaskGroup;
  row: TaskGroup | null;
  /** Category of the state dimension ('done' sorts by recency, no reordering). */
  category: string | undefined;
  taskIds: string[];
}

type Items = Record<string, string[]>;

const CELL_SEPARATOR = '::';

function findContainer(items: Items, id: string): string | undefined {
  if (id in items) return id;
  return Object.keys(items).find((key) => items[key]!.includes(id));
}

function sameOrder(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return !!a && a.length === b.length && a.every((id, i) => id === b[i]);
}

const screenReaderInstructions = {
  draggable:
    'To pick up a task, press Space. While dragging, use the arrow keys to move it within and across columns. Press Space again to drop it, or Escape to cancel.',
};

export function GroupedKanbanBoard({
  tasks,
  groupBy,
  secondaryGroupBy,
  onTaskClick,
  onTaskMove,
  onInvalidDrop,
  showProject = true,
  allowDragDrop = false,
  availableStates,
  mergeStatesByCategory,
  selectedTaskIds,
  onAddTask,
  onQuickAdd,
}: GroupedKanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dragItems, setDragItems] = useState<Items | null>(null);
  // Order shown between the drop and the optimistic cache update (no snap-back flicker).
  const [settlingItems, setSettlingItems] = useState<Items | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [limits, setLimits] = useState<Record<string, number>>({});

  const isStateGrouping = groupBy === 'state' || secondaryGroupBy === 'state';
  const dragEnabled = allowDragDrop && isStateGrouping && Boolean(onTaskMove);
  const showState = !isStateGrouping;
  const effectiveShowProject = showProject && groupBy !== 'project' && secondaryGroupBy !== 'project';
  const canCreateInColumn = groupBy === 'state' && !secondaryGroupBy && !mergeStatesByCategory;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter opens a card; only Space picks it up.
      keyboardCodes: {
        start: [KeyboardCode.Space],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space, KeyboardCode.Enter],
      },
    })
  );

  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const statesByProject = useMemo(() => {
    const map = new Map<string, ContextMenuState[]>();
    for (const state of availableStates ?? []) {
      if (!state.projectId) continue;
      map.set(state.projectId, [...(map.get(state.projectId) ?? []), state]);
    }
    return map;
  }, [availableStates]);

  const columns = useMemo(
    () => groupTasks(tasks, groupBy, availableStates, mergeStatesByCategory),
    [tasks, groupBy, availableStates, mergeStatesByCategory]
  );
  const rows = useMemo(
    () => (secondaryGroupBy ? groupTasks(tasks, secondaryGroupBy, undefined, mergeStatesByCategory) : null),
    [tasks, secondaryGroupBy, mergeStatesByCategory]
  );

  const containers = useMemo<BoardContainer[]>(() => {
    const build = (column: TaskGroup, row: TaskGroup | null, columnTasks: TaskCardTask[]): BoardContainer => {
      const category = groupBy === 'state' ? column.category : secondaryGroupBy === 'state' ? row?.category : undefined;
      return {
        id: row ? `${row.id}${CELL_SEPARATOR}${column.id}` : column.id,
        column,
        row,
        category,
        taskIds: sortTasksForColumn(columnTasks, category).map((t) => t.id),
      };
    };
    if (!rows || !secondaryGroupBy) return columns.map((column) => build(column, null, column.tasks));
    return rows.flatMap((row) =>
      columns.map((column) =>
        build(
          column,
          row,
          row.tasks.filter((t) => taskMatchesGroup(t, groupBy, column.id, mergeStatesByCategory))
        )
      )
    );
  }, [columns, rows, groupBy, secondaryGroupBy, mergeStatesByCategory]);

  const containerById = useMemo(() => new Map(containers.map((c) => [c.id, c])), [containers]);
  const baseItems = useMemo<Items>(() => Object.fromEntries(containers.map((c) => [c.id, c.taskIds])), [containers]);
  const items = dragItems ?? settlingItems ?? baseItems;
  const itemsRef = useRef(items);
  itemsRef.current = items;

  // The optimistic update (or a rollback) replaced the tasks: show them as they are.
  useEffect(() => setSettlingItems(null), [tasks]);
  useEffect(() => {
    if (!settlingItems) return;
    const timer = window.setTimeout(() => setSettlingItems(null), 2000);
    return () => window.clearTimeout(timer);
  }, [settlingItems]);

  const findStateForProject = useCallback(
    (projectId: string, category: string): string | null =>
      availableStates?.find((s) => s.projectId === projectId && s.category === category)?.id ?? null,
    [availableStates]
  );

  /** The state a task gets in a container, or why it can't go there. */
  const resolveTarget = useCallback(
    (container: BoardContainer, task: TaskCardTask): { stateId: string } | { error: string } => {
      const stateGroup = groupBy === 'state' ? container.column : container.row;
      const otherGroup = groupBy === 'state' ? container.row : container.column;
      const otherBy = groupBy === 'state' ? secondaryGroupBy : groupBy;
      if (!stateGroup || stateGroup.id === 'no-state') return { error: 'Tasks need a status' };
      if (otherGroup && otherBy && !taskMatchesGroup(task, otherBy, otherGroup.id, mergeStatesByCategory)) {
        return { error: otherBy === 'project' ? 'Cannot move task to a different project' : 'Dragging only changes the status' };
      }
      if (mergeStatesByCategory) {
        const category = stateGroup.category ?? stateGroup.id;
        const stateId = findStateForProject(task.project.id, category);
        return stateId ? { stateId } : { error: `No ${stateGroup.name} state found for project ${task.project.name}` };
      }
      const state = availableStates?.find((s) => s.id === stateGroup.id);
      if (state?.projectId && state.projectId !== task.project.id) return { error: 'Cannot move to a state from another project' };
      return { stateId: stateGroup.id };
    },
    [groupBy, secondaryGroupBy, mergeStatesByCategory, availableStates, findStateForProject]
  );

  const visibleLimit = useCallback(
    (container: BoardContainer) =>
      limits[container.id] ?? (isDoneCategory(container.category) ? DONE_COLUMN_INITIAL_LIMIT : COLUMN_RENDER_LIMIT),
    [limits]
  );

  const containerName = (container: BoardContainer) =>
    container.row ? `${container.column.name} (${container.row.name})` : container.column.name;

  // ---- Drag and drop -------------------------------------------------------

  const lastAnnouncement = useRef<string | null>(null);

  const handleDragStart = (event: DragStartEvent) => {
    if (!dragEnabled) return;
    setActiveId(String(event.active.id));
    setDragItems(itemsRef.current);
    setSettlingItems(null);
  };

  const handleDragOver = ({ active, over }: DragOverEvent) => {
    if (!over || !dragEnabled) return;
    const dragged = taskById.get(String(active.id));
    if (!dragged) return;
    const activeKey = String(active.id);
    const overKey = String(over.id);
    setDragItems((previous) => {
      if (!previous) return previous;
      const from = findContainer(previous, activeKey);
      const to = findContainer(previous, overKey);
      if (!from || !to || from === to) return previous;
      const target = containerById.get(to);
      if (!target || 'error' in resolveTarget(target, dragged)) return previous;
      const toItems = previous[to]!.filter((id) => id !== activeKey);
      let index: number;
      if (isDoneCategory(target.category)) {
        index = 0; // lands as the most recently completed
      } else if (overKey === to) {
        index = Math.min(toItems.length, visibleLimit(target));
      } else {
        const overIndex = toItems.indexOf(overKey);
        const translated = active.rect.current.translated;
        const isBelow = translated ? translated.top > over.rect.top + over.rect.height / 2 : false;
        index = overIndex < 0 ? toItems.length : overIndex + (isBelow ? 1 : 0);
      }
      toItems.splice(index, 0, activeKey);
      return { ...previous, [from]: previous[from]!.filter((id) => id !== activeKey), [to]: toItems };
    });
  };

  const handleDragCancel = () => {
    setActiveId(null);
    setDragItems(null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    const current = dragItems;
    setActiveId(null);
    setDragItems(null);
    lastAnnouncement.current = null;
    if (!dragEnabled || !onTaskMove || !over || !current) return;

    const taskId = String(active.id);
    const overKey = String(over.id);
    const dragged = taskById.get(taskId);
    const containerId = findContainer(current, taskId);
    const container = containerId ? containerById.get(containerId) : undefined;
    if (!dragged || !containerId || !container) return;

    const isDone = isDoneCategory(container.category);
    let list = current[containerId]!;
    if (!isDone && overKey !== taskId && overKey !== containerId && list.includes(overKey)) {
      list = moveItem(list, list.indexOf(taskId), list.indexOf(overKey));
    }
    const originalContainer = findContainer(baseItems, taskId);
    if (originalContainer === containerId && (isDone || sameOrder(baseItems[containerId], list))) return;

    const target = resolveTarget(container, dragged);
    if ('error' in target) {
      onInvalidDrop?.(target.error);
      return;
    }
    const neighbours = neighboursAt(list, taskId, (id) => {
      const other = taskById.get(id);
      return !!other && other.state?.id === target.stateId && other.project.id === dragged.project.id;
    });
    lastAnnouncement.current = `Moved ${taskKeyOf(dragged)} to ${containerName(container)}, position ${neighbours.index + 1} of ${neighbours.count}`;
    setSettlingItems({ ...current, [containerId]: list });
    void onTaskMove({
      taskId,
      stateId: target.stateId,
      afterTaskId: neighbours.afterTaskId,
      beforeTaskId: neighbours.beforeTaskId,
    });
  };

  const describePosition = (activeKey: UniqueIdentifier, overKey: UniqueIdentifier | undefined): string => {
    const task = taskById.get(String(activeKey));
    const label = task ? taskKeyOf(task) : 'Task';
    if (overKey === undefined) return `${label} is no longer over a column`;
    const snapshot = itemsRef.current;
    const containerId = findContainer(snapshot, String(overKey));
    const container = containerId ? containerById.get(containerId) : undefined;
    if (!containerId || !container) return `${label} is over an unknown area`;
    const list = snapshot[containerId]!;
    const index = list.indexOf(String(overKey));
    const position = index >= 0 ? index + 1 : list.length + 1;
    const count = list.includes(String(activeKey)) ? list.length : list.length + 1;
    return `${label} is over ${containerName(container)}, position ${Math.min(position, count)} of ${count}`;
  };

  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      const task = taskById.get(String(active.id));
      return `Picked up ${task ? taskKeyOf(task) : 'task'}${task?.state ? ` in ${task.state.name}` : ''}`;
    },
    onDragOver: ({ active, over }) => describePosition(active.id, over?.id),
    onDragEnd: ({ active }) => {
      const task = taskById.get(String(active.id));
      return lastAnnouncement.current ?? `${task ? taskKeyOf(task) : 'Task'} dropped, no change`;
    },
    onDragCancel: ({ active }) => {
      const task = taskById.get(String(active.id));
      return `Cancelled moving ${task ? taskKeyOf(task) : 'task'}`;
    },
  };

  // ---- Rendering -----------------------------------------------------------

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const renderContainer = (container: BoardContainer, compact: boolean) => {
    const ids = items[container.id] ?? [];
    const limit = visibleLimit(container);
    const visibleIds = ids.slice(0, limit);
    // Keep the dragged card rendered (as the placeholder) even past the cap.
    if (activeId && ids.includes(activeId) && !visibleIds.includes(activeId)) visibleIds.push(activeId);
    const hiddenCount = ids.length - visibleIds.length;
    const stateId = container.column.id;
    const isDone = isDoneCategory(container.category);
    const isCollapsed = !container.row && collapsed.has(container.id);

    return (
      <SortableContext key={container.id} id={container.id} items={visibleIds} strategy={verticalListSortingStrategy}>
        <GroupedKanbanColumn
          id={container.id}
          name={container.column.name}
          color={container.column.color}
          taskCount={ids.length}
          compact={compact}
          droppable={dragEnabled}
          collapsible={isDone && !container.row}
          collapsed={isCollapsed}
          onToggleCollapsed={() => toggleCollapsed(container.id)}
          onAddTask={canCreateInColumn && onAddTask ? () => onAddTask(stateId) : undefined}
          onQuickAdd={canCreateInColumn && onQuickAdd ? (title) => onQuickAdd(stateId, title) : undefined}
          emptyText={isDone ? 'Nothing done yet' : 'No tasks'}
        >
          {visibleIds.map((id) => {
            const task = taskById.get(id);
            if (!task) return null;
            return (
              <TaskCard
                key={id}
                task={task}
                onOpen={onTaskClick}
                showProject={effectiveShowProject}
                showState={showState}
                draggable={dragEnabled}
                isSelected={selectedTaskIds?.has(id) ?? false}
                states={statesByProject.get(task.project.id)}
              />
            );
          })}
          {hiddenCount > 0 && (
            <button
              type="button"
              onClick={() => setLimits((previous) => ({ ...previous, [container.id]: limit + COLUMN_RENDER_LIMIT }))}
              className="w-full rounded-lg px-2 py-1.5 text-left text-[12.5px] text-neutral-500 hover:bg-white hover:text-neutral-700"
            >
              Show {Math.min(hiddenCount, COLUMN_RENDER_LIMIT)} more
            </button>
          )}
        </GroupedKanbanColumn>
      </SortableContext>
    );
  };

  if (containers.length === 0) {
    return <div className="flex h-64 items-center justify-center text-neutral-500">No tasks found</div>;
  }

  const activeTask = activeId ? taskById.get(activeId) : undefined;

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
      accessibility={{ announcements, screenReaderInstructions }}
    >
      {rows ? (
        <div data-dragging={activeId ? 'true' : undefined} className="flex flex-col gap-6 overflow-x-auto pb-4">
          {rows.map((row) => (
            <section key={row.id} aria-label={`${row.name}, ${row.tasks.length} tasks`} className="flex flex-col gap-2">
              <h3 className="flex items-center gap-2 px-1 text-[13px] font-semibold text-neutral-900">
                {row.color && <span aria-hidden className="h-2 w-2 rounded-full" style={{ backgroundColor: row.color }} />}
                {row.name}
                <span className="font-medium text-neutral-400">{row.tasks.length}</span>
              </h3>
              <div className="flex gap-3">
                {containers.filter((c) => c.row?.id === row.id).map((container) => renderContainer(container, true))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div data-dragging={activeId ? 'true' : undefined} className="flex min-h-[60vh] items-stretch gap-3 overflow-x-auto pb-4">
          {containers.map((container) => renderContainer(container, false))}
        </div>
      )}

      <DragOverlay>
        {activeTask ? <TaskCardOverlay task={activeTask} showProject={effectiveShowProject} showState={showState} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
