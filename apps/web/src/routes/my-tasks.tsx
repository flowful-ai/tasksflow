/**
 * My tasks: everything assigned to me across the workspace's projects,
 * grouped by project or by status (the shared read-only TaskListView).
 *
 * Each project is loaded with useProjectTasks(projectId, { assigneeId }) —
 * the same cache entries as the board's "My tasks" filter — so realtime and
 * optimistic updates keep this page current.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Target } from 'lucide-react';
import type { TaskDto } from '../api/types';
import { useCurrentWorkspace, useProjects, useProjectTasks } from '../hooks/queries';
import { useAuthStore } from '../stores/auth';
import { useUiStore } from '../stores/ui';
import { TaskListView, type AvailableState, type GroupBy } from '../components/task-display';
import {
  Checkbox,
  EmptyState,
  PageHeader,
  PageSpinner,
  SegmentedControl,
  Spinner,
} from '../components/ui';

interface ProjectResult {
  tasks: TaskDto[];
  loading: boolean;
}

function ProjectAssignedTasks({
  projectId,
  userId,
  onResult,
}: {
  projectId: string;
  userId: string;
  onResult: (projectId: string, result: ProjectResult) => void;
}) {
  const { tasks, isLoading, isComplete } = useProjectTasks(projectId, { assigneeId: userId });
  useEffect(() => {
    onResult(projectId, { tasks, loading: isLoading || !isComplete });
  }, [projectId, tasks, isLoading, isComplete, onResult]);
  return null;
}

const GROUPINGS: { value: GroupBy; label: string }[] = [
  { value: 'project', label: 'Project' },
  { value: 'state', label: 'Status' },
];

export function MyTasksPage() {
  const userId = useAuthStore((s) => s.user?.id);
  const { workspaceId } = useCurrentWorkspace();
  const { data: projects = [], isLoading: projectsLoading } = useProjects(workspaceId);
  const openTaskSheet = useUiStore((s) => s.openTaskSheet);
  const [groupBy, setGroupBy] = useState<GroupBy>('project');
  const [hideDone, setHideDone] = useState(true);
  const [results, setResults] = useState<Record<string, ProjectResult>>({});

  const onResult = useCallback((projectId: string, result: ProjectResult) => {
    setResults((previous) =>
      previous[projectId] === result ? previous : { ...previous, [projectId]: result }
    );
  }, []);

  const projectIds = useMemo(() => new Set(projects.map((p) => p.id)), [projects]);
  const allTasks = useMemo(
    () =>
      Object.entries(results).flatMap(([projectId, r]) =>
        projectIds.has(projectId) ? r.tasks : []
      ),
    [results, projectIds]
  );
  const tasks = useMemo(
    () => (hideDone ? allTasks.filter((t) => t.state?.category !== 'done') : allTasks),
    [allTasks, hideDone]
  );
  const loading = projectsLoading || projects.some((p) => results[p.id]?.loading ?? true);

  // Status grouping merges same-category states across projects.
  const states = useMemo<AvailableState[]>(
    () =>
      projects.flatMap((p) =>
        p.taskStates.map((s) => ({
          id: s.id,
          name: s.name,
          color: s.color,
          category: s.category,
          projectId: p.id,
        }))
      ),
    [projects]
  );

  return (
    <div className="mx-auto max-w-5xl">
      {userId &&
        projects.map((p) => (
          <ProjectAssignedTasks key={p.id} projectId={p.id} userId={userId} onResult={onResult} />
        ))}

      <PageHeader
        title={
          <>
            My tasks
            {loading && <Spinner size="sm" label="Loading tasks" />}
          </>
        }
        description={`${tasks.length} task${tasks.length === 1 ? '' : 's'} assigned to you across ${projects.length} project${projects.length === 1 ? '' : 's'}`}
        actions={
          <>
            <Checkbox
              checked={hideDone}
              onChange={(e) => setHideDone(e.target.checked)}
              label="Hide done"
              labelClassName="items-center"
            />
            <SegmentedControl
              label="Group by"
              value={groupBy}
              onChange={setGroupBy}
              options={GROUPINGS}
            />
          </>
        }
      />

      {projectsLoading ? (
        <PageSpinner label="Loading projects" />
      ) : tasks.length === 0 && !loading ? (
        <EmptyState
          icon={<Target />}
          title={
            hideDone && allTasks.length > 0 ? 'All your tasks are done' : 'Nothing assigned to you'
          }
          body="Tasks assigned to you in any project show up here."
        />
      ) : (
        <TaskListView
          tasks={tasks}
          groupBy={groupBy}
          onTaskClick={(taskId) => openTaskSheet(taskId)}
          showProject={groupBy !== 'project'}
          availableStates={groupBy === 'state' ? states : undefined}
          mergeStatesByCategory={groupBy === 'state'}
        />
      )}
    </div>
  );
}
