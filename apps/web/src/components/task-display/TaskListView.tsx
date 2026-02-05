import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { TaskCard, type TaskCardTask } from './TaskCard';
import { groupTasks, type GroupBy, type TaskGroup, type AvailableState } from './grouping';

interface TaskListViewProps {
  tasks: TaskCardTask[];
  groupBy: GroupBy;
  onTaskClick: (taskId: string) => void;
  showProject?: boolean;
  availableStates?: AvailableState[];
}

export function TaskListView({
  tasks,
  groupBy,
  onTaskClick,
  showProject = true,
  availableStates,
}: TaskListViewProps) {
  const groups = groupTasks(tasks, groupBy, availableStates);

  if (groupBy === 'none') {
    // Simple flat list without grouping
    return (
      <div className="space-y-2">
        {tasks.length === 0 ? (
          <p className="text-center py-8 text-gray-500">No tasks found</p>
        ) : (
          tasks.map((task) => (
            <TaskCard
              key={task.id}
              task={task}
              onClick={() => onTaskClick(task.id)}
              showProject={showProject}
              showState={true}
              draggable={false}
            />
          ))
        )}
      </div>
    );
  }

  // Grouped list with collapsible sections
  return (
    <div className="space-y-4">
      {groups.length === 0 ? (
        <p className="text-center py-8 text-gray-500">No tasks found</p>
      ) : (
        groups.map((group) => (
          <TaskGroupSection
            key={group.id}
            group={group}
            groupBy={groupBy}
            onTaskClick={onTaskClick}
            showProject={showProject}
          />
        ))
      )}
    </div>
  );
}

interface TaskGroupSectionProps {
  group: TaskGroup;
  groupBy: GroupBy;
  onTaskClick: (taskId: string) => void;
  showProject: boolean;
}

function TaskGroupSection({
  group,
  groupBy,
  onTaskClick,
  showProject,
}: TaskGroupSectionProps) {
  const [isExpanded, setIsExpanded] = useState(true);

  // Determine which task fields to show based on groupBy
  // Don't show the grouped field since it's redundant
  const showState = groupBy !== 'state';

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Section header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center justify-between px-4 py-3 bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <div className="flex items-center gap-3">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronRight className="w-4 h-4 text-gray-500" />
          )}
          {group.color && (
            <div
              className="w-3 h-3 rounded-full"
              style={{ backgroundColor: group.color }}
            />
          )}
          <span className="font-medium text-gray-900">{group.name}</span>
          <span className="text-sm text-gray-500">({group.tasks.length})</span>
        </div>
      </button>

      {/* Section content */}
      {isExpanded && (
        <div className="p-3 space-y-2">
          {group.tasks.length === 0 ? (
            <p className="text-center py-4 text-gray-400 text-sm">No tasks</p>
          ) : (
            group.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onClick={() => onTaskClick(task.id)}
                showProject={showProject}
                showState={showState}
                draggable={false}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
