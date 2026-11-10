import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FolderKanban } from 'lucide-react';
import { useCreateProject, useCurrentWorkspace } from '../hooks/queries';
import { Button, Card, EmptyState, Field, Input, toast } from '../components/ui';

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
          <Button asChild>
            <Link to="/dashboard">Go to Dashboard</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="max-w-lg mx-auto mt-12">
      <Card>
        <h1 className="text-lg font-semibold text-neutral-900 mb-4">Create Project</h1>
        <p className="text-neutral-600 mb-6">
          Create a new project in <span className="font-medium">{currentWorkspace.name}</span>.
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Project Name" id="new-project-name">
            <Input
              placeholder="My Project"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setIdentifier(generateIdentifier(e.target.value));
              }}
              required
            />
          </Field>

          <Field
            label="Project Identifier"
            id="new-project-identifier"
            hint={<>Used as prefix for task IDs (e.g., {identifier || 'PROJ'}-123).</>}
          >
            <Input
              placeholder="PROJ"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value.toUpperCase())}
              maxLength={6}
              required
            />
          </Field>

          <div className="flex gap-3 pt-2">
            <Button
              type="submit"
              disabled={createProject.isPending || !name.trim() || !identifier.trim()}
            >
              {createProject.isPending ? 'Creating...' : 'Create Project'}
            </Button>
            <Button variant="secondary" onClick={() => navigate(-1)}>
              Cancel
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
}
