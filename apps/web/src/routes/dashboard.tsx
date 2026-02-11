import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import {
  FolderKanban,
  Plus,
  CheckCircle,
  Clock,
  AlertCircle,
  ArrowRight,
  Sparkles,
  History,
  MessageSquare,
  ArrowRightLeft,
  UserPlus,
  UserMinus,
  Tag,
  Trash2,
  RotateCcw,
  CircleDot,
} from 'lucide-react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useWorkspaceStore } from '../stores/workspace';
import { useAuthStore } from '../stores/auth';
import { api, workspaceApi, type WorkspaceActivityItem } from '../api/client';
import clsx from 'clsx';

interface DashboardTask {
  id: string;
  dueDate: string | null;
  state: {
    category: string;
  } | null;
}

interface TaskListResponse {
  data: DashboardTask[];
  meta: {
    total: number;
    page: number;
    limit: number;
  };
}

const ACTIVITY_PAGE_SIZE = 20;

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins === 1 ? '' : 's'} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
  if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
  return date.toLocaleDateString();
}

function getActivityPresentation(eventType: WorkspaceActivityItem['eventType']) {
  switch (eventType) {
    case 'created':
      return { icon: Plus, iconClass: 'text-emerald-600', bgClass: 'bg-emerald-100', label: 'created this task' };
    case 'updated':
      return { icon: Sparkles, iconClass: 'text-blue-600', bgClass: 'bg-blue-100', label: 'updated this task' };
    case 'moved':
      return { icon: ArrowRightLeft, iconClass: 'text-indigo-600', bgClass: 'bg-indigo-100', label: 'moved this task' };
    case 'assigned':
      return { icon: UserPlus, iconClass: 'text-cyan-600', bgClass: 'bg-cyan-100', label: 'assigned someone' };
    case 'unassigned':
      return { icon: UserMinus, iconClass: 'text-slate-600', bgClass: 'bg-slate-200', label: 'removed an assignee' };
    case 'labeled':
      return { icon: Tag, iconClass: 'text-amber-600', bgClass: 'bg-amber-100', label: 'added a label' };
    case 'unlabeled':
      return { icon: Tag, iconClass: 'text-neutral-600', bgClass: 'bg-neutral-200', label: 'removed a label' };
    case 'commented':
      return { icon: MessageSquare, iconClass: 'text-fuchsia-600', bgClass: 'bg-fuchsia-100', label: 'commented' };
    case 'deleted':
      return { icon: Trash2, iconClass: 'text-red-600', bgClass: 'bg-red-100', label: 'deleted this task' };
    case 'restored':
      return { icon: RotateCcw, iconClass: 'text-green-700', bgClass: 'bg-green-100', label: 'restored this task' };
    default:
      return { icon: CircleDot, iconClass: 'text-neutral-600', bgClass: 'bg-neutral-200', label: 'changed this task' };
  }
}

function activityText(item: WorkspaceActivityItem): string {
  const actorName = item.actor?.name || item.actor?.email || 'Someone';
  const presentation = getActivityPresentation(item.eventType);
  if (item.eventType === 'updated' && item.fieldName) {
    return `${actorName} updated ${item.fieldName}`;
  }
  return `${actorName} ${presentation.label}`;
}

async function fetchProjectTasks(projectId: string): Promise<DashboardTask[]> {
  const limit = 100;
  let page = 1;
  let total = 0;
  const allTasks: DashboardTask[] = [];

  do {
    const response = await api.get<TaskListResponse>(`/api/tasks?projectId=${projectId}&page=${page}&limit=${limit}`);
    allTasks.push(...response.data);
    total = response.meta.total;
    page += 1;
  } while (allTasks.length < total);

  return allTasks;
}

