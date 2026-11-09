import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateWorkspace } from '../../hooks/queries';
import { toast } from '../ui';

function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function NewWorkspaceSettings() {
  const navigate = useNavigate();
  const createWorkspace = useCreateWorkspace();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !slug.trim()) return;
    createWorkspace.mutate(
      { name: name.trim(), slug: slug.trim() },
      {
        onSuccess: (workspace) => {
          toast.success(`Workspace ${workspace.name} created`);
          navigate('/dashboard');
        },
      }
    );
  };

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Workspace</h2>
      <p className="text-gray-600 mb-6">Create a new workspace to organize your projects and tasks.</p>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="workspace-name" className="block text-sm font-medium text-gray-700 mb-1">
            Workspace Name
          </label>
          <input
            id="workspace-name"
            type="text"
            className="input"
            placeholder="My Workspace"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSlug(generateSlug(e.target.value));
            }}
            required
          />
        </div>

        <div>
          <label htmlFor="workspace-slug" className="block text-sm font-medium text-gray-700 mb-1">
            Workspace URL
          </label>
          <div className="flex items-center">
            <span aria-hidden className="text-gray-500 text-sm mr-1">
              tasksflow.app/
            </span>
            <input
              id="workspace-slug"
              type="text"
              className="input flex-1"
              placeholder="my-workspace"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              aria-describedby="workspace-slug-hint"
              required
            />
          </div>
          <p id="workspace-slug-hint" className="mt-1 text-sm text-gray-500">
            Lowercase letters, numbers and hyphens. This is your workspace&apos;s unique identifier.
          </p>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={createWorkspace.isPending || !name.trim() || !slug.trim()}
          >
            {createWorkspace.isPending ? 'Creating...' : 'Create Workspace'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={() => navigate(-1)}>
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
