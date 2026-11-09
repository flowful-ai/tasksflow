import { Link } from 'react-router-dom';
import { Plus, FolderKanban } from 'lucide-react';
import { useCurrentWorkspace, useProjects } from '../hooks/queries';
import { EmptyState, ErrorState, PageSpinner } from '../components/ui';

export function ProjectsPage() {
  const { workspace: currentWorkspace, workspaceId } = useCurrentWorkspace();
  const { data: projects = [], isLoading, error, refetch } = useProjects(workspaceId);

  if (!currentWorkspace) {
    return (
      <EmptyState
        icon={<FolderKanban />}
        title="No workspace selected"
        body="Select or create a workspace to view projects."
        action={
          <Link to="/settings/workspace/new" className="btn btn-primary">
            Create Workspace
          </Link>
        }
      />
    );
  }

  if (isLoading) return <PageSpinner label="Loading projects" />;
  if (error) return <ErrorState error={error} resource="list of projects" onRetry={() => void refetch()} />;

  return (
    <div>
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Projects</h1>
          <p className="text-gray-600 mt-1">All projects in {currentWorkspace.name}</p>
        </div>
        <Link to="/projects/new" className="btn btn-primary inline-flex items-center">
          <Plus aria-hidden className="w-4 h-4 mr-2" />
          New Project
        </Link>
      </header>

      {projects.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<FolderKanban />}
            title="No projects yet"
            body="Create your first project to start organizing tasks."
            action={
              <Link to="/projects/new" className="btn btn-primary inline-flex items-center">
                <Plus aria-hidden className="w-4 h-4 mr-2" />
                Create Project
              </Link>
            }
          />
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link to={`/project/${project.id}`} className="card block p-4 hover:shadow-md transition-shadow">
                <div className="flex items-start gap-3">
                  <div
                    aria-hidden
                    className="w-10 h-10 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center font-semibold text-sm"
                  >
                    {project.identifier}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-medium text-gray-900 truncate">{project.name}</h2>
                    <p className="text-sm text-gray-500 mt-1">
                      {project.identifier} · {project.taskCount} task{project.taskCount === 1 ? '' : 's'}
                    </p>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
