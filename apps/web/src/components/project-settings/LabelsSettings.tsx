import { useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import type { LabelDto } from '../../api/types';
import { useLabelMutations } from '../../hooks/queries';
import { Button, Card, ColorDot, ConfirmDialog, Field, Input, Panel, toast } from '../ui';

interface LabelsSettingsProps {
  projectId: string;
  labels: LabelDto[];
}

interface EditableLabel extends LabelDto {
  colorTouched: boolean;
}

const DEFAULT_COLOR = '#9ca3af';

export function LabelsSettings({ projectId, labels }: LabelsSettingsProps) {
  const { create, update, remove } = useLabelMutations(projectId);
  const [editLabels, setEditLabels] = useState<EditableLabel[]>([]);
  const [newName, setNewName] = useState('');
  const [newColor, setNewColor] = useState(DEFAULT_COLOR);
  const [deleteTarget, setDeleteTarget] = useState<LabelDto | null>(null);

  useEffect(() => {
    setEditLabels(labels.map((label) => ({ ...label, colorTouched: false })));
  }, [labels]);

  const patchLocal = (id: string, patch: Partial<EditableLabel>) =>
    setEditLabels((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)));

  const handleCreate = (event: React.FormEvent) => {
    event.preventDefault();
    if (!newName.trim()) return;
    create.mutate(
      { name: newName.trim(), color: newColor || undefined },
      {
        onSuccess: (label) => {
          setNewName('');
          setNewColor(DEFAULT_COLOR);
          toast.success(`Label ${label.name} added`);
        },
      }
    );
  };

  const handleUpdate = (label: EditableLabel) => {
    if (!label.name.trim()) {
      toast.error('Label name is required.');
      return;
    }
    update.mutate(
      {
        labelId: label.id,
        name: label.name.trim(),
        ...(label.colorTouched && label.color ? { color: label.color } : {}),
      },
      { onSuccess: () => toast.success('Label saved') }
    );
  };

  return (
    <Card title="Labels" description="Organize tasks with labels.">
      <ul className="space-y-3">
        {editLabels.map((label) => {
          const isSaving = update.isPending && update.variables?.labelId === label.id;
          return (
            <li key={label.id}>
              <Panel className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center gap-3">
                  <ColorDot color={label.color} size="md" />
                  <Input
                    aria-label="Label name"
                    className="flex-1 min-w-[200px]"
                    value={label.name}
                    onChange={(e) => patchLocal(label.id, { name: e.target.value })}
                  />
                  <label className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-neutral-500 uppercase">Color</span>
                    <input
                      type="color"
                      value={label.color || DEFAULT_COLOR}
                      onChange={(e) =>
                        patchLocal(label.id, { color: e.target.value, colorTouched: true })
                      }
                      className="h-9 w-12 border border-neutral-200 rounded-lg"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => handleUpdate(label)}
                    disabled={isSaving}
                  >
                    {isSaving ? 'Saving...' : 'Save'}
                  </Button>
                  <Button
                    variant="secondary"
                    className="bg-red-50 text-red-700 hover:bg-red-100"
                    onClick={() => setDeleteTarget(label)}
                    leadingIcon={<Trash2 />}
                  >
                    Delete
                  </Button>
                </div>
              </Panel>
            </li>
          );
        })}
      </ul>

      <form onSubmit={handleCreate} className="mt-6 border-t border-neutral-200 pt-4 space-y-4">
        <h3 className="text-sm font-semibold text-neutral-700">Add Label</h3>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Name" id="new-label-name" className="sm:col-span-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Bug"
            />
          </Field>
          <Field label="Color" id="new-label-color">
            <input
              id="new-label-color"
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-10 w-full border border-neutral-200 rounded-lg"
            />
          </Field>
        </div>
        <Button type="submit" disabled={create.isPending || !newName.trim()}>
          {create.isPending ? 'Adding...' : 'Add Label'}
        </Button>
      </form>

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete label "${deleteTarget?.name ?? ''}"?`}
        description="It is removed from every task. This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await remove.mutateAsync(deleteTarget.id);
          toast.success('Label deleted');
        }}
      />
    </Card>
  );
}
