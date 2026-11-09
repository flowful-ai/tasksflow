import { Link } from 'react-router-dom';
import { Link2, Maximize2, MoreHorizontal, Trash2, X, FolderKanban } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  IconButton,
  toast,
} from '../../ui';
import { taskKeyOf, type TaskDetail } from './types';

export interface HeaderProps {
  task: TaskDetail;
  /** 'page' hides "open full page"; 'inline' (inbox preview) has no close. */
  mode: 'sheet' | 'page' | 'inline';
  onClose?: () => void;
  onDelete?: () => void;
  readOnly?: boolean;
}

export function taskUrl(taskId: string): string {
  return `${window.location.origin}/task/${taskId}`;
}

export function copyTaskLink(taskId: string): void {
  navigator.clipboard.writeText(taskUrl(taskId)).then(
    () => toast.success('Link copied'),
    () => toast.error('Could not copy the link')
  );
}

/** Breadcrumb (project › key), copy link, open full page, ⋯ menu and close. */
export function Header({ task, mode, onClose, onDelete, readOnly = false }: HeaderProps) {
  const key = taskKeyOf(task);

  return (
    <header className="flex items-center gap-2 border-b border-neutral-200 px-4 py-2.5 sm:px-6">
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-1.5 text-sm text-neutral-500">
          <li className="min-w-0 truncate">
            {readOnly ? (
              <span>{task.project.name}</span>
            ) : (
              <Link to={`/project/${task.project.id}`} className="hover:text-neutral-900 hover:underline" onClick={onClose}>
                {task.project.name}
              </Link>
            )}
          </li>
          <li aria-hidden>›</li>
          <li className="shrink-0">
            <span aria-current="page" className="font-mono text-xs font-medium text-neutral-700">
              {key}
            </span>
          </li>
        </ol>
      </nav>

      {!readOnly && (
        <div className="flex shrink-0 items-center gap-0.5">
          <IconButton label="Copy link" icon={<Link2 />} onClick={() => copyTaskLink(task.id)} />
          {mode !== 'page' && (
            <Link
              to={`/task/${task.id}`}
              aria-label="Open full page"
              title="Open full page"
              onClick={onClose}
              className="inline-flex rounded-lg p-1.5 text-neutral-500 transition-colors hover:bg-neutral-100 hover:text-neutral-800 [&_svg]:h-4 [&_svg]:w-4"
            >
              <Maximize2 aria-hidden />
            </Link>
          )}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Task actions" icon={<MoreHorizontal />} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem icon={<Link2 />} onSelect={() => copyTaskLink(task.id)}>
                Copy link
              </DropdownMenuItem>
              <DropdownMenuItem icon={<FolderKanban />} asChild>
                <Link to={`/project/${task.project.id}`} onClick={onClose}>
                  Open project
                </Link>
              </DropdownMenuItem>
              {onDelete && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem icon={<Trash2 />} destructive onSelect={onDelete}>
                    Delete task
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
      {mode !== 'inline' && onClose && <IconButton label="Close" icon={<X />} onClick={onClose} />}
    </header>
  );
}
