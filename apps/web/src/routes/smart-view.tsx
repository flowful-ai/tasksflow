import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';

interface SmartViewTask {
  id: string;
  title: string;
}

interface SmartViewData {
  name: string;
  description: string | null;
  displayType: string;
}

export function SmartViewPage() {
  const { viewId } = useParams<{ viewId: string }>();

  const { data, isLoading } = useQuery({
    queryKey: ['smart-view', viewId],
    queryFn: async () => {
      const response = await api.get<{ data: { view: SmartViewData; tasks: SmartViewTask[] } }>(
        `/api/smart-views/${viewId}/execute`
      );
      return response.data;
    },
    enabled: !!viewId,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-12">
        <h2 className="text-xl font-semibold text-gray-900">View not found</h2>
      </div>
    );
  }

  const view = data.view;
  const tasks = data.tasks;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">{view.name}</h1>
        {view.description && (
          <p className="text-gray-600 mt-1">{view.description}</p>
        )}
      </div>

      <div className="card p-6">
        <p className="text-gray-600">
          Display type: {view.displayType}
        </p>
        <p className="text-gray-600 mt-2">
          {tasks.length} task{tasks.length !== 1 ? 's' : ''} found
        </p>

        {/* Task list would be rendered based on displayType */}
        <div className="mt-4 space-y-2">
          {tasks.map((task) => (
            <div key={task.id} className="p-3 bg-gray-50 rounded-lg">
              {task.title}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
