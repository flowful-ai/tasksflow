import { useState, useCallback } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { TaskCard, type TaskCardTask } from './TaskCard';
import { GroupedKanbanColumn } from './GroupedKanbanColumn';
import { groupTasks, taskMatchesGroup, type GroupBy, type AvailableState, type TaskGroup } from './grouping';

interface GroupedKanbanBoardProps {
  tasks: TaskCardTask[];
  groupBy: GroupBy;
  secondaryGroupBy?: GroupBy;
  onTaskClick: (taskId: string) => void;
  onTaskMove?: (taskId: string, stateId: string, position: string) => Promise<void>;
  onInvalidDrop?: (message: string) => void;
  showProject?: boolean;
  allowDragDrop?: boolean;
  availableStates?: AvailableState[];
  mergeStatesByCategory?: boolean;
}

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
}: GroupedKanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Allow drag when state is primary OR secondary grouping
  const isStateGrouping = groupBy === 'state' || secondaryGroupBy === 'state';
  const dragEnabled = allowDragDrop && isStateGrouping;

  // Helper to find the actual state ID for a project within a category
  const findStateForProject = useCallback((projectId: string, category: string): string | null => {
    if (!availableStates) return null;
    const state = availableStates.find(
      s => s.projectId === projectId && s.category === category
    );
    return state?.id || null;
  }, [availableStates]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const groups = groupTasks(tasks, groupBy, availableStates, mergeStatesByCategory);
  const rowGroups = secondaryGroupBy
    ? groupTasks(tasks, secondaryGroupBy, undefined, mergeStatesByCategory)
    : null;
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  // Determine which task fields to show based on groupBy
  const showState = groupBy !== 'state' && secondaryGroupBy !== 'state';
  const effectiveShowProject = showProject && groupBy !== 'project' && secondaryGroupBy !== 'project';

  const handleDragStart = (event: DragStartEvent) => {
    if (!dragEnabled) return;
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!dragEnabled || !onTaskMove) {
      setActiveId(null);
      return;
    }

    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const taskId = active.id as string;
    const overId = over.id as string;

    const draggedTask = tasks.find(t => t.id === taskId);
    if (!draggedTask) return;

    let targetStateId: string | null = null;
    let targetTasks: TaskCardTask[] = [];

    // Case 1: State is PRIMARY grouping (state columns)
    if (groupBy === 'state') {
      // Check if dropped on a column
      const targetGroup = groups.find((g) => g.id === overId);
      if (targetGroup) {
        if (mergeStatesByCategory && targetGroup.category) {
          // Merged by category: resolve to actual state for task's project
          targetStateId = findStateForProject(draggedTask.project.id, targetGroup.category);
          if (!targetStateId) {
            onInvalidDrop?.(`No ${targetGroup.name} state found for project ${draggedTask.project.name}`);
            return;
          }
        } else {
          // Direct state grouping: validate same project
          const targetState = availableStates?.find(s => s.id === targetGroup.id);
          if (targetState && targetState.projectId !== draggedTask.project.id) {
            onInvalidDrop?.('Cannot move to a state from another project');
            return;
          }
          targetStateId = targetGroup.id;
        }
        targetTasks = targetGroup.tasks;
      } else {
        // Check if dropped on a task
        const targetTask = tasks.find((t) => t.id === overId);
        if (targetTask) {
          const taskGroup = groups.find((g) => g.tasks.some((t) => t.id === overId));
          if (taskGroup) {
            if (mergeStatesByCategory && taskGroup.category) {
              targetStateId = findStateForProject(draggedTask.project.id, taskGroup.category);
              if (!targetStateId) {
                onInvalidDrop?.(`No ${taskGroup.name} state found for project ${draggedTask.project.name}`);
                return;
              }
            } else {
              const targetState = availableStates?.find(s => s.id === taskGroup.id);
              if (targetState && targetState.projectId !== draggedTask.project.id) {
                onInvalidDrop?.('Cannot move to a state from another project');
                return;
              }
              targetStateId = taskGroup.id;
            }
            targetTasks = taskGroup.tasks;
          }
        }
      }
    }

    // Case 2: State is SECONDARY grouping (state rows)
    else if (secondaryGroupBy === 'state') {
      // Parse compound ID: "stateCategory:primaryGroupId"
      const [stateCategory, primaryGroupId] = overId.includes(':')
        ? overId.split(':')
        : [null, overId];

      if (stateCategory) {
        // Find the row (state category) and validate
        const targetRowGroup = rowGroups?.find(g => g.id === stateCategory);
        if (!targetRowGroup) return;

        // When primary is 'project', the primaryGroupId IS the projectId
        if (groupBy === 'project') {
          if (primaryGroupId !== draggedTask.project.id) {
            onInvalidDrop?.('Cannot move task to a different project');
            return;
          }
        }

        // Resolve actual state ID for this category in the task's project
        targetStateId = findStateForProject(draggedTask.project.id, stateCategory);
        if (!targetStateId) {
          onInvalidDrop?.(`No ${targetRowGroup.name} state found for project ${draggedTask.project.name}`);
          return;
        }

        // Find target tasks for position calculation
        const rowTasks = tasks.filter(t => taskMatchesGroup(t, secondaryGroupBy, stateCategory, mergeStatesByCategory));
        targetTasks = rowTasks.filter(t => taskMatchesGroup(t, groupBy, primaryGroupId, mergeStatesByCategory));
      } else {
        // Dropped on a task without compound ID - find its group
        const targetTask = tasks.find((t) => t.id === overId);
        const targetCategory = targetTask?.state?.category;
        if (targetTask && targetCategory) {
          // Validate same project
          if (targetTask.project.id !== draggedTask.project.id) {
            onInvalidDrop?.('Cannot move task to a different project');
            return;
          }

          targetStateId = findStateForProject(draggedTask.project.id, targetCategory);
          if (!targetStateId) {
            onInvalidDrop?.(`No ${targetTask.state?.name || targetCategory} state found for project ${draggedTask.project.name}`);
            return;
          }

          // Find target tasks for position calculation
          // secondaryGroupBy is guaranteed to be 'state' here (checked in parent if)
          const rowTasks = tasks.filter(t => taskMatchesGroup(t, secondaryGroupBy!, targetCategory, mergeStatesByCategory));
          targetTasks = rowTasks.filter(t => taskMatchesGroup(t, groupBy, getGroupId(targetTask, groupBy), mergeStatesByCategory));
        }
      }
    }

    if (!targetStateId) return;

    // Calculate position
    const targetIndex = targetTasks.findIndex((t) => t.id === overId);
    let position: string;

    if (targetIndex >= 0) {
      // Dropped on a task - insert before it
      const beforeTask = targetTasks[targetIndex - 1];
      const afterTask = targetTasks[targetIndex];
      position = beforeTask
        ? generatePositionBetween(beforeTask.position || 'a0', afterTask?.position || 'z')
        : generatePositionBefore(afterTask?.position || 'a0');
    } else {
      // Dropped on column - place at end
      const lastTask = targetTasks[targetTasks.length - 1];
      position = lastTask ? generatePositionAfter(lastTask.position || 'a0') : 'a0';
    }

    await onTaskMove(taskId, targetStateId, position);
  };

  // Helper to get the primary group ID for a task
  function getGroupId(task: TaskCardTask, group: GroupBy): string {
    switch (group) {
      case 'project':
        return task.project.id;
      case 'state':
        return task.state?.id || 'no-state';
      case 'priority':
        return task.priority || 'none';
      case 'assignee':
        return task.assignees[0]?.id || 'unassigned';
      case 'label':
        return task.labels[0]?.id || 'no-label';
      default:
        return 'all';
    }
  }

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No tasks found
      </div>
    );
  }

  const buildRowColumns = (rowTasks: TaskCardTask[]): TaskGroup[] => {
    const rowGroups = groupTasks(rowTasks, groupBy, availableStates, mergeStatesByCategory);
    return groups.map((column) => {
      const match = rowGroups.find((g) => g.id === column.id);
      return (
        match ?? {
          id: column.id,
          name: column.name,
          color: column.color,
          category: column.category,
          tasks: [],
        }
      );
    });
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      {rowGroups ? (
        <div className="flex h-full flex-col gap-4 overflow-x-auto pb-4">
          {rowGroups.map((rowGroup) => {
            const rowTasks = tasks.filter((task) =>
              taskMatchesGroup(task, secondaryGroupBy!, rowGroup.id, mergeStatesByCategory)
            );
            const rowColumns = buildRowColumns(rowTasks);
            return (
              <div key={rowGroup.id} className="flex gap-4">
                <div className="flex-shrink-0 w-48">
                  <div className="flex items-center gap-2 px-2 py-1.5">
                    {rowGroup.color && (
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: rowGroup.color }}
                      />
                    )}
                    <span className="font-medium text-gray-900">{rowGroup.name}</span>
                    <span className="text-sm text-gray-500">({rowGroup.tasks.length})</span>
                  </div>
                </div>
                {rowColumns.map((group) => {
                  // Use compound ID when state is secondary grouping: "stateCategory:primaryGroupId"
                  const columnId = secondaryGroupBy === 'state'
                    ? `${rowGroup.id}:${group.id}`
                    : group.id;
                  return (
                    <SortableContext
                      key={`${rowGroup.id}-${group.id}`}
                      items={group.tasks.map((t) => t.id)}
                      strategy={verticalListSortingStrategy}
                    >
                      <GroupedKanbanColumn
                        id={columnId}
                        name={group.name}
                        color={group.color}
                        taskCount={group.tasks.length}
                      >
                        {group.tasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            onClick={() => onTaskClick(task.id)}
                            showProject={effectiveShowProject}
                            showState={showState}
                            draggable={dragEnabled}
                          />
                        ))}
                      </GroupedKanbanColumn>
                    </SortableContext>
                  );
                })}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex h-full gap-4 overflow-x-auto pb-4">
          {groups.map((group) => (
            <SortableContext
              key={group.id}
              items={group.tasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <GroupedKanbanColumn
                id={group.id}
                name={group.name}
                color={group.color}
                taskCount={group.tasks.length}
              >
                {group.tasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    onClick={() => onTaskClick(task.id)}
                    showProject={effectiveShowProject}
                    showState={showState}
                    draggable={dragEnabled}
                  />
                ))}
              </GroupedKanbanColumn>
            </SortableContext>
          ))}
        </div>
      )}

      <DragOverlay>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            onClick={() => {}}
            showProject={effectiveShowProject}
            showState={showState}
            isDragging
            draggable={false}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

