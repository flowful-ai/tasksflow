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
import { KanbanColumn } from './KanbanColumn';
import { KanbanCard } from './KanbanCard';

interface TaskState {
  id: string;
  name: string;
  category: string;
  color: string | null;
}

interface Task {
  id: string;
  stateId: string | null;
  title: string;
  priority: string | null;
  position: string;
}

interface KanbanBoardProps {
  states: TaskState[];
  tasks: Task[];
  onTaskClick: (taskId: string) => void;
  onTaskMove: (taskId: string, stateId: string, position: string) => Promise<void>;
}

export function KanbanBoard({ states, tasks, onTaskClick, onTaskMove }: KanbanBoardProps) {
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

  const activeTask = activeId ? tasks.find((t) => t.id === activeId) : null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const taskId = active.id as string;
    const overId = over.id as string;

    // Check if dropped on a column
    const targetState = states.find((s) => s.id === overId);
    if (targetState) {
      // Get tasks in target column
      const columnTasks = tasks
        .filter((t) => t.stateId === targetState.id)
        .sort((a, b) => a.position.localeCompare(b.position));

      // Generate position at the end
      const lastTask = columnTasks[columnTasks.length - 1];
      const position = lastTask
        ? generatePositionAfter(lastTask.position)
        : 'a0';

      await onTaskMove(taskId, targetState.id, position);
      return;
    }

    // Check if dropped on another task
    const targetTask = tasks.find((t) => t.id === overId);
    if (targetTask && targetTask.stateId) {
      const columnTasks = tasks
        .filter((t) => t.stateId === targetTask.stateId)
        .sort((a, b) => a.position.localeCompare(b.position));

      const targetIndex = columnTasks.findIndex((t) => t.id === overId);
      const beforeTask = columnTasks[targetIndex - 1];
      const afterTask = targetTask;

      const position = beforeTask
        ? generatePositionBetween(beforeTask.position, afterTask.position)
        : generatePositionBefore(afterTask.position);

      await onTaskMove(taskId, targetTask.stateId, position);
    }
  };

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex h-full gap-4 overflow-x-auto pb-4">
        {states.map((state) => {
          const columnTasks = tasks
            .filter((t) => t.stateId === state.id)
            .sort((a, b) => a.position.localeCompare(b.position));

          return (
            <SortableContext
              key={state.id}
              items={columnTasks.map((t) => t.id)}
              strategy={verticalListSortingStrategy}
            >
              <KanbanColumn
                state={state}
                taskCount={columnTasks.length}
              >
                {columnTasks.map((task) => (
                  <KanbanCard
                    key={task.id}
                    task={task}
                    onClick={() => onTaskClick(task.id)}
                  />
                ))}
              </KanbanColumn>
            </SortableContext>
          );
        })}
      </div>

      <DragOverlay>
        {activeTask ? (
          <KanbanCard
            task={activeTask}
            onClick={() => {}}
            isDragging
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
    if (code < 122) { // 'z'
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
    if (code > 48) { // '0'
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
