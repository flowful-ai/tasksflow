import type { TaskCardTask } from './TaskCard';
import type { GroupBy, AvailableState } from './grouping';
import { TaskListView } from './TaskListView';
import { GroupedKanbanBoard } from './GroupedKanbanBoard';

export type DisplayType = 'kanban' | 'list' | 'table' | 'calendar';

interface TaskDisplayContainerProps {
  tasks: TaskCardTask[];
  displayType: DisplayType;
  groupBy: GroupBy;
  secondaryGroupBy?: GroupBy | null;
  onTaskClick: (taskId: string) => void;
  onTaskMove?: (taskId: string, groupId: string, position: string) => Promise<void>;
  showProject?: boolean;
  allowDragDrop?: boolean;
  availableStates?: AvailableState[];
  mergeStatesByCategory?: boolean;
}

export function TaskDisplayContainer({
  tasks,
  displayType,
  groupBy,
  secondaryGroupBy,
  onTaskClick,
  onTaskMove,
  showProject = true,
  allowDragDrop = false,
  availableStates,
  mergeStatesByCategory,
}: TaskDisplayContainerProps) {
  switch (displayType) {
    case 'kanban':
      return (
        <GroupedKanbanBoard
          tasks={tasks}
          groupBy={groupBy}
          secondaryGroupBy={secondaryGroupBy ?? undefined}
          onTaskClick={onTaskClick}
          onTaskMove={onTaskMove}
          showProject={showProject}
          allowDragDrop={allowDragDrop}
          availableStates={availableStates}
          mergeStatesByCategory={mergeStatesByCategory}
        />
      );

    case 'list':
      return (
        <TaskListView
          tasks={tasks}
          groupBy={groupBy}
          secondaryGroupBy={secondaryGroupBy ?? undefined}
          onTaskClick={onTaskClick}
          showProject={showProject}
          availableStates={availableStates}
          mergeStatesByCategory={mergeStatesByCategory}
        />
      );

    case 'table':
      // Future: implement table view
      return (
        <div className="text-center py-12 text-gray-500">
          <p>Table view coming soon</p>
          <p className="text-sm mt-2">Showing list view instead</p>
          <div className="mt-6">
            <TaskListView
              tasks={tasks}
              groupBy={groupBy}
              secondaryGroupBy={secondaryGroupBy ?? undefined}
              onTaskClick={onTaskClick}
              showProject={showProject}
              availableStates={availableStates}
              mergeStatesByCategory={mergeStatesByCategory}
            />
          </div>
        </div>
      );

    case 'calendar':
      // Future: implement calendar view
      return (
        <div className="text-center py-12 text-gray-500">
          <p>Calendar view coming soon</p>
          <p className="text-sm mt-2">Showing list view instead</p>
          <div className="mt-6">
            <TaskListView
              tasks={tasks}
              groupBy={groupBy}
              secondaryGroupBy={secondaryGroupBy ?? undefined}
              onTaskClick={onTaskClick}
              showProject={showProject}
              availableStates={availableStates}
              mergeStatesByCategory={mergeStatesByCategory}
            />
          </div>
        </div>
      );

    default:
      return (
        <TaskListView
          tasks={tasks}
          groupBy={groupBy}
          secondaryGroupBy={secondaryGroupBy ?? undefined}
          onTaskClick={onTaskClick}
          showProject={showProject}
          availableStates={availableStates}
          mergeStatesByCategory={mergeStatesByCategory}
        />
      );
  }
}
