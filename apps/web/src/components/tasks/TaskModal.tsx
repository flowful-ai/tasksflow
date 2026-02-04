import { useState, useEffect } from 'react';
import { X } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';

interface TaskModalProps {
  taskId?: string;
  projectId: string;
  states: { id: string; name: string }[];
  onClose: () => void;
  onCreated?: () => void;
  onUpdated?: () => void;
}

export function TaskModal({
  taskId,
  projectId,
  states,
  onClose,
  onCreated,
  onUpdated,
}: TaskModalProps) {
  const isEditing = !!taskId;
  const queryClient = useQueryClient();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [stateId, setStateId] = useState('');
  const [priority, setPriority] = useState('');

  // Fetch task if editing
  const { data: task } = useQuery({
    queryKey: ['task', taskId],
    queryFn: async () => {
      const response = await api.get<{ data: { title: string; description: string | null; stateId: string | null; priority: string | null } }>(`/api/tasks/${taskId}`);
      return response.data;
    },
    enabled: isEditing,
  });

  // Populate form when task data loads
  useEffect(() => {
    if (task) {
      setTitle(task.title);
      setDescription(task.description || '');
      setStateId(task.stateId || '');
      setPriority(task.priority || '');
    }
  }, [task]);

  // Set default state for new tasks
  useEffect(() => {
    if (!isEditing && states.length > 0 && !stateId) {
      setStateId(states[0]!.id);
    }
  }, [isEditing, states, stateId]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async () => {
      return api.post('/api/tasks', {
        projectId,
        title,
        description: description || undefined,
        stateId: stateId || undefined,
        priority: priority || undefined,
      });
    },
    onSuccess: () => {
      // Invalidate smart view queries since new tasks may match filter criteria
      queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
      onCreated?.();
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async () => {
      return api.patch(`/api/tasks/${taskId}`, {
        title,
        description,
        stateId: stateId || undefined,
        priority: priority || undefined,
      });
    },
    onSuccess: () => {
      // Invalidate smart view queries since task changes may affect filter results
      queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
      onUpdated?.();
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isEditing) {
      await updateMutation.mutateAsync();
    } else {
      await createMutation.mutateAsync();
    }
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-lg bg-white rounded-lg shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? 'Edit Task' : 'Create Task'}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg hover:bg-gray-100"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title *
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="input"
              placeholder="Task title"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input min-h-[100px]"
              placeholder="Add a description..."
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Status
              </label>
              <select
                value={stateId}
                onChange={(e) => setStateId(e.target.value)}
                className="input"
              >
                <option value="">Select status</option>
                {states.map((state) => (
                  <option key={state.id} value={state.id}>
                    {state.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Priority
              </label>
              <select
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
                className="input"
              >
                <option value="">No priority</option>
                <option value="urgent">Urgent</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
              </select>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end space-x-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading || !title.trim()}
              className="btn btn-primary"
            >
              {isLoading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Task'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
