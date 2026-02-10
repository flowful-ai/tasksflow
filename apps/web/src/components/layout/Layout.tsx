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
} from 'lucide-react';
import { useAuthStore } from '../../stores/auth';
import { useWorkspaceStore } from '../../stores/workspace';
import { useRealtimeEvents } from '../../hooks/useRealtimeEvents';
import clsx from 'clsx';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const location = useLocation();
  const { user, logout } = useAuthStore();
  const { currentWorkspace, workspaces, projects, setCurrentWorkspace, fetchWorkspaces, fetchProjects } = useWorkspaceStore();
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);

  // Connect to real-time SSE stream for live updates
  useRealtimeEvents();

  // Fetch workspaces on mount (ensures sidebar is populated on any page)
  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  // Fetch projects when workspace changes
  useEffect(() => {
    if (currentWorkspace) {
      fetchProjects(currentWorkspace.id);
    }
  }, [currentWorkspace, fetchProjects]);

  const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: LayoutDashboard },
    { name: 'Projects', href: '/projects', icon: FolderKanban },
    { name: 'Views', href: '/views', icon: Filter },
    { name: 'Settings', href: '/settings', icon: Settings },
  ];

  return (
    <div className="min-h-screen bg-white">
      {/* Dark Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-sidebar-bg border-r border-sidebar-border transition-transform duration-300 ease-out',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-5">
          <Link to="/" className="flex items-center space-x-3 group">
            <div className="w-8 h-8 bg-white rounded-lg flex items-center justify-center transition-transform duration-200 group-hover:scale-105">
              <svg className="w-5 h-5 text-neutral-900" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-lg font-display font-bold text-white tracking-tight">TasksFlow</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1.5 rounded-lg text-sidebar-text hover:text-white hover:bg-sidebar-hover transition-colors lg:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace selector */}
        <div className="px-3 py-3">
          <div className="relative">
            <button
              onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
              className="flex items-center justify-between w-full px-3 py-2.5 text-sm font-medium text-sidebar-text rounded-xl hover:text-white hover:bg-sidebar-hover transition-all duration-200"
            >
              <div className="flex items-center space-x-2">
                <div className="w-6 h-6 rounded-md bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-xs font-bold text-white">
                  {currentWorkspace?.name?.[0]?.toUpperCase() || 'W'}
                </div>
                <span className="truncate">{currentWorkspace?.name || 'Select workspace'}</span>
              </div>
              <ChevronDown className={clsx(
                "w-4 h-4 transition-transform duration-200",
                workspaceMenuOpen && "rotate-180"
              )} />
            </button>

            {workspaceMenuOpen && (
              <div className="workspace-dropdown animate-scale-in">
                <div className="py-1">
                  {workspaces.map((workspace) => (
                    <button
                      key={workspace.id}
                      onClick={() => {
                        setCurrentWorkspace(workspace);
                        setWorkspaceMenuOpen(false);
                      }}
                      className={clsx(
                        'workspace-dropdown-item',
                        workspace.id === currentWorkspace?.id && 'active'
                      )}
                    >
                      <div className="flex items-center space-x-2">
                        <div className="w-5 h-5 rounded bg-sidebar-border flex items-center justify-center text-[10px] font-bold text-sidebar-text">
                          {workspace.name[0]?.toUpperCase()}
                        </div>
                        <span>{workspace.name}</span>
                      </div>
                    </button>
                  ))}
                </div>
                <div className="border-t border-sidebar-border">
                  <Link
                    to="/settings/workspaces/new"
                    className="flex items-center px-3 py-2.5 text-sm text-sidebar-text hover:text-white hover:bg-sidebar-active transition-colors"
                    onClick={() => setWorkspaceMenuOpen(false)}
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    New workspace
                  </Link>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-2 space-y-1 overflow-y-auto dark-scrollbar">
          {navigation.map((item, index) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                to={item.href}
                className={clsx(
                  'nav-item nav-item-dark opacity-0 animate-slide-in-left',
                  isActive && 'active'
                )}
                style={{ animationDelay: `${index * 50}ms` }}
              >
                <Icon className="w-5 h-5 mr-3" />
                {item.name}
              </Link>
            );
          })}

          {/* Projects list */}
          {currentWorkspace && projects.length > 0 && (
            <div className="pt-6">
              <div className="flex items-center justify-between px-3 mb-3">
                <span className="text-[11px] font-semibold text-sidebar-text-muted uppercase tracking-wider">Projects</span>
                <Link
                  to="/projects/new"
                  className="p-1 rounded-md text-sidebar-text-muted hover:text-white hover:bg-sidebar-hover transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </Link>
              </div>
              <div className="space-y-0.5">
                {projects.map((project, index) => {
                  const isActive = location.pathname === `/project/${project.id}`;
                  return (
                    <Link
                      key={project.id}
                      to={`/project/${project.id}`}
                      className={clsx(
                        'flex items-center px-3 py-2 text-sm rounded-lg transition-all duration-200 opacity-0 animate-slide-in-left',
                        isActive
                          ? 'text-white bg-sidebar-active'
                          : 'text-sidebar-text hover:text-white hover:bg-sidebar-hover'
                      )}
                      style={{ animationDelay: `${(navigation.length + index) * 50}ms` }}
                    >
                      <span className={clsx('project-dot mr-3', isActive && 'active')} />
                      <span className="truncate">{project.name}</span>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}
        </nav>

        {/* User menu */}
        <div className="p-3 border-t border-sidebar-border">
          <div className="flex items-center justify-between px-2 py-2">
            <div className="flex items-center min-w-0">
              {user?.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.name || user.email}
                  className="w-9 h-9 rounded-full object-cover avatar-ring"
                />
              ) : (
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center avatar-ring">
                  <span className="text-sm font-semibold text-white">
                    {user?.name?.[0] || user?.email?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
              )}
              <div className="ml-3 min-w-0">
                <p className="text-sm font-medium text-white truncate">
                  {user?.name || user?.email?.split('@')[0]}
                </p>
                <p className="text-xs text-sidebar-text-muted truncate">
                  {user?.email}
                </p>
              </div>
            </div>
            <button
              onClick={() => logout()}
              className="p-2 text-sidebar-text-muted rounded-lg hover:text-white hover:bg-sidebar-hover transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className={clsx('transition-all duration-300 ease-out', sidebarOpen ? 'lg:pl-64' : '')}>
        {/* Mobile header */}
        <header className="sticky top-0 z-40 flex items-center h-14 px-4 bg-white/80 backdrop-blur-lg border-b border-neutral-200/50 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 rounded-xl hover:bg-neutral-100 transition-colors"
          >
            <Menu className="w-5 h-5 text-neutral-700" />
          </button>
          <div className="ml-4 flex items-center space-x-2">
            <div className="w-6 h-6 bg-neutral-900 rounded-md flex items-center justify-center">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-lg font-display font-bold text-neutral-900">TasksFlow</span>
          </div>
        </header>

        {/* Page content */}
        <main className="p-6 lg:p-10">{children}</main>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden animate-fade-in"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
