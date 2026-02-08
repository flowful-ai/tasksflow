import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Eye, LayoutGrid, List, Table2, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../../api/client';
import { useWorkspaceStore } from '../../stores/workspace';
import { FilterBuilder } from './filter-builder';
import type { SmartView, DisplayType, GroupBy, SortBy, SortOrder, FilterGroup } from '@flowtask/shared';

const DISPLAY_TYPE_OPTIONS: { value: DisplayType; label: string; icon: React.ReactNode }[] = [
  { value: 'kanban', label: 'Kanban', icon: <LayoutGrid className="w-4 h-4" /> },
  { value: 'list', label: 'List', icon: <List className="w-4 h-4" /> },
  { value: 'table', label: 'Table', icon: <Table2 className="w-4 h-4" /> },
  { value: 'calendar', label: 'Calendar', icon: <Calendar className="w-4 h-4" /> },
];

const GROUP_BY_OPTIONS: { value: GroupBy; label: string }[] = [
  { value: 'state', label: 'State' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'project', label: 'Project' },
  { value: 'priority', label: 'Priority' },
  { value: 'label', label: 'Label' },
];

const SECONDARY_GROUP_BY_OPTIONS: { value: GroupBy | 'none'; label: string }[] = [
  { value: 'none', label: 'No secondary grouping' },
  { value: 'state', label: 'State' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'project', label: 'Project' },
  { value: 'priority', label: 'Priority' },
  { value: 'label', label: 'Label' },
];

