import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateWorkspace } from '../../hooks/queries';
import { Button, Card, Field, Input, toast } from '../ui';

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
          void navigate('/dashboard');
        },
      }
    );
  };

  return (
    <Card
      title="Create Workspace"
      description="Create a new workspace to organize your projects and tasks."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <Field label="Workspace Name" id="workspace-name">
          <Input
            placeholder="My Workspace"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSlug(generateSlug(e.target.value));
            }}
            required
          />
        </Field>

        <Field
          label="Workspace URL"
          id="workspace-slug"
          hint="Lowercase letters, numbers and hyphens. This is your workspace's unique identifier."
        >
          <div className="flex items-center">
            <span aria-hidden className="text-neutral-500 text-sm mr-1">
              tasksflow.app/
            </span>
            <Input
              className="flex-1"
              placeholder="my-workspace"
              value={slug}
              onChange={(e) => setSlug(e.target.value)}
              required
            />
          </div>
        </Field>

        <div className="flex gap-3 pt-2">
          <Button
            type="submit"
            disabled={createWorkspace.isPending || !name.trim() || !slug.trim()}
          >
            {createWorkspace.isPending ? 'Creating...' : 'Create Workspace'}
          </Button>
          <Button variant="secondary" onClick={() => navigate(-1)}>
            Cancel
          </Button>
        </div>
      </form>
    </Card>
  );
}
