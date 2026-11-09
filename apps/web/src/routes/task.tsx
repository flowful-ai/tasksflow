import { useNavigate, useParams } from 'react-router-dom';
import { TaskDetailView } from '../components/tasks/detail/TaskDetailView';

/** Full-page task detail: the same components as the sheet. */
export function TaskPage() {
  const { taskId } = useParams<{ taskId: string }>();
  const navigate = useNavigate();
  if (!taskId) return null;

  return (
    <div className="mx-auto max-w-6xl">
      <div className="overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-card">
        <TaskDetailView
          key={taskId}
          taskId={taskId}
          mode="page"
          onOpenTask={(id) => navigate(`/task/${id}`)}
          onDeleted={(projectId) => navigate(`/project/${projectId}`, { replace: true })}
        />
      </div>
    </div>
  );
}
