import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, LayoutGrid, List, Table2, Calendar, Lock, Globe, Eye, MoreHorizontal, Pencil, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../stores/workspace';
import { api } from '../api/client';
import type { SmartView, DisplayType } from '@flowtask/shared';

interface SmartViewWithShares extends SmartView {
  _count?: {
    publicShares: number;
  };
}

const displayTypeIcons: Record<DisplayType, React.ReactNode> = {
  kanban: <LayoutGrid className="w-4 h-4" />,
  list: <List className="w-4 h-4" />,
  table: <Table2 className="w-4 h-4" />,
  calendar: <Calendar className="w-4 h-4" />,
};

const displayTypeLabels: Record<DisplayType, string> = {
  kanban: 'Kanban',
  list: 'List',
  table: 'Table',
  calendar: 'Calendar',
};

interface ViewCardProps {
  view: SmartViewWithShares;
  onDelete: (viewId: string) => void;
}

function ViewCard({ view, onDelete }: ViewCardProps) {
  const navigate = useNavigate();
  const [showMenu, setShowMenu] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleEdit = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate(`/settings/views/${view.id}/edit`);
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShowMenu(false);
    setShowDeleteConfirm(true);
  };

  const handleConfirmDelete = () => {
    onDelete(view.id);
    setShowDeleteConfirm(false);
  };

  return (
    <>
      <Link
        to={`/view/${view.id}`}
        className="card p-4 hover:shadow-md transition-shadow relative group"
      >
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center">
            {displayTypeIcons[view.displayType]}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-gray-900 truncate">{view.name}</h3>
              {view.isPersonal && (
                <span title="Personal view">
                  <Lock className="w-3.5 h-3.5 text-gray-400 flex-shrink-0" />
                </span>
              )}
            </div>
            {view.description && (
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">{view.description}</p>
            )}
            <div className="flex items-center gap-3 mt-2">
              <span className="inline-flex items-center text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {displayTypeLabels[view.displayType]}
              </span>
              {view._count && view._count.publicShares > 0 && (
                <span className="inline-flex items-center gap-1 text-xs text-gray-500" title="Public shares">
                  <Globe className="w-3 h-3" />
                  {view._count.publicShares}
                </span>
              )}
            </div>
          </div>

          {/* Actions Menu */}
          <div className="relative">
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setShowMenu(!showMenu);
              }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>

            {showMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowMenu(false);
                  }}
                />
                <div className="absolute right-0 top-8 z-20 w-36 bg-white rounded-lg shadow-lg border border-gray-200 py-1">
                  <button
                    onClick={handleEdit}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-50"
                  >
                    <Pencil className="w-4 h-4" />
                    Edit
                  </button>
                  <button
                    onClick={handleDeleteClick}
                    className="flex items-center gap-2 w-full px-3 py-2 text-sm text-red-600 hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </Link>

      {/* Delete Confirmation Dialog */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowDeleteConfirm(false)} />
          <div className="relative bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete View</h3>
            <p className="text-sm text-gray-600 mb-4">
              Are you sure you want to delete "{view.name}"? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="btn btn-secondary"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDelete}
                className="btn bg-red-600 text-white hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function ViewsPage() {
  const { currentWorkspace } = useWorkspaceStore();
  const queryClient = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['smart-views', currentWorkspace?.id],
    queryFn: async () => {
      const response = await api.get<{ data: SmartViewWithShares[] }>(
        `/api/smart-views?workspaceId=${currentWorkspace!.id}`
      );
      return response.data;
    },
    enabled: !!currentWorkspace?.id,
  });

  const deleteMutation = useMutation({
    mutationFn: async (viewId: string) => {
      await api.delete(`/api/smart-views/${viewId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['smart-views', currentWorkspace?.id] });
    },
  });

  const handleDelete = (viewId: string) => {
    deleteMutation.mutate(viewId);
  };

  if (!currentWorkspace) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Eye className="w-12 h-12 text-gray-300 mb-4" />
        <h2 className="text-lg font-medium text-gray-900 mb-2">No Workspace Selected</h2>
        <p className="text-gray-600 mb-4">Select or create a workspace to view saved views.</p>
        <Link to="/settings/workspaces/new" className="btn btn-primary">
          Create Workspace
        </Link>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16">
        <Eye className="w-12 h-12 text-red-300 mb-4" />
        <h2 className="text-lg font-medium text-gray-900 mb-2">Failed to Load Views</h2>
        <p className="text-gray-600">
          {error instanceof Error ? error.message : 'An error occurred while loading views.'}
        </p>
      </div>
    );
  }

  const views = data || [];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Views</h1>
          <p className="text-gray-600 mt-1">
            Saved filtered views in {currentWorkspace.name}
          </p>
        </div>
        <Link to="/settings/views/new" className="btn btn-primary inline-flex items-center">
          <Plus className="w-4 h-4 mr-2" />
          New View
        </Link>
      </div>

      {views.length === 0 ? (
        <div className="card p-12 text-center">
          <Eye className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">No views yet</h3>
          <p className="text-gray-600 mb-4">
            Create custom views to filter and organize your tasks.
          </p>
          <Link to="/settings/views/new" className="btn btn-primary inline-flex items-center">
            <Plus className="w-4 h-4 mr-2" />
            Create View
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {views.map((view) => (
            <ViewCard key={view.id} view={view} onDelete={handleDelete} />
          ))}
        </div>
      )}
    </div>
  );
}
