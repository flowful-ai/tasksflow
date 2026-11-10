import { domainEvents } from '../events/bus.js';
import { eq, and, isNull, desc, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { comments, projects, tasks, users, taskEvents } from '../../db/index.js';
import type { Result } from '@flowtask/shared';
import { ok, err } from '@flowtask/shared';
import type {
  CommentWithUser,
  CommentCreateInput,
  CommentUpdateInput,
  CommentListOptions,
} from './types.js';
import { DomainError, toError } from '../workspace/errors.js';
import { isUuid } from '../workspace/authorization.js';
import type { DbExecutor } from '../task/db.js';

interface CommentTaskScope {
  workspaceId: string;
  projectId: string;
  taskKey: string;
  taskTitle: string;
  taskCreatedBy: string | null;
  taskDeleted: boolean;
}

export class CommentService {
  constructor(private db: Database) {}

  /** Workspace, project and key of a comment's task (for domain events). */
  private async taskScope(
    taskId: string,
    db: DbExecutor = this.db
  ): Promise<CommentTaskScope | null> {
    const [row] = await db
      .select({
        workspaceId: projects.workspaceId,
        projectId: tasks.projectId,
        identifier: projects.identifier,
        sequenceNumber: tasks.sequenceNumber,
        title: tasks.title,
        createdBy: tasks.createdBy,
        deletedAt: tasks.deletedAt,
      })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(eq(tasks.id, taskId));
    if (!row) return null;
    return {
      workspaceId: row.workspaceId,
      projectId: row.projectId,
      taskKey: `${row.identifier}-${row.sequenceNumber}`,
      taskTitle: row.title,
      taskCreatedBy: row.createdBy,
      taskDeleted: row.deletedAt !== null,
    };
  }

  private async emitUpdated(
    comment: CommentWithUser,
    actorId: string | null,
    origin?: 'github'
  ): Promise<void> {
    const scope = await this.taskScope(comment.taskId);
    if (!scope) return;
    domainEvents.emit('comment.updated', {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      taskId: comment.taskId,
      actorId,
      comment,
      ...(origin ? { origin } : {}),
    });
  }

  private async emitDeleted(
    commentId: string,
    taskId: string,
    actorId: string | null,
    origin?: 'github'
  ): Promise<void> {
    const scope = await this.taskScope(taskId);
    if (!scope) return;
    domainEvents.emit('comment.deleted', {
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      taskId,
      actorId,
      commentId,
      ...(origin ? { origin } : {}),
    });
  }

  /**
   * Create a new comment on a task. The comment (with its author) and the
   * task scope for the domain event are read inside the transaction, so once
   * the write commits nothing can turn it into an error: a client retry
   * would otherwise post the comment twice.
   */
  async create(input: CommentCreateInput): Promise<Result<CommentWithUser, Error>> {
    let created: { full: CommentWithUser; scope: CommentTaskScope };
    try {
      created = await this.db.transaction(async (tx) => {
        const [comment] = await tx
          .insert(comments)
          .values({
            taskId: input.taskId,
            userId: input.userId,
            content: input.content,
            externalCommentId: input.externalCommentId || null,
          })
          .returning();

        if (!comment) {
          throw new Error('Failed to create comment');
        }

        // Record the comment event for audit trail
        await tx.insert(taskEvents).values({
          taskId: input.taskId,
          actorId: input.userId,
          mcpClientId: input.mcpClientId || null,
          eventType: 'commented',
          newValue: { commentId: comment.id },
        });

        const [full, scope] = await Promise.all([
          this.loadComment(tx, comment.id),
          this.taskScope(input.taskId, tx),
        ]);
        if (!full) throw new Error('Failed to load the created comment');
        if (!scope) throw new DomainError('NOT_FOUND', 'Task not found');
        return { full, scope };
      });
    } catch (error) {
      return err(toError(error));
    }

    // Committed. Drives realtime, mentions/notifications, Slack, GitHub comment sync.
    try {
      domainEvents.emit('comment.created', {
        ...created.scope,
        commentId: created.full.id,
        taskId: input.taskId,
        actorId: input.userId,
        content: input.content,
        comment: created.full,
        mcpClientId: input.mcpClientId ?? null,
        ...(input.externalCommentId ? { origin: 'github' as const } : {}),
        ...(input.actorLabel ? { actorLabel: input.actorLabel } : {}),
      });
    } catch (error) {
      console.error('[comments] comment.created emit failed:', error);
    }
    return ok(created.full);
  }

  /**
   * Get a comment by ID with user info.
   */
  async getById(commentId: string): Promise<Result<CommentWithUser, Error>> {
    try {
      if (!isUuid(commentId)) {
        return err(new DomainError('NOT_FOUND', 'Comment not found'));
      }
      const comment = await this.loadComment(this.db, commentId);
      if (!comment) {
        return err(new DomainError('NOT_FOUND', 'Comment not found'));
      }
      return ok(comment);
    } catch (error) {
      return err(toError(error));
    }
  }

  private async loadComment(db: DbExecutor, commentId: string): Promise<CommentWithUser | null> {
    const [result] = await db
      .select({
        comment: comments,
        user: users,
      })
      .from(comments)
      .leftJoin(users, eq(comments.userId, users.id))
      .where(eq(comments.id, commentId));
    if (!result) return null;
    return {
      ...result.comment,
      user: result.user,
    };
  }

  /**
   * Update a comment.
   */
  async update(
    commentId: string,
    input: CommentUpdateInput
  ): Promise<Result<CommentWithUser, Error>> {
    try {
      // First verify the comment exists and get it
      const currentResult = await this.getById(commentId);
      if (!currentResult.ok) {
        return currentResult;
      }
      const current = currentResult.value;

      // Check if the user is authorized to update (must be the author)
      if (current.userId !== input.updatedBy) {
        return err(new DomainError('FORBIDDEN', 'Only the author can edit this comment'));
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

      const full = await this.getById(commentId);
      if (full.ok) await this.emitUpdated(full.value, input.updatedBy);
      return full;
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Soft delete a comment. The author may always delete it; `canModerate`
   * (callers holding comment:delete, e.g. workspace admins) may delete any.
   */
  async delete(
    commentId: string,
    deletedBy: string,
    options: { canModerate?: boolean } = {}
  ): Promise<Result<void, Error>> {
    try {
      // First verify the comment exists
      const currentResult = await this.getById(commentId);
      if (!currentResult.ok) {
        return err(currentResult.error);
      }
      const current = currentResult.value;

      if (current.userId !== deletedBy && !options.canModerate) {
        return err(new DomainError('FORBIDDEN', 'Only the author can delete this comment'));
      }

      await this.db
        .update(comments)
        .set({ deletedAt: new Date() })
        .where(eq(comments.id, commentId));

      await this.emitDeleted(commentId, current.taskId, deletedBy);
      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * List comments for a task with pagination.
   */
  async list(
    options: CommentListOptions
  ): Promise<Result<{ comments: CommentWithUser[]; total: number }, Error>> {
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
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(comments)
        .where(whereClause);

      const total = countResult?.count ?? 0;

      // Get comments with users
      const results = await this.db
        .select({
          comment: comments,
          user: users,
        })
        .from(comments)
        .leftJoin(users, eq(comments.userId, users.id))
        .where(whereClause)
        .orderBy(desc(comments.createdAt))
        .limit(limit)
        .offset((page - 1) * limit);

      const commentsWithUsers: CommentWithUser[] = results.map((r) => ({
        ...r.comment,
        user: r.user,
      }));

      return ok({ comments: commentsWithUsers, total });
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Get comment count for a task.
   */
  async getCount(taskId: string): Promise<Result<number, Error>> {
    try {
      const [result] = await this.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(comments)
        .where(and(eq(comments.taskId, taskId), isNull(comments.deletedAt)));

      return ok(result?.count ?? 0);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Find a comment by its external ID (e.g., GitHub comment ID).
   */
  async findByExternalId(
    externalCommentId: string
  ): Promise<Result<CommentWithUser | null, Error>> {
    try {
      const [result] = await this.db
        .select({
          comment: comments,
          user: users,
        })
        .from(comments)
        .leftJoin(users, eq(comments.userId, users.id))
        .where(eq(comments.externalCommentId, externalCommentId));

      if (!result) {
        return ok(null);
      }

      return ok({
        ...result.comment,
        user: result.user,
      });
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Update a comment by its external ID (bypasses author check for synced comments).
   */
  async updateExternal(
    externalCommentId: string,
    content: string
  ): Promise<Result<CommentWithUser | null, Error>> {
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

      const full = await this.getById(updated.id);
      if (full.ok) await this.emitUpdated(full.value, null, 'github');
      return full;
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Soft-delete a comment by its external ID (bypasses author check for synced comments).
   */
  async deleteExternal(externalCommentId: string): Promise<Result<void, Error>> {
    try {
      const deleted = await this.db
        .update(comments)
        .set({ deletedAt: new Date() })
        .where(and(eq(comments.externalCommentId, externalCommentId), isNull(comments.deletedAt)))
        .returning({ id: comments.id, taskId: comments.taskId });

      for (const row of deleted) await this.emitDeleted(row.id, row.taskId, null, 'github');
      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }
}
