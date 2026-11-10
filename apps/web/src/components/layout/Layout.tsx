import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  Plus,
  LogOut,
  Menu,
  X,
  Lock,
  ShieldAlert,
  Check,
  Search,
  Inbox,
  Target,
  Zap,
  LayoutDashboard,
  Settings,
  MoreHorizontal,
  Trash2,
  Keyboard,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/auth';
import { useUiStore } from '../../stores/ui';
import { useCurrentWorkspace, useProjects, useUnreadNotificationCount } from '../../hooks/queries';
import { useRealtimeEvents } from '../../hooks/useRealtimeEvents';
import { modKeyLabel } from '../../lib/hotkeys';
import { avatarUrlOf } from '../../lib/account';
import { AgentChatLauncher } from '../chat/AgentChatLauncher';
import { ReconnectingBanner } from '../realtime/ConnectionStatus';
import { GlobalLayers } from '../command/GlobalLayers';
import { NoWorkspaceState } from './NoWorkspaceState';
import { ErrorState } from '../ui/ErrorState';
import { projectColor } from '../../lib/color';
import {
  Avatar,
  ColorDot,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Kbd,
  Tooltip,
} from '../ui';

interface LayoutProps {
  children: React.ReactNode;
}

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia('(min-width: 1024px)').matches
  );
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

const navItemClass = (active: boolean) =>
  clsx(
    'group flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-sm font-medium transition-colors',
    active
      ? 'bg-sidebar-active text-white'
      : 'text-sidebar-text hover:bg-sidebar-hover hover:text-white'
  );

