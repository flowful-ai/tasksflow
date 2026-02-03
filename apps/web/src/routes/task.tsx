import { useParams, Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Clock, User, Tag } from 'lucide-react';
import { api } from '../api/client';
import clsx from 'clsx';

export function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();

  const { data: task, isLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: async () => {
      const response = await api.get<{ data: unknown }>(`/api/tasks/${taskId}`);
      return response.data as {
        id: string;
        title: string;
        description: string | null;
        priority: string | null;
        state: { name: string; color: string | null } | null;
        project: { id: string; identifier: string; name: string };
        assignees: { id: string; name: string | null; email: string }[];
        labels: { id: string; name: string; color: string | null }[];
        sequenceNumber: number;
        dueDate: string | null;
        createdAt: string;
      };
    },
    enabled: !!taskId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!task) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">Task not found</h2>
      </div>
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
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back to {task.project.name}
      </Link>

      <div className="card">
        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center space-x-2 text-sm text-gray-500 mb-2">
            <span className="font-medium">{task.project.identifier}-{task.sequenceNumber}</span>
            {task.state && (
              <>
                <span>·</span>
                <span
                  className="px-2 py-0.5 rounded text-xs font-medium"
                  style={{ backgroundColor: task.state.color || '#e5e7eb' }}
                >
                  {task.state.name}
                </span>
              </>
            )}
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{task.title}</h1>
        </div>

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
                      className="badge"
                      style={{ backgroundColor: label.color || '#e5e7eb' }}
                    >
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
