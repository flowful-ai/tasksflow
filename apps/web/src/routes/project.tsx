import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FolderKanban, MoreHorizontal, Plus, Settings, SearchX, Trash2 } from 'lucide-react';
import { TaskDisplayContainer } from '../components/task-display';
import { taskKeyOf } from '../components/task-display/TaskCard';
import { BoardTopBar, type FilterOption } from '../components/board/BoardTopBar';
import { BoardSkeleton } from '../components/board/BoardSkeleton';
import { BulkActionBar } from '../components/board/BulkActionBar';
import { useBoardKeyboard } from '../components/board/useBoardKeyboard';
import { useIsMobile } from '../components/board/useMediaQuery';
import {
  EMPTY_FILTERS,
  applyBoardFilters,
  describeFilters,
  hasActiveBoardFilters,
  toApiFilters,
  type BoardFilters,
} from '../components/board/filters';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  IconButton,
  Kbd,
} from '../components/ui';
import type { MoveTaskInput } from '../api/types';
import { useCreateTask, useDeleteTask, useMoveTask, useProject, useProjectTasks, useWorkspace } from '../hooks/queries';
import { useAuthStore } from '../stores/auth';
import { useWorkspaceStore, type ProjectViewMode } from '../stores/workspace';
import { useUiStore } from '../stores/ui';

