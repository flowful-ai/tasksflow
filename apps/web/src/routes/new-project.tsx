import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { useCreateProject, useCurrentWorkspace } from '../hooks/queries';
import { EmptyState, toast } from '../components/ui';

function generateIdentifier(name: string): string {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')
    .slice(0, 4);
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const { workspace: currentWorkspace } = useCurrentWorkspace();
  const createProject = useCreateProject();
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentWorkspace || !name.trim() || !identifier.trim()) return;
    createProject.mutate(
      { workspaceId: currentWorkspace.id, name: name.trim(), identifier: identifier.trim() },
      {
        onSuccess: (project) => {
          toast.success(`Project ${project.name} created`);
          void navigate(`/project/${project.id}`);
        },
      }
    );
  };

  if (!currentWorkspace) {
    return (
      <EmptyState
        icon={<FolderKanban />}
        title="No workspace selected"
        body="Select or create a workspace before creating a project."
        action={
          <Link to="/dashboard" className="btn btn-primary">
            Go to Dashboard
          </Link>
        }
      />
    );
  }

  return (
    <div className="max-w-lg mx-auto mt-12">
      <div className="card p-6">
        <h1 className="text-lg font-semibold text-gray-900 mb-4">Create Project</h1>
        <p className="text-gray-600 mb-6">
          Create a new project in <span className="font-medium">{currentWorkspace.name}</span>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="new-project-name" className="block text-sm font-medium text-gray-700 mb-1">
              Project Name
            </label>
            <input
              id="new-project-name"
              type="text"
              className="input"
              placeholder="My Project"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setIdentifier(generateIdentifier(e.target.value));
              }}
              required
            />
          </div>

          <div>
            <label htmlFor="new-project-identifier" className="block text-sm font-medium text-gray-700 mb-1">
              Project Identifier
            </label>
            <input
              id="new-project-identifier"
              type="text"
              className="input"
              placeholder="PROJ"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
              maxLength={6}
              aria-describedby="new-project-identifier-hint"
              required
            />
            <p id="new-project-identifier-hint" className="mt-1 text-sm text-gray-500">
              Used as prefix for task IDs (e.g., {identifier || 'PROJ'}-123).
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={createProject.isPending || !name.trim() || !identifier.trim()}
            >
              {createProject.isPending ? 'Creating...' : 'Create Project'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
