import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Eye, LayoutGrid, List, Table2, Calendar } from 'lucide-react';
import clsx from 'clsx';
import { FilterBuilder } from './filter-builder';
import {
  GroupBySchema,
  SortBySchema,
  SortOrderSchema,
  type DisplayType,
  type GroupBy,
  type SortBy,
  type SortOrder,
  type FilterGroup,
} from '@flowtask/shared';
import type { SmartViewDto } from '../../api/types';
import {
  useCreateSmartView,
  useCurrentWorkspace,
  useSmartView,
  useUpdateSmartView,
} from '../../hooks/queries';
import { toast } from '../ui';

const isGroupBy = (value: string): value is GroupBy => GroupBySchema.safeParse(value).success;
const isSortBy = (value: string): value is SortBy => SortBySchema.safeParse(value).success;
const isSortOrder = (value: string): value is SortOrder => SortOrderSchema.safeParse(value).success;

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
  const { workspace: currentWorkspace } = useCurrentWorkspace();

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

  const { data: existingView, isLoading: isLoadingView } = useSmartView(viewId);
  const createView = useCreateSmartView();
  const updateView = useUpdateSmartView(viewId ?? '');

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

  const onSaved = (view: SmartViewDto) => {
    toast.success(isEditing ? 'View saved' : 'View created');
    void navigate(`/view/${view.id}`);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!formData?.name?.trim()) {
      setError('Name is required');
      return;
    }

    const payload = {
      ...formData,
      description: formData.description || undefined,
      secondaryGroupBy: formData.secondaryGroupBy,
    };
    if (isEditing) {
      updateView.mutate(payload, { onSuccess: onSaved });
    } else if (currentWorkspace) {
      createView.mutate({ ...payload, workspaceId: currentWorkspace.id }, { onSuccess: onSaved });
    }
  };

  const handleChange = <K extends keyof SmartViewFormData>(
    field: K,
    value: SmartViewFormData[K]
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const isLoading = createView.isPending || updateView.isPending;

  if (!currentWorkspace) {
    return (
      <div className="card p-6">
        <p className="text-neutral-600">Please select a workspace first.</p>
      </div>
    );
  }

  if (isEditing && isLoadingView) {
    return (
      <div className="card p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 w-48 bg-neutral-200 rounded" />
          <div className="h-10 bg-neutral-100 rounded" />
          <div className="h-24 bg-neutral-100 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center text-sm text-neutral-600 hover:text-neutral-900"
      >
        <ArrowLeft aria-hidden className="w-4 h-4 mr-1" />
        Back
      </button>

      <div className="card p-6">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-primary-100 rounded-lg flex items-center justify-center">
            <Eye aria-hidden className="w-5 h-5 text-primary-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-neutral-900">
              {isEditing ? 'Edit View' : 'Create View'}
            </h2>
            <p className="text-sm text-neutral-500">
              {isEditing ? 'Update the view settings' : 'Create a new filtered view for your tasks'}
            </p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <p role="alert" className="p-3 text-sm text-red-600 bg-red-50 rounded-lg">
              {error}
            </p>
          )}

          {/* Name */}
          <div>
            <label htmlFor="view-name" className="block text-sm font-medium text-neutral-700 mb-1">
              Name{' '}
              <span aria-hidden className="text-red-500">
                *
              </span>
            </label>
            <input
              id="view-name"
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
            <label
              htmlFor="view-description"
              className="block text-sm font-medium text-neutral-700 mb-1"
            >
              Description
            </label>
            <textarea
              id="view-description"
              value={formData?.description ?? ''}
              onChange={(e) => handleChange('description', e.target.value)}
              className="input min-h-[80px]"
              placeholder="Optional description for this view"
            />
          </div>

          {/* Filters */}
          <div>
            <h3 className="block text-sm font-medium text-neutral-700 mb-2">Filters</h3>
            <FilterBuilder
              value={formData.filters}
              onChange={(filters) => setFormData((prev) => ({ ...prev, filters }))}
              workspaceId={currentWorkspace.id}
            />
          </div>

          {/* Display Type */}
          <div>
            <span id="view-display-type" className="block text-sm font-medium text-neutral-700 mb-2">
              Display Type
            </span>
            <div
              role="group"
              aria-labelledby="view-display-type"
              className="grid grid-cols-2 sm:grid-cols-4 gap-2"
            >
              {DISPLAY_TYPE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => handleChange('displayType', option.value)}
                  aria-pressed={formData.displayType === option.value}
                  className={clsx(
                    'flex items-center justify-center gap-2 p-3 rounded-lg border transition-colors',
                    formData?.displayType === option.value
                      ? 'border-primary-500 bg-primary-50 text-primary-700'
                      : 'border-neutral-200 hover:bg-neutral-50 text-neutral-700'
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
            <label htmlFor="view-group-by" className="block text-sm font-medium text-neutral-700 mb-1">
              Group By
            </label>
            <select
              id="view-group-by"
              value={formData?.groupBy ?? 'state'}
              onChange={(e) => {
                const value = e.target.value;
                if (!isGroupBy(value)) return;
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
            <label
              htmlFor="view-secondary-group-by"
              className="block text-sm font-medium text-neutral-700 mb-1"
            >
              Secondary Group By
            </label>
            <select
              id="view-secondary-group-by"
              value={formData?.secondaryGroupBy ?? 'none'}
              onChange={(e) => {
                const raw = e.target.value;
                const value = raw !== 'none' && isGroupBy(raw) ? raw : null;
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
              <label
                htmlFor="view-sort-by"
                className="block text-sm font-medium text-neutral-700 mb-1"
              >
                Sort By
              </label>
              <select
                id="view-sort-by"
                value={formData?.sortBy ?? 'position'}
                onChange={(e) => {
                  if (isSortBy(e.target.value)) handleChange('sortBy', e.target.value);
                }}
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
              <label
                htmlFor="view-sort-order"
                className="block text-sm font-medium text-neutral-700 mb-1"
              >
                Sort Order
              </label>
              <select
                id="view-sort-order"
                value={formData?.sortOrder ?? 'asc'}
                onChange={(e) => {
                  if (isSortOrder(e.target.value)) handleChange('sortOrder', e.target.value);
                }}
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
              className="rounded border-neutral-300 text-primary-600 focus:ring-primary-500"
            />
            <label htmlFor="isPersonal" className="ml-2 text-sm text-neutral-700">
              Personal view (only visible to you)
            </label>
          </div>

          {/* Submit Buttons */}
          <div className="flex gap-3 pt-4 border-t border-neutral-200">
            <button
              type="submit"
              disabled={isLoading || !formData?.name?.trim()}
              className="btn btn-primary"
            >
              {isLoading ? 'Saving...' : isEditing ? 'Save Changes' : 'Create View'}
            </button>
            <button type="button" onClick={() => navigate(-1)} className="btn btn-secondary">
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
