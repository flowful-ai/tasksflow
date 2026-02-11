import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import type { Database } from '@flowtask/database';
import { comments, users, taskEvents, workspaceAgents } from '@flowtask/database';
import type { Result } from '@flowtask/shared';
import { ok, err } from '@flowtask/shared';
import type { CommentWithUser, CommentCreateInput, CommentUpdateInput, CommentListOptions, CommentAgent } from './types.js';

export class CommentService {
  constructor(private db: Database) {}

  /**
   * Create a new comment on a task.
   */
  async create(input: CommentCreateInput): Promise<Result<CommentWithUser, Error>> {
    try {
      const [comment] = await this.db
        .insert(comments)
        .values({
          taskId: input.taskId,
          userId: input.userId,
          agentId: input.agentId || null,
          content: input.content,
          externalCommentId: input.externalCommentId || null,
        })
        .returning();

      if (!comment) {
        return err(new Error('Failed to create comment'));
      }

      // Record the comment event for audit trail
      await this.db.insert(taskEvents).values({
        taskId: input.taskId,
        actorId: input.userId,
        mcpClientId: input.mcpClientId || null,
        eventType: 'commented',
        newValue: { commentId: comment.id },
      });

      return this.getById(comment.id);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get a comment by ID with user and agent info.
   */
  async getById(commentId: string): Promise<Result<CommentWithUser, Error>> {
    try {
      const [result] = await this.db
        .select({
          comment: comments,
          user: users,
          agent: {
            id: workspaceAgents.id,
            name: workspaceAgents.name,
          },
        })
        .from(comments)
        .leftJoin(users, eq(comments.userId, users.id))
        .leftJoin(workspaceAgents, eq(comments.agentId, workspaceAgents.id))
        .where(eq(comments.id, commentId));

      if (!result) {
        return err(new Error('Comment not found'));
      }

      return ok({
        ...result.comment,
        user: result.user,
        agent: result.agent?.id ? result.agent : null,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Update a comment.
   */
  async update(commentId: string, input: CommentUpdateInput): Promise<Result<CommentWithUser, Error>> {
    try {
      // First verify the comment exists and get it
      const currentResult = await this.getById(commentId);
      if (!currentResult.ok) {
        return currentResult;
      }
      const current = currentResult.value;

      // Check if the user is authorized to update (must be the author)
      if (current.userId !== input.updatedBy) {
        return err(new Error('Not authorized to update this comment'));
      }

      const [updated] = await this.db
        .update(comments)
        .set({
          content: input.content,
          updatedAt: new Date(),
        })
        .where(eq(comments.id, commentId))
        .returning();

      if (!updated) {
        return err(new Error('Failed to update comment'));
      }

      return this.getById(commentId);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Soft delete a comment.
   */
  async delete(commentId: string, deletedBy: string): Promise<Result<void, Error>> {
    try {
      // First verify the comment exists
      const currentResult = await this.getById(commentId);
      if (!currentResult.ok) {
        return currentResult as unknown as Result<void, Error>;
      }
      const current = currentResult.value;

      // Check if the user is authorized to delete (must be the author)
      if (current.userId !== deletedBy) {
        return err(new Error('Not authorized to delete this comment'));
      }

      await this.db
        .update(comments)
        .set({ deletedAt: new Date() })
        .where(eq(comments.id, commentId));

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * List comments for a task with pagination.
   */
  async list(options: CommentListOptions): Promise<Result<{ comments: CommentWithUser[]; total: number }, Error>> {
    try {
      const { taskId, includeDeleted = false, page = 1, limit = 50 } = options;

      // Build where conditions
      const conditions = [eq(comments.taskId, taskId)];

      if (!includeDeleted) {
        conditions.push(isNull(comments.deletedAt));
      }

      const whereClause = and(...conditions);

      // Get total count
      const [countResult] = await this.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(comments)
        .where(whereClause);

      const total = countResult?.count ?? 0;

      // Get comments with users and agents
      const results = await this.db
        .select({
          comment: comments,
          user: users,
          agent: {
            id: workspaceAgents.id,
            name: workspaceAgents.name,
          },
        })
        .from(comments)
        .leftJoin(users, eq(comments.userId, users.id))
        .leftJoin(workspaceAgents, eq(comments.agentId, workspaceAgents.id))
        .where(whereClause)
        .orderBy(desc(comments.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      const commentsWithUsers: CommentWithUser[] = results.map((r) => ({
        ...r.comment,
        user: r.user,
        agent: r.agent?.id ? r.agent : null,
      }));

      return ok({ comments: commentsWithUsers, total });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get comment count for a task.
   */
  async getCount(taskId: string): Promise<Result<number, Error>> {
    try {
      const [result] = await this.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(comments)
        .where(and(eq(comments.taskId, taskId), isNull(comments.deletedAt)));

      return ok(result?.count ?? 0);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Find a comment by its external ID (e.g., GitHub comment ID).
   */
  async findByExternalId(externalCommentId: string): Promise<Result<CommentWithUser | null, Error>> {
    try {
      const [result] = await this.db
        .select({
          comment: comments,
          user: users,
          agent: {
            id: workspaceAgents.id,
            name: workspaceAgents.name,
          },
        })
        .from(comments)
        .leftJoin(users, eq(comments.userId, users.id))
        .leftJoin(workspaceAgents, eq(comments.agentId, workspaceAgents.id))
        .where(eq(comments.externalCommentId, externalCommentId));

      if (!result) {
        return ok(null);
      }

      return ok({
        ...result.comment,
        user: result.user,
        agent: result.agent?.id ? result.agent : null,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Update a comment by its external ID (bypasses author check for synced comments).
   */
  async updateExternal(externalCommentId: string, content: string): Promise<Result<CommentWithUser | null, Error>> {
    try {
      const [updated] = await this.db
        .update(comments)
        .set({
          content,
          updatedAt: new Date(),
        })
        .where(eq(comments.externalCommentId, externalCommentId))
        .returning();

      if (!updated) {
        return ok(null);
      }

      return this.getById(updated.id);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Soft-delete a comment by its external ID (bypasses author check for synced comments).
   */
  async deleteExternal(externalCommentId: string): Promise<Result<void, Error>> {
    try {
      await this.db
        .update(comments)
        .set({ deletedAt: new Date() })
        .where(eq(comments.externalCommentId, externalCommentId));

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }
}
