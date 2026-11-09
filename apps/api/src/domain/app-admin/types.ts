import type { AppRole } from '@flowtask/shared';

export interface AppContext {
  userId: string;
  appRole: AppRole;
  isAppManager: boolean;
}

export interface AppUserSummary {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
  appRole: AppRole;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListAppUsersInput {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ListAppUsersResult {
  users: AppUserSummary[];
  total: number;
  limit: number;
  offset: number;
}

export interface UpdateUserRoleInput {
  targetUserId: string;
  appRole: AppRole;
  actorUserId: string;
}
