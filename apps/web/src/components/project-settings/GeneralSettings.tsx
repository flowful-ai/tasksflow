import { useEffect, useState } from 'react';
import type { ProjectDetailDto } from '../../api/types';
import { useUpdateProject } from '../../hooks/queries';
import { toast } from '../ui';

interface GeneralSettingsProps {
  project: Pick<
    ProjectDetailDto,
    'id' | 'name' | 'identifier' | 'description' | 'icon' | 'isArchived'
  >;
}

export function GeneralSettings({ project }: GeneralSettingsProps) {
  const updateProject = useUpdateProject(project.id);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description ?? '');
  const [icon, setIcon] = useState(project.icon ?? '');
  const [isArchived, setIsArchived] = useState(project.isArchived);

  useEffect(() => {
    setName(project.name);
    setDescription(project.description ?? '');
    setIcon(project.icon ?? '');
    setIsArchived(project.isArchived);
  }, [project]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    updateProject.mutate(
      // Empty strings clear the optional fields (the API rejects null here).
      { name: name.trim(), description: description.trim(), icon: icon.trim(), isArchived },
      { onSuccess: () => toast.success('Project saved') }
    );
  };

  return (
    <div className="card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-neutral-900">General</h2>
        <p className="text-sm text-neutral-500">Update your project details.</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="project-name" className="block text-sm font-medium text-neutral-700 mb-1">
            Project Name
          </label>
          <input
            id="project-name"
            type="text"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>

        <div>
          <label
            htmlFor="project-identifier"
            className="block text-sm font-medium text-neutral-700 mb-1"
          >
            Identifier
          </label>
          <input
            id="project-identifier"
            type="text"
            className="input bg-neutral-50 text-neutral-500"
            value={project.identifier}
            readOnly
            aria-describedby="project-identifier-hint"
          />
          <p id="project-identifier-hint" className="mt-1 text-xs text-neutral-500">
            Identifier cannot be changed once created.
          </p>
        </div>

        <div>
          <label
            htmlFor="project-description"
            className="block text-sm font-medium text-neutral-700 mb-1"
          >
            Description
          </label>
          <textarea
            id="project-description"
            className="input min-h-[90px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </div>

        <div>
          <label htmlFor="project-icon" className="block text-sm font-medium text-neutral-700 mb-1">
            Icon
          </label>
          <input
            id="project-icon"
            type="text"
            className="input"
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="Optional icon name or emoji"
          />
        </div>

        <div className="flex items-center gap-2">
          <input
            id="project-archived"
            type="checkbox"
            checked={isArchived}
            onChange={(e) => setIsArchived(e.target.checked)}
            className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
          />
          <label htmlFor="project-archived" className="text-sm text-neutral-700">
            Archive project
          </label>
        </div>

        <div className="pt-2 flex gap-3">
          <button
            type="submit"
            className="btn btn-primary"
            disabled={updateProject.isPending || !name.trim()}
          >
            {updateProject.isPending ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </form>
    </div>
  );
}
