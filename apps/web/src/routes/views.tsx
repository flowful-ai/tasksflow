import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Plus,
  LayoutGrid,
  List,
  Table2,
  Calendar,
  Lock,
  Globe,
  Eye,
  MoreHorizontal,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { DisplayType } from '@flowtask/shared';
import type { SmartViewDto } from '../api/types';
import { useCurrentWorkspace, useDeleteSmartView, useSmartViews } from '../hooks/queries';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  EmptyState,
  ErrorState,
  IconButton,
  PageHeader,
  PageSpinner,
  toast,
} from '../components/ui';

const displayTypeIcons: Record<DisplayType, React.ReactNode> = {
  kanban: <LayoutGrid aria-hidden className="w-4 h-4" />,
  list: <List aria-hidden className="w-4 h-4" />,
  table: <Table2 aria-hidden className="w-4 h-4" />,
  calendar: <Calendar aria-hidden className="w-4 h-4" />,
};

const displayTypeLabels: Record<DisplayType, string> = {
  kanban: 'Kanban',
  list: 'List',
  table: 'Table',
  calendar: 'Calendar',
};

interface ViewCardProps {
  view: SmartViewDto;
  onDelete: (view: SmartViewDto) => void;
}

function ViewCard({ view, onDelete }: ViewCardProps) {
  const navigate = useNavigate();
  const activeShares = view.publicShares?.filter((share) => share.isActive).length ?? 0;

  return (
    <li className="card p-4 hover:shadow-md transition-shadow relative group">
      <div className="flex items-start gap-3">
        <div
          aria-hidden
          className="w-10 h-10 rounded-lg bg-primary-100 text-primary-600 flex items-center justify-center"
        >
          {displayTypeIcons[view.displayType]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-neutral-900 truncate">
              {/* The link's ::after covers the card so the whole card is clickable. */}
              <Link
                to={`/view/${view.id}`}
                className="after:absolute after:inset-0 after:content-[''] focus-visible:outline-hidden"
              >
                {view.name}
              </Link>
            </h3>
            {view.isPersonal && (
              <Lock className="w-3.5 h-3.5 text-neutral-400 shrink-0" aria-label="Personal view" />
            )}
          </div>
          {view.description && (
            <p className="text-sm text-neutral-500 mt-1 line-clamp-2">{view.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2">
            <Badge className="font-normal">{displayTypeLabels[view.displayType]}</Badge>
            {activeShares > 0 && (
              <span className="inline-flex items-center gap-1 text-xs text-neutral-600">
                <Globe aria-hidden className="w-3 h-3" />
                {activeShares} public link{activeShares === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>

        <div className="relative z-10">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton
                label={`Actions for ${view.name}`}
                icon={<MoreHorizontal />}
                className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
              />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem
                icon={<Pencil />}
                onSelect={() => navigate(`/settings/workspace/views/${view.id}/edit`)}
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem destructive icon={<Trash2 />} onSelect={() => onDelete(view)}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </li>
  );
}

export function ViewsPage() {
  const { workspace: currentWorkspace } = useCurrentWorkspace();
  const { data: views = [], isLoading, error, refetch } = useSmartViews(currentWorkspace?.id);
  const deleteView = useDeleteSmartView();
  const [deleteTarget, setDeleteTarget] = useState<SmartViewDto | null>(null);

  if (!currentWorkspace) {
    return (
      <EmptyState
        icon={<Eye />}
        title="No workspace selected"
        body="Select or create a workspace to view saved views."
        action={
          <Button asChild>
            <Link to="/settings/workspace/new">Create Workspace</Link>
          </Button>
        }
      />
    );
  }

  if (isLoading) return <PageSpinner label="Loading views" />;
  if (error)
    return <ErrorState error={error} resource="list of views" onRetry={() => void refetch()} />;

  return (
    <div>
      <PageHeader
        title="Views"
        description={`Saved filtered views in ${currentWorkspace.name}`}
        actions={
          <Button asChild leadingIcon={<Plus />}>
            <Link to="/settings/workspace/views/new">New View</Link>
          </Button>
        }
      />

      {views.length === 0 ? (
        <Card padding="none">
          <EmptyState
            icon={<Eye />}
            title="No views yet"
            body="Create custom views to filter and organize your tasks."
            action={
              <Button asChild leadingIcon={<Plus />}>
                <Link to="/settings/workspace/views/new">Create View</Link>
              </Button>
            }
          />
        </Card>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {views.map((view) => (
            <ViewCard key={view.id} view={view} onDelete={setDeleteTarget} />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={`Delete view "${deleteTarget?.name ?? ''}"?`}
        description="Its public share links stop working. This action cannot be undone."
        confirmLabel="Delete"
        variant="danger"
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteView.mutateAsync(deleteTarget.id);
          toast.success('View deleted');
        }}
      />
    </div>
  );
}
