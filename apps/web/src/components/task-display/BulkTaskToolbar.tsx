import { useMemo, useState } from 'react';
import { Ban, CheckCircle2, Tag, Trash2, UserPlus, X } from 'lucide-react';
import clsx from 'clsx';
import { LabelPicker } from '../tasks/LabelPicker';

export type BulkAssignMode = 'add' | 'replace';

export interface BulkAssigneeOption {
  id: string;
  name: string | null;
  email: string;
  avatarUrl?: string | null;
}

export interface BulkLabelOption {
  id: string;
  name: string;
  color: string | null;
}

interface BulkTaskToolbarProps {
  selectedCount: number;
  members: BulkAssigneeOption[];
  labels: BulkLabelOption[];
  isLoading?: boolean;
  onClearSelection: () => void;
  onAssign: (userId: string, mode: BulkAssignMode) => Promise<void> | void;
  onSetLabels: (labelIds: string[]) => Promise<void> | void;
  onMoveToDone: () => Promise<void> | void;
  onCancel: () => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

export function BulkTaskToolbar({
  selectedCount,
  members,
  labels,
  isLoading = false,
  onClearSelection,
  onAssign,
  onSetLabels,
  onMoveToDone,
  onCancel,
  onDelete,
}: BulkTaskToolbarProps) {
  const [isAssignOpen, setIsAssignOpen] = useState(false);
  const [isLabelsOpen, setIsLabelsOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [assignMode, setAssignMode] = useState<BulkAssignMode>('add');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedLabelIds, setSelectedLabelIds] = useState<string[]>([]);

  const sortedMembers = useMemo(() => {
    return [...members].sort((a, b) => {
      const aLabel = (a.name || a.email).toLowerCase();
      const bLabel = (b.name || b.email).toLowerCase();
      return aLabel.localeCompare(bLabel);
    });
  }, [members]);

  const sortedLabels = useMemo(() => {
    return [...labels].sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
  }, [labels]);

  const selectedLabels = useMemo(
    () => sortedLabels.filter((label) => selectedLabelIds.includes(label.id)),
    [selectedLabelIds, sortedLabels]
  );

  const handleAssign = async () => {
    if (!selectedUserId || isLoading) return;
    await onAssign(selectedUserId, assignMode);
    setIsAssignOpen(false);
  };

  const handleSetLabels = async () => {
    if (isLoading) return;
    await onSetLabels(selectedLabelIds);
    setIsLabelsOpen(false);
  };

  if (selectedCount === 0) {
    return null;
  }

  return (
    <>
      <div className="sticky top-0 z-30 mb-4 rounded-lg border border-primary-200 bg-primary-50/95 px-4 py-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-semibold text-primary-900">{selectedCount} selected</span>
            <span className="text-primary-700">Use Ctrl/Cmd+click to add or remove tasks.</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAssignOpen(true)}
              disabled={isLoading || sortedMembers.length === 0}
              className={clsx('btn btn-secondary inline-flex items-center', (isLoading || sortedMembers.length === 0) && 'opacity-60')}
              title={sortedMembers.length === 0 ? 'No workspace members available' : undefined}
            >
              <UserPlus className="mr-1.5 h-4 w-4" />
              Assign
            </button>
            <button
              type="button"
              onClick={() => {
                setSelectedLabelIds([]);
                setIsLabelsOpen(true);
              }}
              disabled={isLoading}
              className={clsx('btn btn-secondary inline-flex items-center', isLoading && 'opacity-60')}
            >
              <Tag className="mr-1.5 h-4 w-4" />
              Set labels
            </button>
            <button
              type="button"
              onClick={onMoveToDone}
              disabled={isLoading}
              className={clsx('btn btn-secondary inline-flex items-center', isLoading && 'opacity-60')}
            >
              <CheckCircle2 className="mr-1.5 h-4 w-4" />
              Move to Done
            </button>
            <button
              type="button"
              onClick={onCancel}
              disabled={isLoading}
              className={clsx('btn btn-secondary inline-flex items-center', isLoading && 'opacity-60')}
            >
              <Ban className="mr-1.5 h-4 w-4" />
              Cancel
            </button>
            <button
              type="button"
              onClick={() => setIsDeleteOpen(true)}
              disabled={isLoading}
              className={clsx('btn inline-flex items-center border border-red-200 bg-red-50 text-red-700 hover:bg-red-100', isLoading && 'opacity-60')}
            >
              <Trash2 className="mr-1.5 h-4 w-4" />
              Delete
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              disabled={isLoading}
              className={clsx('btn btn-ghost inline-flex items-center', isLoading && 'opacity-60')}
            >
              <X className="mr-1.5 h-4 w-4" />
              Clear
            </button>
          </div>
        </div>
      </div>

      {isAssignOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsAssignOpen(false)} />
          <div className="relative z-10 w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Bulk assign</h3>
            <p className="mt-1 text-sm text-gray-600">Apply assignment to {selectedCount} selected tasks.</p>

            <div className="mt-4 space-y-4">
              <div>
                <label htmlFor="bulk-assign-member" className="mb-1 block text-sm font-medium text-gray-700">
                  Member
                </label>
                <select
                  id="bulk-assign-member"
                  value={selectedUserId}
                  onChange={(event) => setSelectedUserId(event.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-primary-500 focus:ring-2 focus:ring-primary-500"
                >
                  <option value="">Select a member</option>
                  {sortedMembers.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name || member.email}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium text-gray-700">Mode</p>
                <label className="mb-2 flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3">
                  <input
                    type="radio"
                    name="bulk-assign-mode"
                    checked={assignMode === 'add'}
                    onChange={() => setAssignMode('add')}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-900">Add assignee</span>
                    <span className="block text-xs text-gray-600">Keep current assignees and add the selected member.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-gray-200 p-3">
                  <input
                    type="radio"
                    name="bulk-assign-mode"
                    checked={assignMode === 'replace'}
                    onChange={() => setAssignMode('replace')}
                    className="mt-1"
                  />
                  <span>
                    <span className="block text-sm font-medium text-gray-900">Replace assignees</span>
                    <span className="block text-xs text-gray-600">Remove existing assignees and keep only the selected member.</span>
                  </span>
                </label>
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setIsAssignOpen(false)} className="btn btn-secondary" disabled={isLoading}>
                Cancel
              </button>
              <button type="button" onClick={handleAssign} className="btn btn-primary" disabled={isLoading || !selectedUserId}>
                {isLoading ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isLabelsOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsLabelsOpen(false)} />
          <div className="relative z-10 w-full max-w-xl rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Set labels</h3>
            <p className="mt-1 text-sm text-gray-600">
              Select labels to apply to {selectedCount} selected tasks. Leave empty to clear labels.
            </p>

            <div className="mt-4">
              <LabelPicker
                currentLabels={selectedLabels}
                projectLabels={sortedLabels}
                onAdd={(labelId) => {
                  setSelectedLabelIds((previous) =>
                    previous.includes(labelId) ? previous : [...previous, labelId]
                  );
                }}
                onRemove={(labelId) => {
                  setSelectedLabelIds((previous) => previous.filter((id) => id !== labelId));
                }}
                isLoading={isLoading}
              />
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setIsLabelsOpen(false)} className="btn btn-secondary" disabled={isLoading}>
                Cancel
              </button>
              <button type="button" onClick={handleSetLabels} className="btn btn-primary" disabled={isLoading}>
                {isLoading ? 'Applying...' : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isDeleteOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setIsDeleteOpen(false)} />
          <div className="relative z-10 w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl">
            <h3 className="text-lg font-semibold text-gray-900">Delete selected tasks</h3>
            <p className="mt-2 text-sm text-gray-600">
              This will delete {selectedCount} selected task{selectedCount === 1 ? '' : 's'}. This action cannot be undone.
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" onClick={() => setIsDeleteOpen(false)} className="btn btn-secondary" disabled={isLoading}>
                Cancel
              </button>
              <button
                type="button"
                onClick={async () => {
                  await onDelete();
                  setIsDeleteOpen(false);
                }}
                className="btn border border-red-200 bg-red-600 text-white hover:bg-red-700"
                disabled={isLoading}
              >
                {isLoading ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
