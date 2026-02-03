import type { Comment, User } from '@flowtask/database';

export interface CommentWithUser extends Comment {
  user: User | null;
}

export interface CommentCreateInput {
  taskId: string;
  userId: string;
  content: string;
}

export interface CommentUpdateInput {
  content: string;
  updatedBy: string;
}

export interface CommentListOptions {
  taskId: string;
  includeDeleted?: boolean;
  page?: number;
  limit?: number;
}
