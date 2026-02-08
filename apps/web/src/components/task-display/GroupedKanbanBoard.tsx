import { useState } from 'react';
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
import { groupTasks, type GroupBy, type AvailableState } from './grouping';

interface GroupedKanbanBoardProps {
  tasks: TaskCardTask[];
  groupBy: GroupBy;
  onTaskClick: (taskId: string) => void;
  onTaskMove?: (taskId: string, groupId: string, position: string) => Promise<void>;
  showProject?: boolean;
  allowDragDrop?: boolean;
  availableStates?: AvailableState[];
  mergeStatesByCategory?: boolean;
}

export function GroupedKanbanBoard({
  tasks,
  groupBy,
  onTaskClick,
  onTaskMove,
  showProject = true,
  allowDragDrop = false,
  availableStates,
  mergeStatesByCategory,
}: GroupedKanbanBoardProps) {
  const [activeId, setActiveId] = useState<string | null>(null);

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
  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  // Determine which task fields to show based on groupBy
  const showState = groupBy !== 'state';

  const handleDragStart = (event: DragStartEvent) => {
    if (!allowDragDrop) return;
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    if (!allowDragDrop || !onTaskMove) {
      setActiveId(null);
      return;
    }

    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const taskId = active.id as string;
    const overId = over.id as string;

    // Find the target group
    const targetGroup = groups.find((g) => g.id === overId);
    if (targetGroup) {
      // Dropped on a column - place at the end
      const columnTasks = targetGroup.tasks;
      const lastTask = columnTasks[columnTasks.length - 1];
      const position = lastTask ? generatePositionAfter(lastTask.id) : 'a0';

      await onTaskMove(taskId, targetGroup.id, position);
      return;
    }

    // Find if dropped on another task
    const targetTask = tasks.find((t) => t.id === overId);
    if (targetTask) {
      const taskGroup = groups.find((g) => g.tasks.some((t) => t.id === overId));
      if (taskGroup) {
        const columnTasks = taskGroup.tasks;
        const targetIndex = columnTasks.findIndex((t) => t.id === overId);
        const beforeTask = columnTasks[targetIndex - 1];
        const afterTask = targetTask;

        const position = beforeTask
          ? generatePositionBetween(beforeTask.id, afterTask.id)
          : generatePositionBefore(afterTask.id);

        await onTaskMove(taskId, taskGroup.id, position);
      }
    }
  };

  if (groups.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        No tasks found
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
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
                  showProject={showProject}
                  showState={showState}
                  draggable={allowDragDrop}
                />
              ))}
            </GroupedKanbanColumn>
          </SortableContext>
        ))}
      </div>

      <DragOverlay>
        {activeTask ? (
          <TaskCard
            task={activeTask}
            onClick={() => {}}
            showProject={showProject}
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