function SidebarLink({
  to,
  icon,
  label,
  active,
  badge,
  shortcut,
}: {
  to: string;
  icon: React.ReactNode;
  label: string;
  active: boolean;
  badge?: number;
  shortcut?: string;
}) {
  const badgeText = badge && badge > 99 ? '99+' : badge;
  return (
    <Link
      to={to}
      aria-current={active ? 'page' : undefined}
      aria-label={badge ? `${label}, ${badge} unread` : undefined}
      aria-keyshortcuts={shortcut}
      className={navItemClass(active)}
    >
      <span
        aria-hidden
        className={clsx(
          '[&_svg]:h-4 [&_svg]:w-4',
          active ? 'text-primary-400' : 'text-sidebar-text-muted group-hover:text-white'
        )}
      >
        {icon}
      </span>
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span
          aria-hidden
          className="min-w-[20px] rounded-full bg-primary-500 px-1.5 py-px text-center text-[11px] font-semibold tabular-nums text-white"
        >
          {badgeText}
        </span>
      ) : null}
    </Link>
  );
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const avatarUrl = avatarUrlOf(user);
  const logout = useAuthStore((s) => s.logout);
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const {
    workspace: currentWorkspace,
    workspaces,
    workspaceId,
    setWorkspaceId,
    isLoading: workspacesLoading,
    error: workspacesError,
  } = useCurrentWorkspace();
  // Settings (profile, create workspace, app admin) works without a workspace;
  // every other page needs one and would otherwise wait for it forever.
  const needsWorkspace = !location.pathname.startsWith('/settings');
  const noWorkspace =
    needsWorkspace && !workspacesLoading && !workspacesError && workspaces.length === 0;
  const { data: projects = [] } = useProjects(workspaceId);
  const { data: unread = 0 } = useUnreadNotificationCount(workspaceId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isDesktop = useIsDesktop();

  // One real-time SSE stream for the current workspace.
  useRealtimeEvents(workspaceId);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const showSidebar = isDesktop || sidebarOpen;
  const path = location.pathname;
  const isActive = (prefix: string) => path === prefix || path.startsWith(`${prefix}/`);

  return (
    <div className="min-h-screen bg-white">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-70 focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg"
      >
        Skip to content
      </a>

      {/* Dark Sidebar */}
      <aside
        aria-label="Sidebar"
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-sidebar-border bg-sidebar-bg transition-transform duration-300 ease-out',
          showSidebar ? 'translate-x-0' : '-translate-x-full'
        )}
        {...(!showSidebar ? { inert: '' } : {})}
      >
        {/* Workspace switcher */}
        <div className="flex items-center gap-1 px-3 pb-2 pt-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="group flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 text-sm font-semibold text-white transition-colors hover:bg-sidebar-hover data-[state=open]:bg-sidebar-hover"
                aria-label={`Workspace: ${currentWorkspace?.name ?? 'none selected'}. Switch workspace`}
              >
                <span
                  aria-hidden
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-linear-to-br from-primary-500 to-primary-600 text-xs font-bold text-white"
                >
                  {currentWorkspace?.name?.[0]?.toUpperCase() || 'W'}
                </span>
                <span className="truncate">{currentWorkspace?.name || 'Select workspace'}</span>
                <ChevronDown
                  aria-hidden
                  className="ml-auto h-4 w-4 text-sidebar-text-muted transition-transform duration-200 group-data-[state=open]:rotate-180"
                />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              tone="dark"
              align="start"
              className="w-(--radix-dropdown-menu-trigger-width)"
            >
              {workspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  tone="dark"
                  onSelect={() => setWorkspaceId(workspace.id)}
                  icon={
                    <span className="flex h-5 w-5 items-center justify-center rounded-sm bg-sidebar-border text-[10px] font-bold text-sidebar-text">
                      {workspace.name[0]?.toUpperCase()}
                    </span>
                  }
                >
                  <span className="flex items-center justify-between gap-2">
                    {workspace.name}
                    {workspace.id === currentWorkspace?.id && (
                      <Check className="h-4 w-4" aria-label="Current" />
                    )}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator tone="dark" />
              <DropdownMenuItem tone="dark" icon={<Plus />} asChild>
                <Link to="/settings/workspaces/new">New workspace</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <IconButton
            label="Close sidebar"
            variant="sidebar"
            icon={<X />}
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden"
          />
        </div>

        {/* Search / ⌘K */}
        <div className="px-3 pb-2">
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-keyshortcuts="Meta+K Control+K"
            className="flex w-full items-center gap-2 rounded-lg border border-sidebar-border bg-sidebar-hover/60 px-2.5 py-[7px] text-left text-sm text-sidebar-text-muted transition-colors hover:border-neutral-700 hover:text-sidebar-text"
          >
            <Search aria-hidden className="h-4 w-4" />
            <span className="flex-1 truncate">Search or jump to…</span>
            <Kbd tone="dark" aria-hidden>
              {modKeyLabel() === '⌘' ? '⌘K' : 'Ctrl K'}
            </Kbd>
          </button>
        </div>

        <nav
          aria-label="Main"
          className="dark-scrollbar flex-1 space-y-0.5 overflow-y-auto px-3 py-1"
        >
          <SidebarLink
            to="/inbox"
            icon={<Inbox />}
            label="Inbox"
            active={isActive('/inbox')}
            badge={unread}
            shortcut="G I"
          />
          <SidebarLink
            to="/my-tasks"
            icon={<Target />}
            label="My tasks"
            active={isActive('/my-tasks')}
            shortcut="G M"
          />
          <SidebarLink
            to="/views"
            icon={<Zap />}
            label="Views"
            active={isActive('/views') || isActive('/view')}
            shortcut="G V"
          />
          <SidebarLink
            to="/dashboard"
            icon={<LayoutDashboard />}
            label="Dashboard"
            active={isActive('/dashboard')}
          />

          {/* Projects list */}
          {currentWorkspace && (
            <div className="pt-5">
              <div className="mb-1 flex items-center justify-between px-2.5">
                <h2
                  id="sidebar-projects"
                  className="text-[11px] font-semibold uppercase tracking-wider text-sidebar-text-muted"
                >
                  <Link
                    to="/projects"
                    className="hover:text-white"
                    aria-current={path === '/projects' ? 'page' : undefined}
                  >
                    Projects
                  </Link>
                </h2>
                <Tooltip content="New project">
                  <Link
                    to="/projects/new"
                    aria-label="New project"
                    className="rounded-md p-1 text-sidebar-text-muted transition-colors hover:bg-sidebar-hover hover:text-white"
                  >
                    <Plus aria-hidden className="h-4 w-4" />
                  </Link>
                </Tooltip>
              </div>
              {projects.length === 0 ? (
                <p className="px-2.5 py-1 text-xs text-sidebar-text-muted">No projects yet</p>
              ) : (
                <ul aria-labelledby="sidebar-projects" className="space-y-0.5">
                  {projects.map((project) => {
                    const active = isActive(`/project/${project.id}`);
                    const exact = path === `/project/${project.id}`;
                    return (
                      <li key={project.id} className="group/project relative">
                        <Link
                          to={`/project/${project.id}`}
                          aria-current={exact ? 'page' : undefined}
                          className={clsx(navItemClass(active), 'pr-8 font-normal')}
                        >
                          <ColorDot
                            color={projectColor(project.id)}
                            size="md"
                            className="mx-[3px]"
                          />
                          <span className="flex-1 truncate">{project.name}</span>
                          {project.access === 'admin' && (
                            <ShieldAlert
                              className="h-3.5 w-3.5 shrink-0 text-sidebar-text-muted"
                              aria-label="Admin only"
                            />
                          )}
                          {project.access === 'members' && (
                            <Lock
                              className="h-3.5 w-3.5 shrink-0 text-sidebar-text-muted"
                              aria-label="Restricted access"
                            />
                          )}
                        </Link>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type="button"
                              aria-label={`${project.name} actions`}
                              className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-sidebar-text-muted opacity-0 transition-opacity hover:bg-sidebar-border hover:text-white focus-visible:opacity-100 group-hover/project:opacity-100 data-[state=open]:opacity-100"
                            >
                              <MoreHorizontal aria-hidden className="h-4 w-4" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent tone="dark" align="start" side="right">
                            <DropdownMenuItem tone="dark" icon={<Settings />} asChild>
                              <Link to={`/project/${project.id}/settings`}>Project settings</Link>
                            </DropdownMenuItem>
                            <DropdownMenuItem tone="dark" icon={<Trash2 />} asChild>
                              <Link to={`/project/${project.id}/trash`}>Trash</Link>
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          )}
        </nav>

        {/* User menu */}
        <div className="border-t border-sidebar-border p-3">
          <div className="flex items-center gap-1 px-1 py-1">
            <Avatar
              src={avatarUrl}
              name={user?.name}
              email={user?.email}
              tone="brand"
              size="lg"
              className="avatar-ring"
            />
            <div className="ml-2 min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">
                {user?.name || user?.email?.split('@')[0]}
              </p>
              <p className="truncate text-xs text-sidebar-text-muted">{user?.email}</p>
            </div>
            <IconButton
              label="Keyboard shortcuts"
              shortcut="?"
              variant="sidebar"
              icon={<Keyboard />}
              onClick={() => setShortcutsOpen(true)}
            />
            <Link
              to="/settings"
              aria-label="Settings"
              aria-current={isActive('/settings') ? 'page' : undefined}
              aria-keyshortcuts="G S"
              className={clsx(
                'rounded-lg p-1.5 transition-colors hover:bg-sidebar-hover hover:text-white [&_svg]:h-4 [&_svg]:w-4',
                isActive('/settings') ? 'text-white' : 'text-sidebar-text-muted'
              )}
            >
              <Settings aria-hidden />
            </Link>
            <IconButton
              label="Log out"
              variant="sidebar"
              icon={<LogOut />}
              onClick={() => void logout()}
            />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="transition-all duration-300 ease-out lg:pl-64">
        {/* Mobile header */}
        <header className="sticky top-0 z-40 flex h-14 items-center border-b border-neutral-200/50 bg-white/80 px-4 backdrop-blur-lg lg:hidden">
          <IconButton
            label="Open sidebar"
            size="md"
            icon={<Menu />}
            onClick={() => setSidebarOpen(true)}
            className="-ml-2"
            aria-expanded={sidebarOpen}
          />
          <div className="ml-3 flex items-center space-x-2">
            <div
              aria-hidden
              className="flex h-6 w-6 items-center justify-center rounded-md bg-neutral-900"
            >
              <svg
                className="h-4 w-4 text-white"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="font-display text-lg font-bold text-neutral-900">TasksFlow</span>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <IconButton
              label="Search"
              size="md"
              icon={<Search />}
              onClick={() => setPaletteOpen(true)}
            />
            <Link
              to="/inbox"
              aria-label={unread ? `Inbox, ${unread} unread` : 'Inbox'}
              className="relative rounded-lg p-2 text-neutral-500 hover:bg-neutral-100 [&_svg]:h-5 [&_svg]:w-5"
            >
              <Inbox aria-hidden />
              {unread > 0 && (
                <span
                  aria-hidden
                  className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-primary-500"
                />
              )}
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main id="main" tabIndex={-1} className="p-3 focus:outline-hidden sm:p-6 lg:p-10">
          <ReconnectingBanner className="mb-4" />
          {noWorkspace ? (
            <NoWorkspaceState email={user?.email} onSignOut={() => void logout()} />
          ) : needsWorkspace && workspacesError && workspaces.length === 0 ? (
            <ErrorState
              error={workspacesError}
              resource="workspaces"
              onRetry={() => window.location.reload()}
            />
          ) : (
            children
          )}
        </main>
      </div>

      {/* Mobile sidebar overlay */}
      {!isDesktop && sidebarOpen && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-xs animate-fade-in lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <GlobalLayers />
      <AgentChatLauncher workspaceId={workspaceId} />
    </div>
  );
}