const SORT_BY_OPTIONS: { value: SortBy; label: string }[] = [
  { value: 'position', label: 'Position' },
  { value: 'created_at', label: 'Created date' },
  { value: 'updated_at', label: 'Updated date' },
  { value: 'due_date', label: 'Due date' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
  { value: 'sequence_number', label: 'Sequence number' },
];

const SORT_ORDER_OPTIONS: { value: SortOrder; label: string }[] = [
  { value: 'asc', label: 'Ascending' },
  { value: 'desc', label: 'Descending' },
];

interface SmartViewFormData {
  name: string;
  description: string;
  filters: FilterGroup;
  displayType: DisplayType;
  groupBy: GroupBy;
  secondaryGroupBy: GroupBy | null;
  sortBy: SortBy;
  sortOrder: SortOrder;
  isPersonal: boolean;
}

export function SmartViewForm() {
  const { viewId } = useParams<{ viewId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();

  const isEditing = !!viewId;

  const [formData, setFormData] = useState<SmartViewFormData>({
    name: '',
    description: '',
    filters: { operator: 'AND', conditions: [] },
    displayType: 'kanban',
    groupBy: 'state',
    secondaryGroupBy: null,
    sortBy: 'position',
    sortOrder: 'asc',
    isPersonal: false,
  });
  const [error, setError] = useState<string | null>(null);

  // Fetch existing view data when editing
  const { data: existingView, isLoading: isLoadingView } = useQuery({
    queryKey: ['smart-view-details', viewId],
    queryFn: async () => {
      const response = await api.get<{ data: SmartView }>(`/api/smart-views/${viewId}`);
      return response.data;
    },
    enabled: isEditing,
  });

  // Populate form when editing
  useEffect(() => {
    if (existingView) {
      setFormData({
        name: existingView.name,
        description: existingView.description || '',
        filters: existingView.filters || { operator: 'AND', conditions: [] },
        displayType: existingView.displayType,
        groupBy: existingView.groupBy || 'state',
        secondaryGroupBy: existingView.secondaryGroupBy || null,
        sortBy: existingView.sortBy,
        sortOrder: existingView.sortOrder,
        isPersonal: existingView.isPersonal,
      });
    }
  }, [existingView]);

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: SmartViewFormData) => {
      const response = await api.post<{ data: SmartView }>('/api/smart-views', {
        ...data,
        workspaceId: currentWorkspace!.id,
        groupBy: data.groupBy,
        secondaryGroupBy: data.secondaryGroupBy === 'none' ? null : data.secondaryGroupBy,
      });
      return response.data;
    },
    onSuccess: (view) => {
      queryClient.invalidateQueries({ queryKey: ['smart-views'] });
      navigate(`/view/${view.id}`);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: SmartViewFormData) => {
      const response = await api.patch<{ data: SmartView }>(`/api/smart-views/${viewId}`, {
        ...data,
        groupBy: data.groupBy,
        secondaryGroupBy: data.secondaryGroupBy === 'none' ? null : data.secondaryGroupBy,
      });
      return response.data;
    },
    onSuccess: (view) => {
      queryClient.invalidateQueries({ queryKey: ['smart-views'] });
      queryClient.invalidateQueries({ queryKey: ['smart-view-details', viewId] });
      queryClient.invalidateQueries({ queryKey: ['smart-view-execute', viewId] });
      navigate(`/view/${view.id}`);
    },
    onError: (err: Error) => {
      setError(err.message);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData?.name?.trim()) {
      setError('Name is required');
      return;
    }

    if (isEditing) {
      updateMutation.mutate(formData);
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleChange = <K extends keyof SmartViewFormData>(
    field: K,
    value: SmartViewFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;

  if (!currentWorkspace) {
    return (
      <div className="card p-6">
        <p className="text-gray-600">Please select a workspace first.</p>
      </div>
    );
  }

  if (isEditing && isLoadingView) {
    return (
      <div className="card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-gray-200 rounded" />
          <div className="h-10 bg-gray-100 rounded" />
          <div className="h-24 bg-gray-100 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        onClick={() => navigate(-1)}
        className="inline-flex items-center text-sm text-gray-600 hover:text-gray-900"
      >
        <ArrowLeft className="w-4 h-4 mr-1" />
        Back
      </button>

      <div className="card p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
            <Eye className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {isEditing ? 'Edit View' : 'Create View'}
            </h2>
            <p className="text-sm text-gray-500">
              {isEditing
                ? 'Update the view settings'
                : 'Create a new filtered view for your tasks'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">{error}</div>
          )}

          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={formData?.name ?? ''}
              onChange={(e) => handleChange('name', e.target.value)}
              className="input"
              placeholder="e.g., My Tasks, Sprint Backlog"
              required
              autoFocus
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description
            </label>
            <textarea
              value={formData?.description ?? ''}
              onChange={(e) => handleChange('description', e.target.value)}
              className="input min-h-[80px]"
              placeholder="Optional description for this view"
            />
          </div>

          {/* Filters */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Filters
            </label>
            <FilterBuilder
              value={formData.filters}
              onChange={(filters) => setFormData((prev) => ({ ...prev, filters }))}
              workspaceId={currentWorkspace!.id}
            />
          </div>

          {/* Display Type */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Display Type
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {DISPLAY_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleChange('displayType', option.value)}
                  className={clsx(
                    'flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors',
                    formData?.displayType === option.value
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                  )}
                >
                  {option.icon}
                  <span className="text-sm font-medium">{option.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Group By */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Group By
            </label>
            <select
              value={formData?.groupBy ?? 'state'}
              onChange={(e) => {
                const value = e.target.value as GroupBy;
                setFormData((prev) => ({
                  ...prev,
                  groupBy: value,
                  secondaryGroupBy: prev.secondaryGroupBy === value ? null : prev.secondaryGroupBy,
                }));
              }}
              className="input"
            >
              {GROUP_BY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Secondary Group By */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Secondary Group By
            </label>
            <select
              value={formData?.secondaryGroupBy ?? 'none'}
              onChange={(e) => {
                const value = e.target.value === 'none' ? null : (e.target.value as GroupBy);
                handleChange('secondaryGroupBy', value === formData.groupBy ? null : value);
              }}
              className="input"
            >
              {SECONDARY_GROUP_BY_OPTIONS.map((option) => (
                <option
                  key={option.value}
                  value={option.value}
                  disabled={option.value !== 'none' && option.value === formData.groupBy}
                >
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          {/* Sort By and Order */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sort By
              </label>
              <select
                value={formData?.sortBy ?? 'position'}
                onChange={(e) => handleChange('sortBy', e.target.value as SortBy)}
                className="input"
              >
                {SORT_BY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Sort Order
              </label>
              <select
                value={formData?.sortOrder ?? 'asc'}
                onChange={(e) => handleChange('sortOrder', e.target.value as SortOrder)}
                className="input"
              >
                {SORT_ORDER_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Personal View Toggle */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="isPersonal"
              checked={formData?.isPersonal ?? false}
              onChange={(e) => handleChange('isPersonal', e.target.checked)}
              className="rounded border-gray-300 text-primary-600 focus:ring-primary-500"
            />
            <label htmlFor="isPersonal" className="ml-2 text-sm text-gray-700">
              Personal view (only visible to you)
            </label>
          </div>

          {/* Submit Buttons */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              type="submit"
              disabled={isLoading || !formData?.name?.trim()}
              className="btn btn-primary"
            >
              {isLoading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create View'}
            </button>
            <button
              type="button"
              onClick={() => navigate(-1)}
              className="btn btn-secondary"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
