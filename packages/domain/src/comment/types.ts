import type { Comment, User } from '@flowtask/database';

export interface CommentAgent {
  id: string;
  name: string;
}

export interface CommentWithUser extends Comment {
  user: User | null;
  agent: CommentAgent | null;
}

export interface CommentCreateInput {
  taskId: string;
  userId: string | null;
  agentId?: string | null;
  content: string;
}

export interface CommentUpdateInput {
  content: string;
  updatedBy: string | null;
}

export interface CommentListOptions {
  taskId: string;
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
}
