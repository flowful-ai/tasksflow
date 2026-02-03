import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { api, ApiError } from '../api/client';

interface PublicTask {
  id: string;
  title: string;
  priority?: string;
}

export function PublicSharePage() {
  const { token } = useParams<{ token: string }>();
  const [password, setPassword] = useState('');
  const [passwordError, setPasswordError] = useState('');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['public-share', token],
    queryFn: async () => {
      const response = await api.get<{
        data: {
          requiresPassword?: boolean;
          view?: { name: string; displayType: string };
          tasks?: PublicTask[];
        };
      }>(`/api/public/share/${token}`);
      return response.data;
    },
    enabled: !!token,
    retry: false,
  });

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError('');

    try {
      await api.post<{
        data: {
          view: { name: string; displayType: string };
          tasks: PublicTask[];
        };
      }>(`/api/public/share/${token}/verify`, { password });

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

        <div className="card">
          {tasks.length === 0 ? (
            <div className="p-12 text-center">
              <p className="text-gray-500">No tasks to display</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {tasks.map((task: { id: string; title: string; priority?: string }) => (
                <div key={task.id} className="p-4 hover:bg-gray-50">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900">{task.title}</span>
                    {task.priority && (
                      <span className={`badge badge-${task.priority}`}>
                        {task.priority}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-200 mt-12">
        <div className="max-w-7xl mx-auto px-4 py-4 text-center text-sm text-gray-500">
          Shared via FlowTask
        </div>
      </footer>
    </div>
  );
}
