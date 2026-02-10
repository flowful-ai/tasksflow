import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api, ApiError } from '../api/client';
import { TaskDisplayContainer, type DisplayType } from '../components/task-display/TaskDisplayContainer';
import type { GroupBy } from '../components/task-display/grouping';
import type { TaskCardTask } from '../components/task-display/TaskCard';
import { TaskDetailSheet } from '../components/tasks/TaskDetailSheet';

interface PublicTaskState {
  id: string;
  name: string;
  color: string | null;
  category?: string;
}

interface PublicTask {
  id: string;
  title: string;
  priority: string | null;
  dueDate: string | null;
  sequenceNumber: number;
  state: PublicTaskState | null;
  assignees: {
    id: string;
    name: string | null;
    email: string;
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
  description: string | null;
  stateId: string | null;
  externalLinks?: {
    id: string;
    externalType: 'github_issue' | 'github_pr';
    externalId: string;
    externalUrl: string;
  }[];
  createdAt: string;
  updatedAt: string | null;
}

interface PublicView {
  name: string;
  displayType: DisplayType;
  groupBy?: GroupBy;
  secondaryGroupBy?: GroupBy | null;
}

interface PublicShareData {
  requiresPassword?: boolean;
  view?: PublicView;
  tasks?: PublicTask[];
}

export function PublicSharePage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [selectedTask, setSelectedTask] = useState<PublicTask | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['public-share', token],
    queryFn: async () => {
      const response = await api.get<{ data: PublicShareData }>(`/api/public/share/${token}`);
      return response.data;
    },
    enabled: !!token,
    retry: false,
  });

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    try {
      await api.post<{ data: PublicShareData }>(`/api/public/share/${token}/verify`, { password });
      // Update the query data
      refetch();
    } catch (err) {
      if (err instanceof ApiError) {
        setPasswordError(err.message);
      } else {
        setPasswordError('Invalid password');
      }
    }
  };

  const handleTaskClick = (taskId: string, _event: React.MouseEvent<HTMLDivElement>) => {
    const task = data?.tasks?.find((t) => t.id === taskId);
    if (task) {
      setSelectedTask(task);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Share not found</h1>
          <p className="text-gray-600">This share link may have expired or been disabled.</p>
        </div>
      </div>
    );
  }

  // Password required
  if (data.requiresPassword) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="mx-auto w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-gray-600" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Protected Share</h1>
            <p className="text-gray-600 mt-2">This view is password protected</p>
          </div>

          <form onSubmit={handlePasswordSubmit} className="card p-6">
            {passwordError && (
              <div className="p-3 mb-4 text-sm text-red-600 bg-red-50 rounded-lg">
                {passwordError}
              </div>
            )}

            <div className="mb-4">
              <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
                Password
              </label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input"
                placeholder="Enter password"
                required
              />
            </div>

            <button type="submit" className="btn btn-primary w-full">
              View Share
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Show the shared view
  const view = data.view;
  const tasks = data.tasks || [];
  const displayType = view?.displayType || 'list';
  const groupBy = view?.groupBy || 'state';
  const secondaryGroupBy = view?.secondaryGroupBy || undefined;

  // Transform tasks to TaskCardTask format
  const taskCards: TaskCardTask[] = tasks.map((task) => ({
    id: task.id,
    title: task.title,
    priority: task.priority,
    dueDate: task.dueDate,
    state: task.state,
    assignees: task.assignees,
    labels: task.labels,
    project: task.project,
    sequenceNumber: task.sequenceNumber,
  }));

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-gray-900">FlowTask</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-gray-900">{view?.name}</h1>
          <p className="text-gray-600 mt-1">
            {tasks.length} task{tasks.length !== 1 ? 's' : ''}
          </p>
        </div>

        <div className="card p-4">
          {taskCards.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500">No tasks to display</p>
            </div>
          ) : (
            <TaskDisplayContainer
              tasks={taskCards}
              displayType={displayType}
              groupBy={groupBy}
              secondaryGroupBy={secondaryGroupBy}
              onTaskClick={handleTaskClick}
              showProject={true}
              allowDragDrop={false}
            />
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
          Shared via FlowTask
        </div>
      </footer>

      {/* Task Detail Sheet */}
      {selectedTask && (
        <TaskDetailSheet
          taskId={selectedTask.id}
          projectId={selectedTask.project.id}
          states={[]}
          onClose={() => setSelectedTask(null)}
          readOnly={true}
          initialTask={{
            id: selectedTask.id,
            title: selectedTask.title,
            description: selectedTask.description,
            priority: selectedTask.priority,
            stateId: selectedTask.stateId,
            state: selectedTask.state,
            project: selectedTask.project,
            assignees: selectedTask.assignees,
            labels: selectedTask.labels,
            externalLinks: selectedTask.externalLinks || [],
            sequenceNumber: selectedTask.sequenceNumber,
            dueDate: selectedTask.dueDate,
            startDate: null,
            createdAt: selectedTask.createdAt,
            updatedAt: selectedTask.updatedAt,
          }}
        />
      )}
    </div>
  );
}
