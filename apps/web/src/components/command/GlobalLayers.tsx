/**
 * App-wide shortcuts and the surfaces they open, mounted once by Layout:
 * ⌘K palette, "?" cheat sheet, the create-task dialog (C) and the task
 * detail sheet opened from the palette or the inbox.
 */
import { lazy, Suspense, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useHotkey } from '../../lib/hotkeys';
import { useUiStore } from '../../stores/ui';
import { useCurrentWorkspace, useProject, useProjects } from '../../hooks/queries';
import { CommandPalette } from './CommandPalette';
import { ShortcutsDialog } from './ShortcutsDialog';
import { NAV_SHORTCUTS } from './shortcuts';
import { useDefaultProjectId } from './useCurrentProject';

// Loaded on first use: they pull in markdown rendering and the task forms.
const TaskModal = lazy(async () => ({ default: (await import('../tasks/TaskModal')).TaskModal }));
const TaskDetailSheet = lazy(async () => ({ default: (await import('../tasks/TaskDetailSheet')).TaskDetailSheet }));

function NavShortcut({ combo, href }: { combo: string; href: string }) {
  const navigate = useNavigate();
  useHotkey(combo, () => {
    void navigate(href);
  });
  return null;
}

function GlobalShortcuts() {
  const setPaletteOpen = useUiStore((s) => s.setPaletteOpen);
  const setShortcutsOpen = useUiStore((s) => s.setShortcutsOpen);
  const openCreateTask = useUiStore((s) => s.openCreateTask);
  const defaultProjectId = useDefaultProjectId();

  useHotkey('mod+k', () => setPaletteOpen(!useUiStore.getState().paletteOpen), {
    allowInInputs: true,
    allowInDialogs: true,
  });
  useHotkey('?', () => setShortcutsOpen(true));
  useHotkey('c', () => openCreateTask({ projectId: defaultProjectId }));

  return (
    <>
      {NAV_SHORTCUTS.map((s) => (
        <NavShortcut key={s.combo} combo={s.combo} href={s.href} />
      ))}
    </>
  );
}

function GlobalCreateTask() {
  const request = useUiStore((s) => s.createTask);
  const close = useUiStore((s) => s.closeCreateTask);
  const { workspaceId } = useCurrentWorkspace();
  const { data: projects = [] } = useProjects(request ? workspaceId : null);
  const projectId = request
    ? (request.projectId && projects.some((p) => p.id === request.projectId) ? request.projectId : projects[0]?.id) ?? null
    : null;
  const { data: project } = useProject(projectId);

  const states = useMemo(
    () => [...(project?.taskStates ?? [])].sort((a, b) => (a.position < b.position ? -1 : a.position > b.position ? 1 : 0)),
    [project?.taskStates]
  );
  const defaultStateId = request?.stateId && states.some((s) => s.id === request.stateId) ? request.stateId : undefined;

  if (!request || !projectId || !project) return null;
  return (
    <Suspense fallback={null}>
      <TaskModal projectId={projectId} states={states} defaultStateId={defaultStateId} onClose={close} onCreated={close} />
    </Suspense>
  );
}

function GlobalTaskSheet() {
  const taskId = useUiStore((s) => s.sheetTaskId);
  const close = useUiStore((s) => s.closeTaskSheet);
  if (!taskId) return null;
  return (
    <Suspense fallback={null}>
      <TaskDetailSheet key={taskId} taskId={taskId} onClose={close} />
    </Suspense>
  );
}

export function GlobalLayers() {
  return (
    <>
      <GlobalShortcuts />
      <CommandPalette />
      <ShortcutsDialog />
      <GlobalCreateTask />
      <GlobalTaskSheet />
    </>
  );
}
