import type { Workspace, WorkspaceMember, User } from '../../db/index.js';
import type { CreateWorkspace, UpdateWorkspace, WorkspaceRole } from '@flowtask/shared';

export interface WorkspaceWithRelations extends Workspace {
  members: WorkspaceMemberWithUser[];
  projectCount: number;
}

export interface WorkspaceMemberWithUser extends WorkspaceMember {
  user: User;
}

export interface WorkspaceCreateInput extends CreateWorkspace {
  ownerId: string;
}

export interface WorkspaceUpdateInput extends UpdateWorkspace {
  updatedBy: string;
}

export interface AddMemberInput {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  addedBy: string;
}

export interface UpdateMemberInput {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  updatedBy: string;
}

export interface RemoveMemberInput {
  workspaceId: string;
  userId: string;
  removedBy: string;
}

export interface TransferOwnershipInput {
  workspaceId: string;
  /** Current owner handing over ownership; becomes an admin. */
  fromUserId: string;
  /** Existing member who becomes the owner. */
  toUserId: string;
}

export interface WorkspaceFilters {
  userId?: string; // Filter to workspaces the user is a member of
  search?: string;
}

export interface WorkspaceListOptions {
  filters?: WorkspaceFilters;
  sortBy?: 'name' | 'created_at';
  sortOrder?: 'asc' | 'desc';
}

export interface WorkspaceActivityCursorInput {
  createdAt: Date;
  id: string;
}

export interface WorkspaceActivityListOptions {
  limit?: number;
  cursor?: WorkspaceActivityCursorInput;
  /**
   * Restrict the feed to these projects (the caller's accessible projects).
   * An empty array returns no activity. Omit only for trusted internal use.
   */
  projectIds?: readonly string[];
}

export interface WorkspaceActivityActor {
  id: string;
  name: string | null;
  email: string;
}

export interface WorkspaceActivityAgent {
  id: string;
  name: string;
}

export interface WorkspaceActivityItem {
  id: string;
  createdAt: Date;
  eventType:
    | 'created'
    | 'updated'
    | 'moved'
    | 'assigned'
    | 'unassigned'
    | 'labeled'
    | 'unlabeled'
    | 'commented'
    | 'deleted'
    | 'restored';
  fieldName: string | null;
  task: {
    id: string;
    title: string;
    sequenceNumber: number;
    project: {
      id: string;
      identifier: string;
      name: string;
    };
  };
  actor: WorkspaceActivityActor | null;
  agent: WorkspaceActivityAgent | null;
}

// Authorization, role policy and safe errors live next to the workspace domain
// and are re-exported here so they are available from '../index.js'.
export * from './errors.js';
export * from './role-policy.js';
export * from './authorization.js';
