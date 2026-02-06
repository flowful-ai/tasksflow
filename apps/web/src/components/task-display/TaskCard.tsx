import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import clsx from 'clsx';
import { Calendar } from 'lucide-react';

interface TaskCardTask {
  id: string;
  title: string;
  priority: string | null;
  dueDate: string | null;
  state: {
    id: string;
    name: string;
    color: string | null;
    category?: string;
  } | null;
  assignees: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl?: string | null;
  }[];
  labels: {
    id: string;
    name: string;
    color: string | null;
  }[];
  project: {
    id: string;
    identifier: string;
    name: string;
  };
  agent?: {
    id: string;
    name: string;
  } | null;
  sequenceNumber: number;
}

interface TaskCardProps {
  task: TaskCardTask;
  onClick: () => void;
  showProject?: boolean;
  showState?: boolean;
  isDragging?: boolean;
  draggable?: boolean;
}

const priorityColors: Record<string, string> = {
  urgent: 'border-l-red-500',
  high: 'border-l-orange-500',
  medium: 'border-l-yellow-500',
  low: 'border-l-green-500',
};

export function TaskCard({
  task,
  onClick,
  showProject = false,
  showState = false,
  isDragging = false,
  draggable = true,
}: TaskCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: task.id, disabled: !draggable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isOverdue = task.dueDate && new Date(task.dueDate) < new Date();

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...(draggable ? { ...attributes, ...listeners } : {})}
      onClick={onClick}
      className={clsx(
        'p-3 bg-white rounded-lg border border-gray-200 cursor-pointer',
        'hover:border-primary-300 hover:shadow-sm transition-all',
        task.priority && `border-l-4 ${priorityColors[task.priority]}`,
        isDragging && 'opacity-50 shadow-lg'
      )}
    >
      {/* Title row with optional project identifier */}
      <div className="flex items-start gap-2">
        {showProject && (
          <span className="flex-shrink-0 text-xs font-medium text-gray-400">
            {task.project.identifier}-{task.sequenceNumber}
          </span>
        )}
        <p className="flex-1 text-sm text-gray-900 font-medium line-clamp-2">{task.title}</p>
      </div>

      {/* Metadata row */}
      <div className="mt-2 flex items-center flex-wrap gap-2">
        {/* State badge */}
        {showState && task.state && (
          <span
            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
            style={{
              backgroundColor: task.state.color ? `${task.state.color}20` : '#f3f4f6',
              color: task.state.color || '#6b7280',
            }}
          >
            {task.state.name}
          </span>
        )}

        {/* Agent badge */}
        {task.agent && (
          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
            {task.agent.name}
          </span>
        )}

        {/* Labels */}
        {task.labels.slice(0, 2).map((label) => (
          <span
            key={label.id}
            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
            style={{
              backgroundColor: label.color ? `${label.color}20` : '#f3f4f6',
              color: label.color || '#6b7280',
            }}
          >
            {label.name}
          </span>
        ))}
        {task.labels.length > 2 && (
          <span className="text-xs text-gray-400">+{task.labels.length - 2}</span>
        )}

        {/* Due date */}
        {task.dueDate && (
          <span
            className={clsx(
              'inline-flex items-center gap-1 text-xs',
              isOverdue ? 'text-red-600' : 'text-gray-500'
            )}
          >
            <Calendar className="w-3 h-3" />
            {new Date(task.dueDate).toLocaleDateString(undefined, {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        )}

        {/* Assignees */}
        {task.assignees.length > 0 && (
          <div className="ml-auto flex items-center -space-x-1">
            {task.assignees.slice(0, 3).map((assignee) =>
              assignee.avatarUrl ? (
                <img
                  key={assignee.id}
                  src={assignee.avatarUrl}
                  alt={assignee.name || assignee.email}
                  title={assignee.name || assignee.email}
                  className="w-5 h-5 rounded-full object-cover border border-white"
                />
              ) : (
                <div
                  key={assignee.id}
                  title={assignee.name || assignee.email}
                  className="w-5 h-5 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[10px] font-medium border border-white"
                >
                  {(assignee.name || assignee.email).charAt(0).toUpperCase()}
                </div>
              )
            )}
            {task.assignees.length > 3 && (
              <div className="w-5 h-5 rounded-full bg-gray-100 text-gray-600 flex items-center justify-center text-[10px] font-medium border border-white">
                +{task.assignees.length - 3}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Export the task type for reuse
export type { TaskCardTask };
