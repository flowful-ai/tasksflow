/**
 * UI selection state only. Workspaces and projects themselves are server
 * state: read them with useWorkspaces()/useCurrentWorkspace()/useProjects()
 * from src/hooks/queries.
 *
 * Persisted: the selected workspace/project ids, sidebar and view preferences.
 *
 * Always read with a selector:
 *   const workspaceId = useWorkspaceStore((s) => s.currentWorkspaceId);
 *   const { a, b } = useWorkspaceStore(useShallow((s) => ({ a: s.a, b: s.b })));
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type ProjectViewMode = 'kanban' | 'list';

export interface WorkspaceUiState {
  currentWorkspaceId: string | null;
  currentProjectId: string | null;
  /** Desktop sidebar collapsed (mobile drawer state is not persisted). */
  sidebarCollapsed: boolean;
  /** Board or list, per project id. */
  projectViewModes: Record<string, ProjectViewMode>;

  setCurrentWorkspaceId: (workspaceId: string | null) => void;
  setCurrentProjectId: (projectId: string | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setProjectViewMode: (projectId: string, mode: ProjectViewMode) => void;
  reset: () => void;
}

const INITIAL = {
  currentWorkspaceId: null,
  currentProjectId: null,
  sidebarCollapsed: false,
  projectViewModes: {},
} satisfies Partial<WorkspaceUiState>;

interface LegacyPersistedState {
  currentWorkspace?: { id?: string } | null;
  currentProject?: { id?: string } | null;
}

function isRecord(value: object | null | undefined): value is Record<string, string | object> {
  return typeof value === 'object' && value !== null;
}

function isLegacyState(value: unknown): value is LegacyPersistedState {
  return typeof value === 'object' && value !== null;
}

/** v0 persisted whole objects; keep only their ids. */
export function migrateWorkspaceState(persisted: LegacyPersistedState | null | undefined): Pick<
  WorkspaceUiState,
  'currentWorkspaceId' | 'currentProjectId'
> {
  const ws = persisted?.currentWorkspace;
  const project = persisted?.currentProject;
  return {
    currentWorkspaceId: isRecord(ws) && typeof ws.id === 'string' ? ws.id : null,
    currentProjectId: isRecord(project) && typeof project.id === 'string' ? project.id : null,
  };
}

export const useWorkspaceStore = create<WorkspaceUiState>()(
  persist(
    (set) => ({
      ...INITIAL,
      setCurrentWorkspaceId: (currentWorkspaceId) =>
        set((state) =>
          state.currentWorkspaceId === currentWorkspaceId ? state : { currentWorkspaceId, currentProjectId: null }
        ),
      setCurrentProjectId: (currentProjectId) => set({ currentProjectId }),
      setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
      setProjectViewMode: (projectId, mode) =>
        set((state) => ({ projectViewModes: { ...state.projectViewModes, [projectId]: mode } })),
      reset: () => set(INITIAL),
    }),
    {
      name: 'flowtask-workspace',
      version: 1,
      partialize: (state) => ({
        currentWorkspaceId: state.currentWorkspaceId,
        currentProjectId: state.currentProjectId,
        sidebarCollapsed: state.sidebarCollapsed,
        projectViewModes: state.projectViewModes,
      }),
      // Only called when the stored version differs (v0 stored whole objects).
      migrate: (persisted) => ({
        ...INITIAL,
        ...(isLegacyState(persisted) ? migrateWorkspaceState(persisted) : {}),
      }),
    }
  )
);
