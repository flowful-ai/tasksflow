import type { Comment, User } from '../../db/index.js';

export interface CommentWithUser extends Comment {
  user: User | null;
}

export interface CommentCreateInput {
  taskId: string;
  userId: string | null;
  mcpClientId?: string | null;
  content: string;
  externalCommentId?: string | null;
  /** Display label when the author isn't a FlowTask user (e.g. "@octocat on GitHub"). */
  actorLabel?: string;
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
