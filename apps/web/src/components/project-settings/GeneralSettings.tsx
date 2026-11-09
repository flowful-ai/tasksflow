import { useEffect, useState } from 'react';
import type { ProjectDetailDto } from '../../api/types';
import { useUpdateProject } from '../../hooks/queries';
import { Button, Card, Checkbox, Field, Input, Textarea, toast } from '../ui';

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
    <Card title="General" description="Update your project details.">
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Project Name" id="project-name">
          <Input value={name} onChange={(e) => setName(e.target.value)} required />
        </Field>

        <Field
          label="Identifier"
          id="project-identifier"
          hint="Identifier cannot be changed once created."
        >
          <Input value={project.identifier} readOnly />
        </Field>

        <Field label="Description" id="project-description">
          <Textarea
            className="min-h-[90px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional description"
          />
        </Field>

        <Field label="Icon" id="project-icon">
          <Input
            value={icon}
            onChange={(e) => setIcon(e.target.value)}
            placeholder="Optional icon name or emoji"
          />
        </Field>

        <Checkbox
          id="project-archived"
          checked={isArchived}
          onChange={(e) => setIsArchived(e.target.checked)}
          label="Archive project"
        />

        <div className="pt-2 flex gap-3">
          <Button type="submit" loading={updateProject.isPending} disabled={!name.trim()}>
            {updateProject.isPending ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </form>
    </Card>
  );
}
