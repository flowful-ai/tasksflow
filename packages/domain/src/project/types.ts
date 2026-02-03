import type { Project, TaskState, Label, ProjectIntegration } from '@flowtask/database';
import type { CreateProject, UpdateProject, CreateTaskState, CreateLabel } from '@flowtask/shared';

export interface ProjectWithRelations extends Project {
  taskStates: TaskState[];
  labels: Label[];
  integrations: ProjectIntegration[];
  taskCount: number;
}

export interface ProjectCreateInput extends CreateProject {
  workspaceId: string;
  createdBy: string;
}

export interface ProjectUpdateInput extends UpdateProject {
  updatedBy: string;
}

export interface TaskStateCreateInput extends CreateTaskState {
  projectId: string;
}

export interface TaskStateUpdateInput {
  name?: string;
  color?: string;
}

export interface LabelCreateInput extends CreateLabel {
  projectId: string;
}

export interface LabelUpdateInput {
  name?: string;
  color?: string;
}

export interface ProjectFilters {
  workspaceId?: string;
  includeArchived?: boolean;
  search?: string;
}

export interface ProjectListOptions {
  filters?: ProjectFilters;
  sortBy?: 'name' | 'created_at' | 'updated_at';
  sortOrder?: 'asc' | 'desc';
}
