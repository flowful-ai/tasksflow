/**
 * ⌘K palette (mockup section 3): search tasks, jump to projects and pages,
 * run actions. Built on cmdk inside the shared Dialog (focus trap, Escape,
 * focus restore). Filtering is ours (`shouldFilter={false}`): tasks come from
 * the search API, everything else is matched locally.
 */
import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import {
  ArrowRight,
  Clock,
  Copy,
  FolderKanban,
  Inbox,
  Keyboard,
  LayoutDashboard,
  LayoutGrid,
  List,
  Plus,
  Search,
  Settings,
  Target,
  Trash2,
  Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { Dialog, Kbd, Spinner, toast } from '../ui';
import { useCurrentWorkspace, useProjects, useSearch } from '../../hooks/queries';
import { useUiStore } from '../../stores/ui';
import { useWorkspaceStore } from '../../stores/workspace';
import { readRecents, recordRecent, type RecentItem } from '../../lib/recent';
import { modKeyLabel } from '../../lib/hotkeys';
import type { SearchTaskHit } from '../../api/types';
import { useDebouncedValue } from '../../lib/useDebouncedValue';
import { useDefaultProjectId, useRouteProjectId } from './useCurrentProject';

interface PaletteAction {
  id: string;
  label: string;
  icon: ReactNode;
  keys?: string[];
  keywords?: string;
  run: () => void;
}

/** Wrap the query words found in `text` in <b>. */
function Highlight({ text, query }: { text: string; query: string }) {
  const words = query
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 1)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (words.length === 0) return <>{text}</>;
  const parts = text.split(new RegExp(`(${words.join('|')})`, 'gi'));
  return (
    <>
      {parts.map((part, index) =>
        index % 2 === 1 ? (
          <b key={index} className="font-semibold text-neutral-950">
            {part}
          </b>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  );
}

const matches = (query: string, ...fields: (string | undefined)[]) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => f?.toLowerCase().includes(q));
};

const itemClass =
  'flex cursor-pointer select-none items-center gap-2.5 rounded-lg px-3 py-2 text-sm text-neutral-700 data-[selected=true]:bg-neutral-100 data-[selected=true]:text-neutral-950 [&_svg]:h-4 [&_svg]:w-4 [&_svg]:shrink-0 [&_svg]:text-neutral-400';
const groupClass =
  '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-semibold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-neutral-400';

function TaskKey({ children }: { children: ReactNode }) {
  return <span className="shrink-0 font-mono text-xs text-neutral-500">{children}</span>;
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { workspaceId } = useCurrentWorkspace();
  const { data: projects = [] } = useProjects(workspaceId);
  const routeProjectId = useRouteProjectId();
  const defaultProjectId = useDefaultProjectId();
  const activeTaskId = useUiStore((s) => s.activeTaskId);
  const openTaskSheet = useUiStore((s) => s.openTaskSheet);
  const openCreateTask = useUiStore((s) => s.openCreateTask);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const viewMode = useWorkspaceStore((s) => (routeProjectId ? s.projectViewModes[routeProjectId] ?? 'kanban' : null));
  const setProjectViewMode = useWorkspaceStore((s) => s.setProjectViewMode);

  const [query, setQuery] = useState('');
  const debounced = useDebouncedValue(query, 150);
  const search = useSearch(workspaceId, debounced, 8);
  const [recents] = useState<RecentItem[]>(() => readRecents(workspaceId));
  const hasQuery = query.trim().length > 0;

  const taskHits = useMemo<SearchTaskHit[]>(() => {
    if (!hasQuery) return [];
    const hits = search.data?.tasks ?? [];
    return [...hits].sort((a, b) => Number(b.exactKeyMatch) - Number(a.exactKeyMatch));
  }, [hasQuery, search.data]);

  const openTask = (hit: { id: string; key: string; title: string }) => {
    recordRecent(workspaceId, { kind: 'task', id: hit.id, key: hit.key, title: hit.title });
    onClose();
    openTaskSheet(hit.id);
  };
  const openProject = (project: { id: string; identifier: string; name: string }) => {
    recordRecent(workspaceId, { kind: 'project', id: project.id, key: project.identifier, title: project.name });
    onClose();
    navigate(`/project/${project.id}`);
  };
  const go = (href: string) => () => {
    onClose();
    navigate(href);
  };

  const actions: PaletteAction[] = [
    {
      id: 'create-task',
      label: 'Create task',
      icon: <Plus />,
      keys: ['C'],
      keywords: 'new add issue',
      run: () => {
        onClose();
        openCreateTask({ projectId: defaultProjectId });
      },
    },
    { id: 'go-inbox', label: 'Go to Inbox', icon: <Inbox />, keys: ['G', 'I'], keywords: 'notifications', run: go('/inbox') },
    { id: 'go-my-tasks', label: 'Go to My tasks', icon: <Target />, keys: ['G', 'M'], keywords: 'assigned me', run: go('/my-tasks') },
    { id: 'go-views', label: 'Go to Views', icon: <Zap />, keys: ['G', 'V'], keywords: 'smart filters', run: go('/views') },
    { id: 'go-settings', label: 'Go to Settings', icon: <Settings />, keys: ['G', 'S'], keywords: 'preferences', run: go('/settings') },
  ];
  if (routeProjectId && viewMode) {
    const next = viewMode === 'kanban' ? 'list' : 'kanban';
    actions.push({
      id: 'toggle-view',
      label: next === 'list' ? 'Switch to List view' : 'Switch to Board view',
      icon: next === 'list' ? <List /> : <LayoutGrid />,
      keywords: 'toggle board list kanban layout',
      run: () => {
        setProjectViewMode(routeProjectId, next);
        onClose();
      },
    });
  }
  if (activeTaskId) {
    actions.push({
      id: 'copy-link',
      label: 'Copy task link',
      icon: <Copy />,
      keywords: 'share url clipboard',
      run: () => {
        const url = `${window.location.origin}/task/${activeTaskId}`;
        onClose();
        navigator.clipboard.writeText(url).then(
          () => toast.success('Link copied'),
          () => toast.error('Could not copy the link')
        );
      },
    });
  }
  actions.push({
    id: 'shortcuts',
    label: 'Keyboard shortcuts',
    icon: <Keyboard />,
    keys: ['?'],
    keywords: 'help keys cheat sheet',
    run: () => {
      onClose();
      setShortcutsOpen(true);
    },
  });

  const navigation: PaletteAction[] = [
    { id: 'nav-dashboard', label: 'Dashboard', icon: <LayoutDashboard />, keywords: 'home', run: go('/dashboard') },
    { id: 'nav-projects', label: 'All projects', icon: <FolderKanban />, keys: ['G', 'P'], run: go('/projects') },
  ];
  if (routeProjectId) {
    navigation.push({
      id: 'nav-trash',
      label: 'Project trash',
      icon: <Trash2 />,
      keywords: 'deleted restore bin',
      run: go(`/project/${routeProjectId}/trash`),
    });
  }

  const visibleActions = actions.filter((a) => matches(query, a.label, a.keywords));
  const visibleNavigation = navigation.filter((a) => matches(query, a.label, a.keywords));
  const visibleProjects = hasQuery ? projects.filter((p) => matches(query, p.name, p.identifier)).slice(0, 6) : [];
  const searching = hasQuery && (search.isFetching || debounced !== query);
  const nothing =
    hasQuery && !searching && taskHits.length === 0 && visibleProjects.length === 0 && visibleActions.length === 0 && visibleNavigation.length === 0;

  const renderAction = (action: PaletteAction) => (
    <Command.Item key={action.id} value={action.id} onSelect={action.run} className={itemClass}>
      {action.icon}
      <span className="flex-1 truncate">{action.label}</span>
      {action.keys && (
        <span className="flex gap-1" aria-hidden>
          {action.keys.map((k) => (
            <Kbd key={k}>{k}</Kbd>
          ))}
        </span>
      )}
    </Command.Item>
  );

  return (
    <Command label="Command palette" shouldFilter={false} loop className="flex max-h-[min(70vh,560px)] flex-col">
      <div className="flex items-center gap-2.5 border-b border-neutral-200 px-4">
        <Search aria-hidden className="h-4 w-4 shrink-0 text-neutral-400" />
        <Command.Input
          value={query}
          onValueChange={setQuery}
          placeholder="Search tasks, projects and actions…"
          aria-label="Search tasks, projects and actions"
          className="h-12 w-full bg-transparent text-[15px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:ring-0 border-0 px-0"
        />
        {searching && <Spinner size="sm" label="Searching" />}
      </div>

      <Command.List className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {nothing && (
          <Command.Empty className="px-3 py-8 text-center text-sm text-neutral-500">
            No results for “{query.trim()}”
          </Command.Empty>
        )}

        {!hasQuery && recents.length > 0 && (
          <Command.Group heading="Recent" className={groupClass}>
            {recents.map((item) => (
              <Command.Item
                key={`${item.kind}:${item.id}`}
                value={`recent:${item.kind}:${item.id}`}
                onSelect={() =>
                  item.kind === 'task'
                    ? openTask(item)
                    : openProject({ id: item.id, identifier: item.key, name: item.title })
                }
                className={itemClass}
              >
                <Clock />
                <TaskKey>{item.key}</TaskKey>
                <span className="flex-1 truncate">{item.title}</span>
                {item.kind === 'project' && <span className="text-xs text-neutral-400">Project</span>}
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {taskHits.length > 0 && (
          <Command.Group heading="Tasks" className={groupClass}>
            {taskHits.map((hit) => (
              <Command.Item key={hit.id} value={`task:${hit.id}`} onSelect={() => openTask(hit)} className={itemClass}>
                <TaskKey>{hit.key}</TaskKey>
                <span className="flex-1 truncate">
                  <Highlight text={hit.title} query={debounced} />
                </span>
                {hit.state && <span className="shrink-0 text-xs text-neutral-400">{hit.state.name}</span>}
                <ArrowRight aria-hidden className="opacity-0 [[data-selected=true]_&]:opacity-100" />
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {visibleProjects.length > 0 && (
          <Command.Group heading="Projects" className={groupClass}>
            {visibleProjects.map((project) => (
              <Command.Item
                key={project.id}
                value={`project:${project.id}`}
                onSelect={() => openProject(project)}
                className={itemClass}
              >
                <FolderKanban />
                <span className="flex-1 truncate">
                  <Highlight text={project.name} query={debounced} />
                </span>
                <TaskKey>{project.identifier}</TaskKey>
              </Command.Item>
            ))}
          </Command.Group>
        )}

        {visibleActions.length > 0 && (
          <Command.Group heading="Actions" className={groupClass}>
            {visibleActions.map(renderAction)}
          </Command.Group>
        )}

        {visibleNavigation.length > 0 && (
          <Command.Group heading="Navigation" className={groupClass}>
            {visibleNavigation.map(renderAction)}
          </Command.Group>
        )}
      </Command.List>

      <div
        aria-hidden
        className="flex items-center gap-4 border-t border-neutral-200 bg-neutral-50 px-4 py-2 text-xs text-neutral-500"
      >
        <span className="flex items-center gap-1">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd> navigate
        </span>
        <span className="flex items-center gap-1">
          <Kbd>↵</Kbd> open
        </span>
        <span className="flex items-center gap-1">
          <Kbd>esc</Kbd> close
        </span>
        <span className={clsx('ml-auto hidden items-center gap-1 sm:flex')}>
          <Kbd>{modKeyLabel()}</Kbd>
          <Kbd>K</Kbd> toggle
        </span>
      </div>
    </Command>
  );
}

export function CommandPalette() {
  const open = useUiStore((s) => s.paletteOpen);
  const setOpen = useUiStore((s) => s.setPaletteOpen);

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      title="Command palette"
      description="Search tasks and projects, or run an action"
      bare
      hideTitle
      size="lg"
      className="overflow-hidden !mt-[12vh] !mb-auto"
    >
      {/* Mounted only while open: the query resets every time. */}
      {open && <PaletteBody onClose={() => setOpen(false)} />}
    </Dialog>
  );
}