export function DashboardPage() {
  const { currentWorkspace, projects, fetchWorkspaces, fetchProjects } = useWorkspaceStore();
  const { user } = useAuthStore();

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    if (currentWorkspace) {
      fetchProjects(currentWorkspace.id);
    }
  }, [currentWorkspace, fetchProjects]);

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 18) return 'Good afternoon';
    return 'Good evening';
  };

  const firstName = user?.name?.split(' ')[0] || user?.email?.split('@')[0] || 'there';
  const projectIdsKey = projects.map((project) => project.id).join(',');

  const { data: taskStats, isLoading: statsLoading, isError: statsError } = useQuery({
    queryKey: ['dashboard-task-stats', currentWorkspace?.id, projectIdsKey],
    queryFn: async () => {
      if (!currentWorkspace || projects.length === 0) {
        return { completed: 0, inProgress: 0, overdue: 0 };
      }

      const projectTasks = await Promise.all(projects.map((project) => fetchProjectTasks(project.id)));
      const allTasks = projectTasks.flat();
      const now = Date.now();

      return allTasks.reduce(
        (acc, task) => {
          const isDone = task.state?.category === 'done';

          if (isDone) {
            acc.completed += 1;
          }

          if (task.state?.category === 'in_progress') {
            acc.inProgress += 1;
          }

          if (!isDone && task.dueDate && new Date(task.dueDate).getTime() < now) {
            acc.overdue += 1;
          }

          return acc;
        },
        { completed: 0, inProgress: 0, overdue: 0 }
      );
    },
    enabled: !!currentWorkspace,
    staleTime: 30_000,
  });

  const {
    data: activityPages,
    isLoading: activityLoading,
    isError: activityError,
    hasNextPage,
    fetchNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['workspace-activity', currentWorkspace?.id],
    queryFn: ({ pageParam }) => {
      if (!currentWorkspace) {
        throw new Error('No workspace selected');
      }
      return workspaceApi.listActivity(currentWorkspace.id, {
        limit: ACTIVITY_PAGE_SIZE,
        cursor: pageParam ?? undefined,
      });
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.meta.nextCursor ?? undefined,
    enabled: !!currentWorkspace,
    staleTime: 15_000,
  });

  const activities = activityPages?.pages.flatMap((page) => page.data) ?? [];

  return (
    <div className="max-w-6xl mx-auto space-y-10">
      {/* Welcome Header */}
      <div className="opacity-0 animate-fade-in">
        <p className="text-sm font-medium text-neutral-500 mb-1">{getGreeting()}</p>
        <h1 className="text-4xl font-display font-bold text-neutral-900 tracking-tight">
          {firstName}
        </h1>
        <p className="text-neutral-500 mt-2">
          {currentWorkspace ? `Here's what's happening in ${currentWorkspace.name}` : 'Welcome to TasksFlow'}
        </p>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <div className="card card-hover p-6 stat-gradient-green opacity-0 animate-slide-up stagger-1">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-600">Completed</p>
              <p className="text-3xl font-display font-bold text-neutral-900 mt-1">
                {statsLoading ? '...' : taskStats?.completed ?? 0}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center">
              <CheckCircle className="w-6 h-6 text-emerald-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-emerald-600">
            <Sparkles className="w-4 h-4 mr-1" />
            <span>
              {statsError
                ? "Couldn't load task stats"
                : (taskStats?.completed ?? 0) > 0
                  ? 'Tasks in done states'
                  : 'No completed tasks yet'}
            </span>
          </div>
        </div>

        <div className="card card-hover p-6 stat-gradient-blue opacity-0 animate-slide-up stagger-2">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-600">In Progress</p>
              <p className="text-3xl font-display font-bold text-neutral-900 mt-1">
                {statsLoading ? '...' : taskStats?.inProgress ?? 0}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-blue-100 flex items-center justify-center">
              <Clock className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-blue-600">
            <span>
              {statsError
                ? "Couldn't load task stats"
                : (taskStats?.inProgress ?? 0) > 0
                  ? 'Tasks actively being worked on'
                  : 'No active tasks'}
            </span>
          </div>
        </div>

        <div className="card card-hover p-6 stat-gradient-red opacity-0 animate-slide-up stagger-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-neutral-600">Overdue</p>
              <p className="text-3xl font-display font-bold text-neutral-900 mt-1">
                {statsLoading ? '...' : taskStats?.overdue ?? 0}
              </p>
            </div>
            <div className="w-12 h-12 rounded-2xl bg-red-100 flex items-center justify-center">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
          </div>
          <div className="mt-4 flex items-center text-sm text-neutral-500">
            <span>
              {statsError
                ? "Couldn't load task stats"
                : (taskStats?.overdue ?? 0) > 0
                  ? 'Requires attention'
                  : 'Nothing overdue'}
            </span>
          </div>
        </div>
      </div>

      {/* Projects Section */}
      <div className="opacity-0 animate-fade-in stagger-4">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-display font-semibold text-neutral-900">Projects</h2>
          {currentWorkspace && (
            <Link
              to="/projects/new"
              className="btn btn-primary"
            >
              <Plus className="w-4 h-4 mr-2" />
              New Project
            </Link>
          )}
        </div>

        {!currentWorkspace ? (
          <div className="card p-16 text-center opacity-0 animate-scale-in stagger-5">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-neutral-100 flex items-center justify-center">
              <FolderKanban className="w-8 h-8 text-neutral-400" />
            </div>
            <h3 className="text-xl font-display font-semibold text-neutral-900 mb-2">No workspace selected</h3>
            <p className="text-neutral-500 mb-8 max-w-sm mx-auto">
              Create or join a workspace to start organizing your projects and tasks
            </p>
            <Link to="/settings/workspaces/new" className="btn btn-primary inline-flex">
              <Plus className="w-4 h-4 mr-2" />
              Create Workspace
            </Link>
          </div>
        ) : projects.length === 0 ? (
          <div className="card p-16 text-center opacity-0 animate-scale-in stagger-5">
            <div className="w-16 h-16 mx-auto mb-6 rounded-2xl bg-neutral-100 flex items-center justify-center">
              <FolderKanban className="w-8 h-8 text-neutral-400" />
            </div>
            <h3 className="text-xl font-display font-semibold text-neutral-900 mb-2">No projects yet</h3>
            <p className="text-neutral-500 mb-8 max-w-sm mx-auto">
              Create your first project to start organizing and tracking tasks
            </p>
            <Link to="/projects/new" className="btn btn-primary inline-flex">
              <Plus className="w-4 h-4 mr-2" />
              Create Project
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {projects.map((project, index) => (
              <Link
                key={project.id}
                to={`/project/${project.id}`}
                className={clsx(
                  'card card-hover p-6 group opacity-0 animate-slide-up',
                  `stagger-${Math.min(index + 1, 6)}`
                )}
              >
                <div className="flex items-start justify-between mb-4">
                  <span className="text-xs font-semibold text-neutral-500 bg-neutral-100 px-2.5 py-1 rounded-lg">
                    {project.identifier}
                  </span>
                  <ArrowRight className="w-5 h-5 text-neutral-400 opacity-0 -translate-x-2 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-200" />
                </div>
                <h3 className="text-lg font-display font-semibold text-neutral-900 mb-1 group-hover:text-primary-600 transition-colors">
                  {project.name}
                </h3>
                {project.description && (
                  <p className="text-sm text-neutral-500 line-clamp-2 mb-4">
                    {project.description}
                  </p>
                )}
                <div className="flex items-center pt-4 border-t border-neutral-100">
                  <div className="flex -space-x-2">
                    <div className="w-7 h-7 rounded-full bg-gradient-to-br from-primary-400 to-primary-500 ring-2 ring-white flex items-center justify-center">
                      <span className="text-[10px] font-semibold text-white">
                        {user?.name?.[0] || user?.email?.[0]?.toUpperCase() || '?'}
                      </span>
                    </div>
                  </div>
                  <span className="ml-auto text-sm text-neutral-500">
                    {project.taskCount ?? 0} {project.taskCount === 1 ? 'task' : 'tasks'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Activity Section */}
      <div className="opacity-0 animate-fade-in stagger-5">
        <div className="card overflow-hidden bg-gradient-to-b from-white to-neutral-50/70">
          <div className="px-6 py-5 border-b border-neutral-200/80 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-neutral-100 flex items-center justify-center">
                <History className="w-5 h-5 text-neutral-700" />
              </div>
              <div>
                <h2 className="text-xl font-display font-semibold text-neutral-900">Recent activity</h2>
                <p className="text-sm text-neutral-500">Latest actions across this workspace</p>
              </div>
            </div>
          </div>

          {!currentWorkspace ? (
            <div className="px-6 py-10 text-sm text-neutral-500">Select a workspace to view activity.</div>
          ) : activityLoading ? (
            <div className="divide-y divide-neutral-200/70">
              {Array.from({ length: 6 }).map((_, index) => (
                <div key={index} className="px-6 py-4 animate-pulse">
                  <div className="h-4 bg-neutral-200 rounded w-3/4 mb-2" />
                  <div className="h-3 bg-neutral-100 rounded w-1/3" />
                </div>
              ))}
            </div>
          ) : activityError ? (
            <div className="px-6 py-10 text-sm text-red-600">Couldn&apos;t load activity right now.</div>
          ) : activities.length === 0 ? (
            <div className="px-6 py-10 text-sm text-neutral-500">No activity yet in this workspace.</div>
          ) : (
            <>
              <div className="divide-y divide-neutral-200/70">
                {activities.map((activity) => {
                  const presentation = getActivityPresentation(activity.eventType);
                  const Icon = presentation.icon;
                  return (
                    <Link
                      key={activity.id}
                      to={`/task/${activity.task.id}`}
                      className="px-6 py-4 flex items-start gap-3 hover:bg-white/80 transition-colors"
                    >
                      <div className={clsx('w-9 h-9 rounded-xl flex items-center justify-center shrink-0', presentation.bgClass)}>
                        <Icon className={clsx('w-4 h-4', presentation.iconClass)} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm text-neutral-700">
                          <span className="font-medium text-neutral-900">{activityText(activity)}</span>{' '}
                          <span className="text-neutral-600">on</span>{' '}
                          <span className="font-medium text-neutral-900">{activity.task.title}</span>
                        </p>
                        <p className="mt-1 text-xs text-neutral-500">
                          <span className="font-semibold text-neutral-600">{activity.task.project.identifier}-{activity.task.sequenceNumber}</span>
                          <span className="mx-1.5">•</span>
                          <span>{activity.task.project.name}</span>
                          <span className="mx-1.5">•</span>
                          <span>{formatRelativeTime(activity.createdAt)}</span>
                        </p>
                      </div>
                    </Link>
                  );
                })}
              </div>

              {hasNextPage && (
                <div className="px-6 py-5 border-t border-neutral-200/80 text-center">
                  <button
                    type="button"
                    onClick={() => fetchNextPage()}
                    disabled={isFetchingNextPage}
                    className="btn btn-secondary"
                  >
                    {isFetchingNextPage ? 'Loading...' : 'Load more'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
