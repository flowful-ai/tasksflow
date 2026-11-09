import { useParams, Link } from 'react-router-dom';
import { ArrowLeft, Clock, User, Tag } from 'lucide-react';
import clsx from 'clsx';
import { useTask } from '../hooks/queries';
import { ColorDot, ErrorState, PageSpinner } from '../components/ui';

export function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();

  const { data: task, isLoading, error, refetch } = useTask(taskId);

  if (isLoading) {
    return <PageSpinner label="Loading task" />;
  }

  if (!task) {
    return (
      <ErrorState
        error={error}
        resource="task"
        onRetry={() => void refetch()}
        notFoundAction={
          <Link to="/projects" className="btn btn-secondary">
            Back to projects
          </Link>
        }
      />
    );
  }

  const priorityClasses: Record<string, string> = {
    urgent: 'badge-urgent',
    high: 'badge-high',
    medium: 'badge-medium',
    low: 'badge-low',
  };

  return (
    <div className="max-w-4xl mx-auto">
      {/* Back link */}
      <Link
        to={`/project/${task.project.id}`}
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4 mr-1" aria-hidden />
        Back to {task.project.name}
      </Link>

      <div className="card">
        {/* Header */}
        <header className="p-6 border-b border-gray-200">
          <div className="flex items-center space-x-2 text-sm text-gray-500 mb-2">
            <span className="font-medium">{task.project.identifier}-{task.sequenceNumber}</span>
            {task.state && (
              <>
                <span>·</span>
                <span className="inline-flex items-center gap-1.5 rounded border border-gray-200 px-2 py-0.5 text-xs font-medium text-gray-700">
                  <ColorDot color={task.state.color} />
                  {task.state.name}
                </span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{task.title}</h1>
        </header>

        {/* Content */}
        <div className="p-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main content */}
          <div className="lg:col-span-2 space-y-6">
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Description</h3>
              {task.description ? (
                <div className="prose prose-sm max-w-none text-gray-600">
                  {task.description}
                </div>
              ) : (
                <p className="text-gray-400 italic">No description</p>
              )}
            </div>

            {/* Activity / Comments would go here */}
          </div>

          {/* Sidebar */}
          <div className="space-y-6">
            {/* Priority */}
            {task.priority && (
              <div>
                <h3 className="text-sm font-medium text-gray-700 mb-2">Priority</h3>
                <span className={clsx('badge', priorityClasses[task.priority])}>
                  {task.priority.charAt(0).toUpperCase() + task.priority.slice(1)}
                </span>
              </div>
            )}

            {/* Assignees */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Assignees</h3>
              {task.assignees.length > 0 ? (
                <div className="space-y-2">
                  {task.assignees.map((assignee) => (
                    <div key={assignee.id} className="flex items-center space-x-2">
                      <div className="w-6 h-6 rounded-full bg-primary-100 flex items-center justify-center">
                        <span className="text-xs font-medium text-primary-600">
                          {assignee.name?.[0] || assignee.email[0]?.toUpperCase()}
                        </span>
                      </div>
                      <span className="text-sm text-gray-600">
                        {assignee.name || assignee.email}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 flex items-center">
                  <User className="w-4 h-4 mr-1" />
                  No assignees
                </p>
              )}
            </div>

            {/* Labels */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Labels</h3>
              {task.labels.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {task.labels.map((label) => (
                    <span
                      key={label.id}
                      className="badge gap-1.5 border border-gray-200 bg-white text-gray-700"
                    >
                      <ColorDot color={label.color} />
                      {label.name}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 flex items-center">
                  <Tag className="w-4 h-4 mr-1" />
                  No labels
                </p>
              )}
            </div>

            {/* Due date */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Due date</h3>
              {task.dueDate ? (
                <p className="text-sm text-gray-600 flex items-center">
                  <Clock className="w-4 h-4 mr-1" />
                  {new Date(task.dueDate).toLocaleDateString()}
                </p>
              ) : (
                <p className="text-sm text-gray-400 flex items-center">
                  <Clock className="w-4 h-4 mr-1" />
                  No due date
                </p>
              )}
            </div>

            {/* Created */}
            <div>
              <h3 className="text-sm font-medium text-gray-700 mb-2">Created</h3>
              <p className="text-sm text-gray-600">
                {new Date(task.createdAt).toLocaleDateString()}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
