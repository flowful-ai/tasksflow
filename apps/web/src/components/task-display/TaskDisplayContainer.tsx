import type { TaskCardTask, TaskOpenEvent } from './TaskCard';
import type { MoveTaskInput } from '../../api/types';
import type { GroupBy, AvailableState } from './grouping';
import { TaskListView } from './TaskListView';
import { GroupedKanbanBoard } from './GroupedKanbanBoard';

export type DisplayType = 'kanban' | 'list' | 'table' | 'calendar';

interface TaskDisplayContainerProps {
  tasks: TaskCardTask[];
  displayType: DisplayType;
  groupBy: GroupBy;
  secondaryGroupBy?: GroupBy | null;
  onTaskClick: (taskId: string, event: TaskOpenEvent) => void;
  onTaskMove?: (move: MoveTaskInput) => void | Promise<void>;
  onInvalidDrop?: (message: string) => void;
  showProject?: boolean;
  allowDragDrop?: boolean;
  availableStates?: AvailableState[];
  mergeStatesByCategory?: boolean;
  selectedTaskIds?: Set<string>;
  onAddTask?: (stateId: string) => void;
  onQuickAdd?: (stateId: string, title: string) => Promise<void>;
}

/** Board for 'kanban'; the grouped list for every other display type (table and calendar are not built yet). */
export function TaskDisplayContainer({
  displayType,
  secondaryGroupBy,
  onTaskMove,
  onInvalidDrop,
  allowDragDrop = false,
  onQuickAdd,
  showProject = true,
  ...shared
}: TaskDisplayContainerProps) {
  if (displayType === 'kanban') {
    return (
      <GroupedKanbanBoard
        {...shared}
        showProject={showProject}
        secondaryGroupBy={secondaryGroupBy ?? undefined}
        onTaskMove={onTaskMove}
        onInvalidDrop={onInvalidDrop}
        allowDragDrop={allowDragDrop}
        onQuickAdd={onQuickAdd}
      />
    );
  }
  return (
    <TaskListView
      {...shared}
      showProject={showProject}
      secondaryGroupBy={secondaryGroupBy ?? undefined}
    />
  );
}
