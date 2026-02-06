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
    <div className="min-h-screen bg-gray-50">
      {/* Sidebar */}
      <aside
        className={clsx(
          'fixed inset-y-0 left-0 z-50 flex flex-col w-64 bg-white border-r border-gray-200 transition-transform duration-200',
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Logo */}
        <div className="flex items-center justify-between h-16 px-4 border-b border-gray-200">
          <Link to="/" className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-primary-600 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <span className="text-lg font-semibold text-gray-900">FlowTask</span>
          </Link>
          <button
            onClick={() => setSidebarOpen(false)}
            className="p-1 rounded-lg hover:bg-gray-100 lg:hidden"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Workspace selector */}
        <div className="px-3 py-2 border-b border-gray-200">
          <div className="relative">
            <button
              onClick={() => setWorkspaceMenuOpen(!workspaceMenuOpen)}
              className="flex items-center justify-between w-full px-3 py-2 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100"
            >
              <span className="truncate">{currentWorkspace?.name || 'Select workspace'}</span>
              <ChevronDown className="w-4 h-4 ml-2" />
            </button>
            {workspaceMenuOpen && (
              <div className="absolute left-0 right-0 z-10 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg">
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.id}
                    onClick={() => {
                      setCurrentWorkspace(workspace);
                      setWorkspaceMenuOpen(false);
                    }}
                    className={clsx(
                      'block w-full px-3 py-2 text-sm text-left hover:bg-gray-100',
                      workspace.id === currentWorkspace?.id && 'bg-primary-50 text-primary-600'
                    )}
                  >
                    {workspace.name}
                  </button>
                ))}
                <div className="border-t border-gray-200">
                  <Link
                    to="/settings/workspaces/new"
                    className="flex items-center px-3 py-2 text-sm text-gray-600 hover:bg-gray-100"
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
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navigation.map((item) => {
            const Icon = item.icon;
            const isActive = location.pathname.startsWith(item.href);
            return (
              <Link
                key={item.name}
                to={item.href}
                className={clsx(
                  'flex items-center px-3 py-2 text-sm font-medium rounded-lg',
                  isActive
                    ? 'bg-primary-50 text-primary-600'
                    : 'text-gray-700 hover:bg-gray-100'
                )}
              >
                <Icon className="w-5 h-5 mr-3" />
                {item.name}
              </Link>
            );
          })}

          {/* Projects list */}
          {currentWorkspace && projects.length > 0 && (
            <div className="pt-4">
              <div className="flex items-center justify-between px-3 mb-2">
                <span className="text-xs font-semibold text-gray-500 uppercase">Projects</span>
                <Link to="/projects/new" className="p-1 rounded hover:bg-gray-100">
                  <Plus className="w-4 h-4 text-gray-500" />
                </Link>
              </div>
              {projects.map((project) => (
                <Link
                  key={project.id}
                  to={`/project/${project.id}`}
                  className={clsx(
                    'flex items-center px-3 py-2 text-sm rounded-lg',
                    location.pathname === `/project/${project.id}`
                      ? 'bg-primary-50 text-primary-600'
                      : 'text-gray-700 hover:bg-gray-100'
                  )}
                >
                  <span className="truncate">{project.name}</span>
                </Link>
              ))}
            </div>
          )}
        </nav>

        {/* User menu */}
        <div className="p-3 border-t border-gray-200">
          <div className="flex items-center justify-between px-3 py-2">
            <div className="flex items-center min-w-0">
              {user?.avatarUrl ? (
                <img src={user.avatarUrl} alt={user.name || user.email} className="w-8 h-8 rounded-full object-cover" />
              ) : (
                <div className="w-8 h-8 rounded-full bg-primary-100 flex items-center justify-center">
                  <span className="text-sm font-medium text-primary-600">
                    {user?.name?.[0] || user?.email?.[0]?.toUpperCase() || '?'}
                  </span>
                </div>
              )}
              <div className="ml-3 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user?.name || user?.email}
                </p>
              </div>
            </div>
            <button
              onClick={() => logout()}
              className="p-2 text-gray-500 rounded-lg hover:bg-gray-100"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main content */}
      <div className={clsx('transition-all duration-200', sidebarOpen ? 'lg:pl-64' : '')}>
        {/* Mobile header */}
        <header className="sticky top-0 z-40 flex items-center h-16 px-4 bg-white border-b border-gray-200 lg:hidden">
          <button
            onClick={() => setSidebarOpen(true)}
            className="p-2 -ml-2 rounded-lg hover:bg-gray-100"
          >
            <Menu className="w-5 h-5" />
          </button>
          <span className="ml-4 text-lg font-semibold">FlowTask</span>
        </header>

        {/* Page content */}
        <main className="p-4 lg:p-8">{children}</main>
      </div>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
    </div>
  );
}