// Simple position generation functions
function generatePositionAfter(pos: string): string {
  const chars = pos.split('');
  let i = chars.length - 1;

  while (i >= 0) {
    const code = chars[i]!.charCodeAt(0);
    if (code < 122) {
      chars[i] = String.fromCharCode(code + 1);
      return chars.join('');
    }
    chars[i] = '0';
    i--;
  }

  return '0' + chars.join('');
}

function generatePositionBefore(pos: string): string {
  const chars = pos.split('');
  let i = chars.length - 1;

  while (i >= 0) {
    const code = chars[i]!.charCodeAt(0);
    if (code > 48) {
      chars[i] = String.fromCharCode(code - 1);
      return chars.join('');
    }
    chars[i] = 'z';
    i--;
  }

  return '0';
}

function generatePositionBetween(before: string, after: string): string {
  const maxLen = Math.max(before.length, after.length);
  const a = before.padEnd(maxLen, '0');
  const b = after.padEnd(maxLen, '0');

  const result: string[] = [];
  let carry = 0;

  for (let i = maxLen - 1; i >= 0; i--) {
    const aCode = a.charCodeAt(i);
    const bCode = b.charCodeAt(i);
    const sum = aCode + bCode + carry;
    const mid = Math.floor(sum / 2);
    carry = sum % 2;
    result.unshift(String.fromCharCode(mid));
  }

  let pos = result.join('');

  if (pos <= before) {
    pos = before + 'M';
  }

  return pos;
}