export function ProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const currentUserId = useAuthStore((s) => s.user?.id ?? null);
  const storedMode = useWorkspaceStore((s): ProjectViewMode | undefined => (projectId ? s.projectViewModes[projectId] : undefined));
  const setProjectViewMode = useWorkspaceStore((s) => s.setProjectViewMode);
  const setCurrentProjectId = useWorkspaceStore((s) => s.setCurrentProjectId);
  const isMobile = useIsMobile();
  const [mobileMode, setMobileMode] = useState<ProjectViewMode | null>(null);
  const [filters, setFilters] = useState<BoardFilters>(EMPTY_FILTERS);
  const openCreateTask = useUiStore((s) => s.openCreateTask);
  const openTaskSheet = useUiStore((s) => s.openTaskSheet);
  const boardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (projectId) setCurrentProjectId(projectId);
    setFilters(EMPTY_FILTERS);
    setMobileMode(null);
  }, [projectId, setCurrentProjectId]);

  // Phones default to the list (mockup section 7); the stored choice is the desktop one.
  const viewMode: ProjectViewMode = isMobile ? mobileMode ?? 'list' : storedMode ?? 'kanban';

  const projectQuery = useProject(projectId);
  const project = projectQuery.data;
  const { data: workspaceDetail } = useWorkspace(project?.workspaceId);
  const apiFilters = useMemo(() => toApiFilters(filters), [filters]);
  const tasksQuery = useProjectTasks(projectId, apiFilters);
  const { tasks: loadedTasks, isComplete } = tasksQuery;
  const tasks = useMemo(() => applyBoardFilters(loadedTasks, filters), [loadedTasks, filters]);
  const isFiltered = hasActiveBoardFilters(filters);
  // The server total, or the client-filtered count once every page is in.
  const total = isFiltered && isComplete ? tasks.length : tasksQuery.total;

  const taskStates = useMemo(() => project?.taskStates ?? [], [project?.taskStates]);
  const visibleIds = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const taskById = useMemo(() => new Map(tasks.map((t) => [t.id, t])), [tasks]);

  const deleteTask = useDeleteTask();
  const deleteMutate = deleteTask.mutate;
  const deleteOne = useCallback(
    (taskId: string) => {
      const task = taskById.get(taskId);
      if (task) deleteMutate({ taskId, projectId: task.projectId, label: taskKeyOf(task) });
    },
    [taskById, deleteMutate]
  );

  const keyboard = useBoardKeyboard({
    containerRef: boardRef,
    visibleIds,
    onOpen: openTaskSheet,
    onDeleteOne: deleteOne,
  });
  const selectedTasks = useMemo(
    () => (keyboard.selectedIds.size === 0 ? [] : tasks.filter((t) => keyboard.selectedIds.has(t.id))),
    [tasks, keyboard.selectedIds]
  );

  const moveAsync = useMoveTask().mutateAsync;
  const onTaskMove = useCallback(
    (move: MoveTaskInput) => moveAsync(move).then(
      () => undefined,
      () => undefined
    ),
    [moveAsync]
  );
  const createAsync = useCreateTask().mutateAsync;
  const onQuickAdd = useCallback(
    async (stateId: string, title: string) => {
      if (!projectId) return;
      await createAsync({ projectId, title, stateId });
    },
    [createAsync, projectId]
  );
  const onAddTask = useCallback((stateId: string) => openCreateTask({ projectId, stateId }), [openCreateTask, projectId]);

  const members = useMemo(() => workspaceDetail?.members ?? [], [workspaceDetail?.members]);
  const memberOptions = useMemo<FilterOption[]>(
    () => members.map((m) => ({ id: m.user.id, name: m.user.name || m.user.email })),
    [members]
  );
  const labelOptions = useMemo<FilterOption[]>(
    () => (project?.labels ?? []).map((l) => ({ id: l.id, name: l.name, color: l.color })),
    [project?.labels]
  );
  const labelsByProject = useMemo(
    () => new Map(project ? [[project.id, project.labels]] : []),
    [project]
  );

  if (!project) {
    if (projectQuery.isLoading) return <BoardSkeleton variant={isMobile ? 'list' : 'kanban'} />;
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

  const setViewMode = (mode: ProjectViewMode) => (isMobile ? setMobileMode(mode) : setProjectViewMode(project.id, mode));
  const openCreate = () => openCreateTask({ projectId: project.id });
  const chips = describeFilters(filters, {
    currentUserId,
    members: new Map(memberOptions.map((m) => [m.id, m.name])),
    labels: new Map(labelOptions.map((l) => [l.id, l.name])),
  });
  const createHint = (
    <>
      Press <Kbd>C</Kbd> or use <b className="font-semibold">New</b> to create one.
    </>
  );

  let content: JSX.Element;
  if (tasksQuery.isLoading && loadedTasks.length === 0) {
    content = <BoardSkeleton variant={viewMode} />;
  } else if (tasksQuery.isError && loadedTasks.length === 0) {
    content = <ErrorState error={tasksQuery.error} resource="task list" onRetry={() => void tasksQuery.refetch()} />;
  } else if (tasks.length === 0 && isComplete && !tasksQuery.isPlaceholderData) {
    content = isFiltered ? (
      <EmptyState
        icon={<SearchX />}
        title={`No tasks match ${chips.map((c) => `"${c.label}"`).join(' + ')}`}
        body={<>Clear the filter, or press <Kbd>C</Kbd> to create one.</>}
        action={
          <button type="button" className="btn btn-secondary" onClick={() => setFilters(EMPTY_FILTERS)}>
            Clear filter
          </button>
        }
      />
    ) : (
      <EmptyState
        icon={<FolderKanban />}
        title="No tasks yet"
        body={createHint}
        action={
          <button type="button" className="btn btn-primary" onClick={openCreate}>
            New task
          </button>
        }
      />
    );
  } else {
    content = (
      <TaskDisplayContainer
        tasks={tasks}
        displayType={viewMode}
        groupBy="state"
        onTaskClick={keyboard.onTaskClick}
        onTaskMove={onTaskMove}
        showProject={false}
        allowDragDrop={viewMode === 'kanban'}
        availableStates={taskStates}
        selectedTaskIds={keyboard.selectedIds}
        onAddTask={onAddTask}
        onQuickAdd={onQuickAdd}
      />
    );
  }

  return (
    <div className="flex h-full min-w-0 flex-col">
      <BoardTopBar
        projectName={project.name}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        filters={filters}
        onFiltersChange={setFilters}
        currentUserId={currentUserId}
        members={memberOptions}
        labels={labelOptions}
        total={total}
        isRefreshing={tasksQuery.isFetching && !tasksQuery.isLoading}
        onNewTask={openCreate}
        actions={
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Project actions" icon={<MoreHorizontal />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem icon={<Settings />} asChild>
                <Link to={`/project/${project.id}/settings`}>Project settings</Link>
              </DropdownMenuItem>
              <DropdownMenuItem icon={<Trash2 />} asChild>
                <Link to={`/project/${project.id}/trash`}>Trash</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      />

      <div ref={boardRef} className="min-h-0 min-w-0 flex-1 pb-24 md:pb-16">
        {content}
      </div>

      <BulkActionBar
        tasks={selectedTasks}
        picker={keyboard.picker}
        onPickerChange={keyboard.setPicker}
        onClear={keyboard.clearSelection}
        states={taskStates}
        members={members}
        labelsByProject={labelsByProject}
        onDeleteOne={deleteOne}
      />

      {selectedTasks.length === 0 && (
        <button
          type="button"
          onClick={openCreate}
          aria-label="New task"
          className="fixed bottom-5 right-5 z-30 grid h-14 w-14 place-items-center rounded-full bg-primary-500 text-white shadow-lg hover:bg-primary-600 md:hidden"
        >
          <Plus aria-hidden className="h-6 w-6" />
        </button>
      )}

    </div>
  );
}
