import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useWorkspaceStore } from '../stores/workspace';

export function NewProjectPage() {
  const navigate = useNavigate();
  const { currentWorkspace, createProject } = useWorkspaceStore();
  const [name, setName] = useState('');
  const [identifier, setIdentifier] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generateIdentifier = (name: string) => {
    return name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '')
      .slice(0, 4);
  };

  const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newName = e.target.value;
    setName(newName);
    setIdentifier(generateIdentifier(newName));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !identifier.trim()) return;

    setIsSubmitting(true);
    setError(null);

    try {
      const project = await createProject(name.trim(), identifier.trim());
      navigate(`/project/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
      setIsSubmitting(false);
    }
  };

  if (!currentWorkspace) {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <div className="card p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">No Workspace Selected</h2>
          <p className="text-gray-600 mb-4">
            Please select or create a workspace before creating a project.
          </p>
          <button
            onClick={() => navigate('/dashboard')}
            className="btn btn-primary"
          >
            Go to Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto mt-12">
      <div className="card p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Create Project</h2>
        <p className="text-gray-600 mb-6">
          Create a new project in <span className="font-medium">{currentWorkspace.name}</span>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Name
            </label>
            <input
              type="text"
              className="input"
              placeholder="My Project"
              value={name}
              onChange={handleNameChange}
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Identifier
            </label>
            <input
              type="text"
              className="input"
              placeholder="PROJ"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
              maxLength={6}
              required
            />
            <p className="mt-1 text-sm text-gray-500">
              Used as prefix for task IDs (e.g., {identifier || 'PROJ'}-123).
            </p>
          </div>

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              className="btn btn-primary"
              disabled={isSubmitting || !name.trim() || !identifier.trim()}
            >
              {isSubmitting ? 'Creating...' : 'Create Project'}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate(-1)}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
