/**
 * Global UI surfaces that any page can open: the ⌘K palette, the shortcuts
 * cheat sheet, the "create task" dialog and the task detail sheet. Layout
 * renders them once (components/command/GlobalLayers.tsx).
 *
 *   const openCreateTask = useUiStore((s) => s.openCreateTask);
 *   openCreateTask({ projectId, stateId });
 *
 * `activeTaskId` is the task whose detail is on screen (sheet, page or inbox
 * preview), whoever rendered it; the palette uses it for "Copy task link".
 */
import { create } from 'zustand';

export interface CreateTaskRequest {
  /** null: the current project, else the first one. */
  projectId: string | null;
  /** Initial column; defaults to the project's first state. */
  stateId?: string | null;
}

export interface UiState {
  paletteOpen: boolean;
  shortcutsOpen: boolean;
  createTask: CreateTaskRequest | null;
  /** Task shown in the global detail sheet. */
  sheetTaskId: string | null;
  activeTaskId: string | null;

  setPaletteOpen: (open: boolean) => void;
  setShortcutsOpen: (open: boolean) => void;
  openCreateTask: (request?: Partial<CreateTaskRequest>) => void;
  closeCreateTask: () => void;
  openTaskSheet: (taskId: string) => void;
  closeTaskSheet: () => void;
  setActiveTaskId: (taskId: string | null) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  paletteOpen: false,
  shortcutsOpen: false,
  createTask: null,
  sheetTaskId: null,
  activeTaskId: null,

  setPaletteOpen: (paletteOpen) => set({ paletteOpen }),
  setShortcutsOpen: (shortcutsOpen) => set({ shortcutsOpen }),
  openCreateTask: (request = {}) =>
    set({
      createTask: { projectId: request.projectId ?? null, stateId: request.stateId ?? null },
      paletteOpen: false,
    }),
  closeCreateTask: () => set({ createTask: null }),
  openTaskSheet: (sheetTaskId) => set({ sheetTaskId, paletteOpen: false }),
  closeTaskSheet: () => set({ sheetTaskId: null }),
  setActiveTaskId: (activeTaskId) => set({ activeTaskId }),
}));
