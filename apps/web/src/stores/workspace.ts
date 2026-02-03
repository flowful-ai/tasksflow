import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Workspace, Project } from '@flowtask/shared';
import { api } from '../api/client';

interface WorkspaceState {
  workspaces: Workspace[];
  currentWorkspace: Workspace | null;
  projects: Project[];
  currentProject: Project | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchWorkspaces: () => Promise<void>;
  setCurrentWorkspace: (workspace: Workspace | null) => void;
  fetchProjects: (workspaceId: string) => Promise<void>;
  setCurrentProject: (project: Project | null) => void;
  createWorkspace: (name: string, slug: string) => Promise<Workspace>;
  createProject: (name: string, identifier: string) => Promise<Project>;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      currentWorkspace: null,
      projects: [],
      currentProject: null,
      isLoading: false,
      error: null,

      fetchWorkspaces: async () => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.get<{ data?: Workspace[] }>('/api/workspaces');
          const workspaces = response.data || [];
          set({
            workspaces,
            isLoading: false,
          });

          // Set current workspace if not set
          if (!get().currentWorkspace && workspaces.length > 0) {
            set({ currentWorkspace: workspaces[0] });
          }
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to fetch workspaces',
            isLoading: false,
          });
        }
      },

      setCurrentWorkspace: (workspace) => {
        set({ currentWorkspace: workspace, projects: [], currentProject: null });
        if (workspace) {
          get().fetchProjects(workspace.id);
        }
      },

      fetchProjects: async (workspaceId) => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.get<{ data?: Project[] }>(`/api/projects?workspaceId=${workspaceId}`);
          set({
            projects: response.data || [],
            isLoading: false,
          });
        } catch (error) {
          set({
            error: error instanceof Error ? error.message : 'Failed to fetch projects',
            isLoading: false,
          });
        }
      },

      setCurrentProject: (project) => {
        set({ currentProject: project });
      },

      createWorkspace: async (name, slug) => {
        const response = await api.post<{ data: Workspace }>('/api/workspaces', { name, slug });
        const workspace = response.data;
        set((state) => ({
          workspaces: [...state.workspaces, workspace],
          currentWorkspace: workspace,
        }));
        return workspace;
      },

      createProject: async (name, identifier) => {
        const currentWorkspace = get().currentWorkspace;
        if (!currentWorkspace) {
          throw new Error('No workspace selected');
        }

        const response = await api.post<{ data: Project }>('/api/projects', {
          workspaceId: currentWorkspace.id,
          name,
          identifier,
        });
        const project = response.data;
        set((state) => ({
          projects: [...state.projects, project],
          currentProject: project,
        }));
        return project;
      },
    }),
    {
      name: 'flowtask-workspace',
      partialize: (state) => ({
        currentWorkspace: state.currentWorkspace,
        currentProject: state.currentProject,
      }),
    }
  )
);
