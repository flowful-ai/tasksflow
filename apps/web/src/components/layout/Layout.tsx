import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderKanban,
  Filter,
  Settings,
  ChevronDown,
  Plus,
  LogOut,
  Menu,
  X,
  Lock,
  ShieldAlert,
  Check,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuthStore } from '../../stores/auth';
import { useCurrentWorkspace, useProjects } from '../../hooks/queries';
import { useRealtimeEvents } from '../../hooks/useRealtimeEvents';
import { AgentChatLauncher } from '../chat/AgentChatLauncher';
import { ReconnectingBanner } from '../realtime/ConnectionStatus';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  Tooltip,
} from '../ui';

interface LayoutProps {
  children: React.ReactNode;
}

const NAVIGATION = [
  { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
  { name: 'Projects', href: '/projects', icon: FolderKanban },
  { name: 'Views', href: '/views', icon: Filter },
  { name: 'Settings', href: '/settings', icon: Settings },
] as const;

function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 1024px)');
    const onChange = (event: MediaQueryListEvent) => setIsDesktop(event.matches);
    setIsDesktop(mediaQuery.matches);
    mediaQuery.addEventListener('change', onChange);
    return () => mediaQuery.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { workspace: currentWorkspace, workspaces, workspaceId, setWorkspaceId } = useCurrentWorkspace();
  const { data: projects = [] } = useProjects(workspaceId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const isDesktop = useIsDesktop();

  // One real-time SSE stream for the current workspace.
  useRealtimeEvents(workspaceId);

  // Close the mobile drawer on navigation.
  useEffect(() => {
    setSidebarOpen(false);
  }, [location.pathname]);

  const showSidebar = isDesktop || sidebarOpen;

  return (
    <div className="min-h-screen bg-white">
      {/* Dark Sidebar */}
      <aside
        aria-label="Sidebar"
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-sidebar-bg border-r border-sidebar-border transition-transform duration-300 ease-out',
          showSidebar ? 'translate-x-0' : '-translate-x-full'
        )}
        {...(!showSidebar ? { inert: '' } : {})}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-5">
          <Link to="/" className="flex items-center space-x-3 group" aria-label="TasksFlow home">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center transition-transform duration-200 group-hover:scale-105">
              <svg aria-hidden className="w-5 h-5 text-neutral-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-lg font-display font-bold text-white tracking-tight">TasksFlow</span>
          </Link>
          <IconButton
            label="Close sidebar"
            variant="sidebar"
            icon={<X />}
            onClick={() => setSidebarOpen(false)}
            className="lg:hidden"
          />
        </div>

        {/* Workspace selector */}
        <div className="px-3 py-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="group flex items-center justify-between w-full px-3 py-2.5 text-sm font-medium text-sidebar-text rounded-xl hover:text-white hover:bg-sidebar-hover data-[state=open]:bg-sidebar-hover data-[state=open]:text-white transition-all duration-200"
                aria-label={`Workspace: ${currentWorkspace?.name ?? 'none selected'}. Switch workspace`}
              >
                <div className="flex items-center space-x-2 min-w-0">
                  <div aria-hidden className="w-6 h-6 shrink-0 rounded-md bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-xs font-bold text-white">
                    {currentWorkspace?.name?.[0]?.toUpperCase() || 'W'}
                  </div>
                  <span className="truncate">{currentWorkspace?.name || 'Select workspace'}</span>
                </div>
                <ChevronDown aria-hidden className="w-4 h-4 transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent tone="dark" align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
              {workspaces.map((workspace) => (
                <DropdownMenuItem
                  key={workspace.id}
                  tone="dark"
                  onSelect={() => setWorkspaceId(workspace.id)}
                  icon={
                    <span className="w-5 h-5 rounded bg-sidebar-border flex items-center justify-center text-[10px] font-bold text-sidebar-text">
                      {workspace.name[0]?.toUpperCase()}
                    </span>
                  }
                >
                  <span className="flex items-center justify-between gap-2">
                    {workspace.name}
                    {workspace.id === currentWorkspace?.id && <Check className="h-4 w-4" aria-label="Current" />}
                  </span>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator tone="dark" />
              <DropdownMenuItem tone="dark" icon={<Plus />} asChild>
                <Link to="/settings/workspaces/new">New workspace</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Navigation */}
        <nav aria-label="Main" className="flex-1 px-3 py-2 space-y-1 overflow-y-auto dark-scrollbar">
          {NAVIGATION.map((item, index) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                to={item.href}
                aria-current={isActive ? 'page' : undefined}
                className={clsx('nav-item nav-item-dark opacity-0 animate-slide-in-left', isActive && 'active')}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <Icon aria-hidden className="w-5 h-5 mr-3" />
                {item.name}
              </Link>
            );
          })}

          {/* Projects list */}
          {currentWorkspace && projects.length > 0 && (
            <div className="pt-6">
              <div className="flex items-center justify-between px-3 mb-3">
                <h2 id="sidebar-projects" className="text-[11px] font-semibold text-sidebar-text-muted uppercase tracking-wider">
                  Projects
                </h2>
                <Tooltip content="New project">
                  <Link
                    to="/projects/new"
                    aria-label="New project"
                    className="p-1 rounded-md text-sidebar-text-muted hover:text-white hover:bg-sidebar-hover transition-colors"
                  >
                    <Plus aria-hidden className="w-4 h-4" />
                  </Link>
                </Tooltip>
              </div>
              <ul aria-labelledby="sidebar-projects" className="space-y-0.5">
                {projects.map((project, index) => {
                  const isActive = location.pathname === `/project/${project.id}`;
                  return (
                    <li key={project.id}>
                      <Link
                        to={`/project/${project.id}`}
                        aria-current={isActive ? 'page' : undefined}
                        className={clsx(
                          'flex items-center px-3 py-2 text-sm rounded-lg transition-all duration-200 opacity-0 animate-slide-in-left',
                          isActive ? 'text-white bg-sidebar-active' : 'text-sidebar-text hover:text-white hover:bg-sidebar-hover'
                        )}
                        style={{ animationDelay: `${(NAVIGATION.length + index) * 50}ms` }}
                      >
                        <span aria-hidden className={clsx('project-dot mr-3', isActive && 'active')} />
                        <span className="truncate flex-1">{project.name}</span>
                        {project.access === 'admin' && (
                          <ShieldAlert className="w-3.5 h-3.5 ml-1.5 flex-shrink-0 text-sidebar-text-muted" aria-label="Admin only" />
                        )}
                        {project.access === 'members' && (
                          <Lock className="w-3.5 h-3.5 ml-1.5 flex-shrink-0 text-sidebar-text-muted" aria-label="Restricted access" />
                        )}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </nav>

        {/* User menu */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center justify-between px-2 py-2">
            <div className="flex items-center min-w-0">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt="" className="w-9 h-9 rounded-full object-cover avatar-ring" />
              ) : (
                <div aria-hidden className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center avatar-ring">
                  <span className="text-sm font-semibold text-white">
                    {user?.name?.[0] || user?.email?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
              )}
              <div className="ml-3 min-w-0">
                <p className="text-sm font-medium text-white truncate">{user?.name || user?.email?.split('@')[0]}</p>
                <p className="text-xs text-sidebar-text-muted truncate">{user?.email}</p>
              </div>
            </div>
            <IconButton label="Log out" variant="sidebar" icon={<LogOut />} onClick={() => void logout()} />
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className="transition-all duration-300 ease-out lg:pl-64">
        {/* Mobile header */}
        <header className="sticky top-0 z-40 flex items-center h-14 px-4 bg-white/80 backdrop-blur-lg border-b border-neutral-200/50 lg:hidden">
          <IconButton
            label="Open sidebar"
            size="md"
            icon={<Menu />}
            onClick={() => setSidebarOpen(true)}
            className="-ml-2"
            aria-expanded={sidebarOpen}
          />
          <div className="ml-4 flex items-center space-x-2">
            <div aria-hidden className="w-6 h-6 bg-neutral-900 rounded-md flex items-center justify-center">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-lg font-display font-bold text-neutral-900">TasksFlow</span>
          </div>
        </header>

        {/* Page content */}
        <main id="main" className="p-3 sm:p-6 lg:p-10">
          <ReconnectingBanner className="mb-4" />
          {children}
        </main>
      </div>

      {/* Mobile sidebar overlay */}
      {!isDesktop && sidebarOpen && (
        <div
          aria-hidden
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <AgentChatLauncher workspaceId={workspaceId} />
    </div>
  );
}
