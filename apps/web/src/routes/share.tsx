import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { ApiError } from '../api/http';
import { publicShareApi, type PublicTaskDto } from '../api/smartViews';
import { queryKeys } from '../api/queryKeys';
import { usePublicShare } from '../hooks/queries';
import { TaskDisplayContainer } from '../components/task-display/TaskDisplayContainer';
import type { TaskCardTask } from '../components/task-display/TaskCard';
import { TaskDetailSheet } from '../components/tasks/TaskDetailSheet';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  PageSpinner,
} from '../components/ui';

export function PublicSharePage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [selectedTask, setSelectedTask] = useState<PublicTaskDto | null>(null);

  const queryClient = useQueryClient();
  const { data, isLoading, error } = usePublicShare(token);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) return;
    setPasswordError('');
    try {
      const unlocked = await publicShareApi.verify(token, password);
      queryClient.setQueryData(queryKeys.publicShares.byToken(token), unlocked);
      await queryClient.invalidateQueries({ queryKey: queryKeys.publicShares.byToken(token) });
    } catch (err) {
      setPasswordError(err instanceof ApiError ? err.message : 'Invalid password');
    }
  };

  const handleTaskClick = (taskId: string) => {
    const task = data?.tasks?.find((t) => t.id === taskId);
    if (task) {
      setSelectedTask(task);
    }
  };

  if (isLoading) {
    return <PageSpinner className="min-h-screen bg-neutral-50" label="Loading shared view" />;
  }

  if (error || !data) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-50">
        <ErrorState
          error={error}
          resource="share link"
          onRetry={() => window.location.reload()}
          notFoundAction={
            <p className="text-sm text-neutral-500">The link may have expired or been disabled.</p>
          }
        />
      </main>
    );
  }

  // Password required
  if (data.requiresPassword) {
    return (
      <main className="min-h-screen flex items-center justify-center bg-neutral-50 py-12 px-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="mx-auto w-12 h-12 bg-neutral-100 rounded-full flex items-center justify-center mb-4">
              <Lock className="w-6 h-6 text-neutral-600" />
            </div>
            <h1 className="text-2xl font-bold text-neutral-900">Protected Share</h1>
            <p className="text-neutral-600 mt-2">This view is password protected</p>
          </div>

          <form onSubmit={handlePasswordSubmit} className="card p-6">
            {passwordError && (
              <div role="alert" className="p-3 mb-4 text-sm text-red-600 bg-red-50 rounded-lg">
                {passwordError}
              </div>
            )}

            <Field label="Password" id="password" className="mb-4">
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                required
              />
            </Field>

            <Button type="submit" block>
              View Share
            </Button>
          </form>
        </div>
      </main>
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
    updatedAt: task.updatedAt,
    state: task.state,
    agent: null,
    assignees: task.assignees,
    labels: task.labels,
    project: task.project,
    sequenceNumber: task.sequenceNumber,
  }));

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Header */}
      <header className="bg-white border-b border-neutral-200">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center space-x-2">
            <div
              aria-hidden
              className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center"
            >
              <svg
                className="w-5 h-5 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-neutral-900">TasksFlow</span>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        <PageHeader
          title={view?.name}
          description={`${tasks.length} task${tasks.length !== 1 ? 's' : ''}`}
        />

        <Card padding="sm">
          {taskCards.length === 0 ? (
            <EmptyState
              title="No tasks to display"
              body="This view has no matching tasks right now."
            />
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
        </Card>
      </main>

      {/* Footer */}
      <footer className="border-t border-neutral-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-neutral-500">
          Shared via TasksFlow
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
            externalLinks: selectedTask.externalLinks ?? [],
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
