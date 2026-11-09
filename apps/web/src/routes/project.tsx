import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Plus, MoreHorizontal, LayoutGrid, List, User, Settings, FolderKanban } from 'lucide-react';
import clsx from 'clsx';
import {
  BulkTaskToolbar,
  type BulkAssigneeOption,
  type BulkLabelOption,
  TaskDisplayContainer,
  type TaskOpenEvent,
} from '../components/task-display';
import { TaskModal } from '../components/tasks/TaskModal';
import { TaskDetailSheet } from '../components/tasks/TaskDetailSheet';
import { LiveIndicator } from '../components/realtime/ConnectionStatus';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  IconButton,
  PageSpinner,
  Spinner,
  Tooltip,
} from '../components/ui';
import { useMoveTask, useProject, useProjectTasks, useWorkspace } from '../hooks/queries';
import { useBulkTaskActions } from '../hooks/useBulkTaskActions';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore, type ProjectViewMode } from '../stores/workspace';

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const displayType = useWorkspaceStore((s): ProjectViewMode => (projectId && s.projectViewModes[projectId]) || 'kanban');
  const setProjectViewMode = useWorkspaceStore((s) => s.setProjectViewMode);
  const setCurrentProjectId = useWorkspaceStore((s) => s.setCurrentProjectId);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [isAssignedToMeOnly, setIsAssignedToMeOnly] = useState(false);

  useEffect(() => {
    if (projectId) setCurrentProjectId(projectId);
  }, [projectId, setCurrentProjectId]);

  const projectQuery = useProject(projectId);
  const project = projectQuery.data;
  const { data: workspaceDetail } = useWorkspace(project?.workspaceId);
  const filters = isAssignedToMeOnly && currentUserId ? { assigneeId: currentUserId } : {};
  const tasksQuery = useProjectTasks(projectId, filters);
  const { tasks, total } = tasksQuery;
  const moveTask = useMoveTask();

  const taskStates = useMemo(() => project?.taskStates ?? [], [project?.taskStates]);
  const selectedTasks = useMemo(() => tasks.filter((t) => selectedTaskIds.has(t.id)), [tasks, selectedTaskIds]);
  const bulk = useBulkTaskActions(selectedTasks, taskStates, () => setSelectedTaskIds(new Set()));

  const assigneeOptions = useMemo<BulkAssigneeOption[]>(
    () =>
      (workspaceDetail?.members ?? []).map((m) => ({
        id: m.user.id,
        name: m.user.name,
        email: m.user.email,
        avatarUrl: m.user.avatarUrl,
      })),
    [workspaceDetail?.members]
  );
  const labelOptions = useMemo<BulkLabelOption[]>(
    () => (project?.labels ?? []).map((l) => ({ id: l.id, name: l.name, color: l.color })),
    [project?.labels]
  );

  // Drop selections that are no longer visible (deleted, filtered out).
  useEffect(() => {
    setSelectedTaskIds((previous) => {
      if (previous.size === 0) return previous;
      const visible = new Set(tasks.map((t) => t.id));
      const next = new Set([...previous].filter((id) => visible.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [tasks]);

  if (projectQuery.isLoading || (tasksQuery.isLoading && !tasksQuery.data)) {
    return <PageSpinner label="Loading project" />;
  }

  if (!project) {
    return (
      <ErrorState
        error={projectQuery.error}
        resource="project"
        onRetry={() => void projectQuery.refetch()}
        notFoundAction={
          <Link to="/projects" className="btn btn-secondary">
            Back to projects
          </Link>
        }
      />
    );
  }

  const handleTaskClick = (taskId: string, event: TaskOpenEvent) => {
    if (event.ctrlKey || event.metaKey) {
      setSelectedTaskIds((previous) => {
        const next = new Set(previous);
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        return next;
      });
      return;
    }
    setSelectedTaskIds(new Set());
    setSelectedTaskId(taskId);
  };

  const setDisplayType = (mode: ProjectViewMode) => setProjectViewMode(project.id, mode);

  return (
    <div className="h-full flex flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <span className="text-sm font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">{project.identifier}</span>
          <h1 className="text-2xl font-bold text-gray-900 mt-1">{project.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <LiveIndicator suffix={`${total} task${total === 1 ? '' : 's'}`} />
          {tasksQuery.isFetching && !tasksQuery.isLoading && <Spinner size="sm" label="Refreshing tasks" />}
          <div role="group" aria-label="View" className="flex items-center border border-gray-200 rounded-lg p-0.5">
            <IconButton
              label="Board view"
              icon={<LayoutGrid />}
              aria-pressed={displayType === 'kanban'}
              onClick={() => setDisplayType('kanban')}
              className={clsx(displayType === 'kanban' && 'bg-gray-100 text-gray-900')}
            />
            <IconButton
              label="List view"
              icon={<List />}
              aria-pressed={displayType === 'list'}
              onClick={() => setDisplayType('list')}
              className={clsx(displayType === 'list' && 'bg-gray-100 text-gray-900')}
            />
          </div>
          <Tooltip content="Show only tasks assigned to me">
            <button
              type="button"
              onClick={() => setIsAssignedToMeOnly((previous) => !previous)}
              className={clsx(
                'inline-flex items-center gap-1.5 border rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                isAssignedToMeOnly
                  ? 'border-primary-200 bg-primary-50 text-primary-700'
                  : 'border-gray-200 text-gray-600 hover:bg-gray-50'
              )}
              aria-pressed={isAssignedToMeOnly}
            >
              <User aria-hidden className="w-4 h-4" />
              My tasks
            </button>
          </Tooltip>
          <button type="button" onClick={() => setIsCreateModalOpen(true)} className="btn btn-primary">
            <Plus aria-hidden className="w-4 h-4 mr-2" />
            Add Task
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Project actions" size="md" icon={<MoreHorizontal />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<Settings />} asChild>
                <Link to={`/project/${project.id}/settings`}>Project settings</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <BulkTaskToolbar
        selectedCount={selectedTaskIds.size}
        members={assigneeOptions}
        labels={labelOptions}
        isLoading={bulk.isPending}
        onClearSelection={() => setSelectedTaskIds(new Set())}
        onAssign={bulk.assign}
        onSetLabels={bulk.setLabels}
        onMoveToDone={bulk.moveToDone}
        onCancel={bulk.cancel}
        onDelete={bulk.remove}
      />

      <div className="flex-1 min-h-0">
        {tasks.length === 0 && !tasksQuery.isFetching ? (
          isAssignedToMeOnly ? (
            <EmptyState
              icon={<FolderKanban />}
              title='No tasks match "Assignee: me"'
              body="Clear the filter or create a task."
              action={
                <button type="button" className="btn btn-secondary" onClick={() => setIsAssignedToMeOnly(false)}>
                  Clear filter
                </button>
              }
            />
          ) : (
            <EmptyState
              icon={<FolderKanban />}
              title="No tasks yet"
              body="Create the first task of this project."
              action={
                <button type="button" className="btn btn-primary" onClick={() => setIsCreateModalOpen(true)}>
                  Add Task
                </button>
              }
            />
          )
        ) : tasksQuery.isError && tasks.length === 0 ? (
          <ErrorState error={tasksQuery.error} resource="task list" onRetry={() => void tasksQuery.refetch()} />
        ) : (
          <TaskDisplayContainer
            tasks={tasks}
            displayType={displayType}
            groupBy="state"
            onTaskClick={handleTaskClick}
            onTaskMove={(move) => moveTask.mutateAsync(move).then(() => undefined, () => undefined)}
            showProject={false}
            allowDragDrop={displayType === 'kanban'}
            availableStates={taskStates}
            selectedTaskIds={selectedTaskIds}
          />
        )}
      </div>

      {isCreateModalOpen && (
        <TaskModal
          projectId={project.id}
          states={taskStates}
          onClose={() => setIsCreateModalOpen(false)}
          onCreated={() => setIsCreateModalOpen(false)}
        />
      )}

      {selectedTaskId && (
        <TaskDetailSheet
          taskId={selectedTaskId}
          projectId={project.id}
          states={taskStates}
          onClose={() => setSelectedTaskId(null)}
        />
      )}
    </div>
  );
}
