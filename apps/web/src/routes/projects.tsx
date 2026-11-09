import { Link } from 'react-router-dom';
import { Plus, FolderKanban } from 'lucide-react';
import { useCurrentWorkspace, useProjects } from '../hooks/queries';
import { Button, Card, EmptyState, ErrorState, PageHeader, PageSpinner } from '../components/ui';

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
          <Button asChild>
            <Link to="/settings/workspace/new">Create Workspace</Link>
          </Button>
        }
      />
    );
  }

  if (isLoading) return <PageSpinner label="Loading projects" />;
  if (error)
    return <ErrorState error={error} resource="list of projects" onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader
        title="Projects"
        description={`All projects in ${currentWorkspace.name}`}
        actions={
          <Button asChild leadingIcon={<Plus />}>
            <Link to="/projects/new">New Project</Link>
          </Button>
        }
      />

      {projects.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<FolderKanban />}
            title="No projects yet"
            body="Create your first project to start organizing tasks."
            action={
              <Button asChild leadingIcon={<Plus />}>
                <Link to="/projects/new">Create Project</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => (
            <li key={project.id}>
              <Link
                to={`/project/${project.id}`}
                className="card block p-4 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-3">
                  <div
                    aria-hidden
                    className="w-10 h-10 rounded-lg bg-primary-100 text-primary-700 flex items-center justify-center font-semibold text-sm"
                  >
                    {project.identifier}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-medium text-neutral-900 truncate">{project.name}</h2>
                    <p className="text-sm text-neutral-500 mt-1">
                      {project.identifier} · {project.taskCount} task
                      {project.taskCount === 1 ? '' : 's'}
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
