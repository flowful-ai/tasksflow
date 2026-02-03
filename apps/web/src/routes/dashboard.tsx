import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { FolderKanban, Plus, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace';

export function DashboardPage() {
  const { currentWorkspace, projects, fetchWorkspaces, fetchProjects } = useWorkspaceStore();

  useEffect(() => {
    fetchWorkspaces();
  }, [fetchWorkspaces]);

  useEffect(() => {
    if (currentWorkspace) {
      fetchProjects(currentWorkspace.id);
    }
  }, [currentWorkspace, fetchProjects]);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-gray-600 mt-1">
            Welcome to {currentWorkspace?.name || 'FlowTask'}
          </p>
        </div>
{currentWorkspace && (
          <Link to="/projects/new" className="btn btn-primary">
            <Plus className="w-4 h-4 mr-2" />
            New Project
          </Link>
        )}
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="card p-6">
          <div className="flex items-center">
            <div className="p-3 bg-green-100 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Completed</p>
              <p className="text-2xl font-semibold text-gray-900">0</p>
            </div>
          </div>
        </div>
        <div className="card p-6">
          <div className="flex items-center">
            <div className="p-3 bg-blue-100 rounded-lg">
              <Clock className="w-6 h-6 text-blue-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">In Progress</p>
              <p className="text-2xl font-semibold text-gray-900">0</p>
            </div>
          </div>
        </div>
        <div className="card p-6">
          <div className="flex items-center">
            <div className="p-3 bg-red-100 rounded-lg">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
            <div className="ml-4">
              <p className="text-sm font-medium text-gray-600">Overdue</p>
              <p className="text-2xl font-semibold text-gray-900">0</p>
            </div>
          </div>
        </div>
      </div>

      {/* Projects */}
      <div>
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Projects</h2>
        {!currentWorkspace ? (
          <div className="card p-12 text-center">
            <FolderKanban className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No workspace selected</h3>
            <p className="text-gray-600 mb-6">
              Create or join a workspace first to start managing projects
            </p>
            <Link to="/settings/workspaces/new" className="btn btn-primary inline-flex">
              <Plus className="w-4 h-4 mr-2" />
              Create Workspace
            </Link>
          </div>
        ) : projects.length === 0 ? (
          <div className="card p-12 text-center">
            <FolderKanban className="w-12 h-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
            <p className="text-gray-600 mb-6">
              Create your first project to start organizing tasks
            </p>
            <Link to="/projects/new" className="btn btn-primary inline-flex">
              <Plus className="w-4 h-4 mr-2" />
              Create Project
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {projects.map((project) => (
              <Link
                key={project.id}
                to={`/project/${project.id}`}
                className="card p-6 hover:border-primary-300 transition-colors"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center space-x-2">
                      <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                        {project.identifier}
                      </span>
                    </div>
                    <h3 className="text-lg font-medium text-gray-900 mt-2">
                      {project.name}
                    </h3>
                    {project.description && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {project.description}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center mt-4 text-sm text-gray-500">
                  <span>0 tasks</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
