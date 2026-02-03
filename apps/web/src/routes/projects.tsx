import { Link } from 'react-router-dom';
import { Plus, FolderKanban } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace';

export function ProjectsPage() {
  const { currentWorkspace, projects, isLoading } = useWorkspaceStore();

  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <FolderKanban className="w-12 h-12 text-gray-300 mb-4" />
        <h2 className="text-lg font-medium text-gray-900 mb-2">No Workspace Selected</h2>
        <p className="text-gray-600 mb-4">Select or create a workspace to view projects.</p>
        <Link to="/settings/workspaces/new" className="btn btn-primary">
          Create Workspace
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-gray-600 mt-1">
            All projects in {currentWorkspace.name}
          </p>
        </div>
        <Link to="/projects/new" className="btn btn-primary inline-flex items-center">
          <Plus className="w-4 h-4 mr-2" />
          New Project
        </Link>
      </div>

      {projects.length === 0 ? (
        <div className="card p-12 text-center">
          <FolderKanban className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No projects yet</h3>
          <p className="text-gray-600 mb-4">
            Create your first project to start organizing tasks.
          </p>
          <Link to="/projects/new" className="btn btn-primary inline-flex items-center">
            <Plus className="w-4 h-4 mr-2" />
            Create Project
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <Link
              key={project.id}
              to={`/project/${project.id}`}
              className="card p-4 hover:shadow-md transition-shadow"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center font-semibold text-sm">
                  {project.identifier}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-gray-900 truncate">{project.name}</h3>
                  <p className="text-sm text-gray-500 mt-1">
                    {project.identifier}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
