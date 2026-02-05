import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useWorkspaceStore } from '../../stores/workspace';

interface ProjectSettingsData {
  id: string;
  name: string;
  identifier: string;
  description: string | null;
  icon: string | null;
  isArchived: boolean;
}

interface GeneralSettingsProps {
  project: ProjectSettingsData;
  onUpdated: () => void;
}

export function GeneralSettings({ project, onUpdated }: GeneralSettingsProps) {
  const { currentWorkspace, fetchProjects } = useWorkspaceStore();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [icon, setIcon] = useState(project.icon ?? '');
  const [isArchived, setIsArchived] = useState(project.isArchived);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? '');
    setIcon(project.icon ?? '');
    setIsArchived(project.isArchived);
  }, [project]);

  const updateMutation = useMutation({
    mutationFn: async () => {
      return api.patch(`/api/projects/${project.id}`, {
        name: name.trim(),
        description: description.trim() || null,
        icon: icon.trim() || null,
        isArchived,
      });
    },
    onSuccess: async () => {
      setError(null);
      onUpdated();
      if (currentWorkspace) {
        await fetchProjects(currentWorkspace.id);
      }
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    updateMutation.mutate();
  };

  return (
    <div className="card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-gray-900">General</h2>
        <p className="text-sm text-gray-500">Update your project details.</p>
      </div>

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
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Identifier
          </label>
          <input
            type="text"
            className="input bg-gray-50 text-gray-500"
            value={project.identifier}
            readOnly
          />
          <p className="mt-1 text-xs text-gray-500">
            Identifier cannot be changed once created.
          </p>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Description
          </label>
          <textarea
            className="input min-h-[90px]"
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Optional description"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Icon
          </label>
          <input
            type="text"
            className="input"
            value={icon}
            onChange={(event) => setIcon(event.target.value)}
            placeholder="Optional icon name or emoji"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="project-archived"
            type="checkbox"
            checked={isArchived}
            onChange={(event) => setIsArchived(event.target.checked)}
            className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="project-archived" className="text-sm text-gray-700">
            Archive project
          </label>
        </div>

        <div className="pt-2 flex gap-3">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={updateMutation.isPending || !name.trim()}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
