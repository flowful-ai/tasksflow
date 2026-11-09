import { escapeLike } from '@flowtask/shared';
import { eq, and, or, sql, desc, asc, like, inArray, lt, SQL } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import {
  workspaces,
  workspaceMembers,
  users,
  projects,
  projectMembers,
  tasks,
  taskEvents,
  mcpOAuthClients,
} from '../../db/index.js';
import type {
  Result,
  WorkspaceRole,
  WorkspaceAiSettings,
  UpdateWorkspaceAiSettings,
} from '@flowtask/shared';
import { AIModelSchema } from '@flowtask/shared';
import { ok, err } from '@flowtask/shared';
import type {
  WorkspaceWithRelations,
  WorkspaceMemberWithUser,
  WorkspaceCreateInput,
  WorkspaceUpdateInput,
  AddMemberInput,
  UpdateMemberInput,
  RemoveMemberInput,
  TransferOwnershipInput,
  WorkspaceListOptions,
  WorkspaceActivityListOptions,
  WorkspaceActivityCursorInput,
  WorkspaceActivityItem,
} from './types.js';
import { DomainError, toError } from './errors.js';
import { canChangeRole, canGrantRole, canRemoveMember, isWorkspaceRole } from './role-policy.js';
import { isUuid } from './authorization.js';

type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0];

function countOwners(members: Map<string, WorkspaceRole>): number {
  let owners = 0;
  for (const role of members.values()) {
    if (role === 'owner') owners += 1;
  }
  return owners;
}

export class WorkspaceService {
  constructor(private db: Database) {}

  private normalizeAllowedModels(rawValue: unknown): string[] {
    if (!Array.isArray(rawValue)) {
      return [];
    }

    const sanitized: string[] = [];
    const seen = new Set<string>();

    for (const entry of rawValue) {
      const parsed = AIModelSchema.safeParse(entry);
      if (!parsed.success || seen.has(parsed.data)) {
        continue;
      }
      seen.add(parsed.data);
      sanitized.push(parsed.data);
    }

    return sanitized;
  }

  /**
   * Create a new workspace with the creator as owner.
   */
  async create(input: WorkspaceCreateInput): Promise<Result<WorkspaceWithRelations, Error>> {
    try {
      // Check for duplicate slug
      const [existing] = await this.db
        .select({ id: workspaces.id })
        .from(workspaces)
        .where(eq(workspaces.slug, input.slug));

      if (existing) {
        return err(
          new DomainError('CONFLICT', `Workspace with slug "${input.slug}" already exists`)
        );
      }

      // Create the workspace
      const [workspace] = await this.db
        .insert(workspaces)
        .values({
          name: input.name,
          slug: input.slug,
        })
        .returning();

      if (!workspace) {
        return err(new Error('Failed to create workspace'));
      }

      // Add the creator as owner
      await this.db.insert(workspaceMembers).values({
        workspaceId: workspace.id,
        userId: input.ownerId,
        role: 'owner',
      });

      return this.getById(workspace.id);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Get a workspace by ID with all relations.
   */
  async getById(workspaceId: string): Promise<Result<WorkspaceWithRelations, Error>> {
    try {
      const [workspace] = await this.db
        .select()
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));

      if (!workspace) {
        return err(new DomainError('NOT_FOUND', 'Workspace not found'));
      }

      // Get members with user info
      const memberRows = await this.db
        .select({
          member: workspaceMembers,
          user: users,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(workspaceMembers.userId, users.id))
        .where(eq(workspaceMembers.workspaceId, workspaceId));

      // Get project count
      const [countResult] = await this.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(projects)
        .where(eq(projects.workspaceId, workspaceId));

      const members: WorkspaceMemberWithUser[] = memberRows.map((row) => ({
        ...row.member,
        user: row.user,
      }));

      return ok({
        ...workspace,
        members,
        projectCount: countResult?.count ?? 0,
      });
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Get a workspace by slug.
   */
  async getBySlug(slug: string): Promise<Result<WorkspaceWithRelations, Error>> {
    try {
      const [workspace] = await this.db.select().from(workspaces).where(eq(workspaces.slug, slug));

      if (!workspace) {
        return err(new DomainError('NOT_FOUND', 'Workspace not found'));
      }

      return this.getById(workspace.id);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Update a workspace.
   */
  async update(
    workspaceId: string,
    input: WorkspaceUpdateInput
  ): Promise<Result<WorkspaceWithRelations, Error>> {
    try {
      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData.name = input.name;

      if (Object.keys(updateData).length > 0) {
        const [updated] = await this.db
          .update(workspaces)
          .set(updateData)
          .where(eq(workspaces.id, workspaceId))
          .returning();

        if (!updated) {
          return err(new Error('Failed to update workspace'));
        }
      }

      return this.getById(workspaceId);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Delete a workspace (cascades to all related data).
   */
  async delete(workspaceId: string): Promise<Result<void, Error>> {
    try {
      await this.db.delete(workspaces).where(eq(workspaces.id, workspaceId));
      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * List workspaces with filtering.
   */
  async list(options: WorkspaceListOptions = {}): Promise<Result<WorkspaceWithRelations[], Error>> {
    try {
      const { filters = {}, sortBy = 'name', sortOrder = 'asc' } = options;

      // Build where conditions
      let workspaceIds: string[] | null = null;

      // If filtering by user, first get the workspace IDs they're a member of
      if (filters.userId) {
        const memberRows = await this.db
          .select({ workspaceId: workspaceMembers.workspaceId })
          .from(workspaceMembers)
          .where(eq(workspaceMembers.userId, filters.userId));

        workspaceIds = memberRows.map((r) => r.workspaceId);

        if (workspaceIds.length === 0) {
          return ok([]);
        }
      }

      const conditions: SQL[] = [];

      if (workspaceIds) {
        conditions.push(inArray(workspaces.id, workspaceIds));
      }

      if (filters.search) {
        conditions.push(like(workspaces.name, `%${escapeLike(filters.search)}%`));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Build sort clause
      const sortColumn = {
        name: workspaces.name,
        created_at: workspaces.createdAt,
      }[sortBy];

      const orderFn = sortOrder === 'desc' ? desc : asc;

      // Get workspaces
      const workspaceRows = await this.db
        .select()
        .from(workspaces)
        .where(whereClause)
        .orderBy(orderFn(sortColumn));

      // Get all members and project counts
      const wsIds = workspaceRows.map((w) => w.id);

      if (wsIds.length === 0) {
        return ok([]);
      }

      const [allMembers, projectCounts] = await Promise.all([
        this.db
          .select({
            member: workspaceMembers,
            user: users,
          })
          .from(workspaceMembers)
          .innerJoin(users, eq(workspaceMembers.userId, users.id))
          .where(inArray(workspaceMembers.workspaceId, wsIds)),
        this.db
          .select({ workspaceId: projects.workspaceId, count: sql<number>`COUNT(*)::int` })
          .from(projects)
          .where(inArray(projects.workspaceId, wsIds))
          .groupBy(projects.workspaceId),
      ]);

      // Build maps
      const membersMap = new Map<string, WorkspaceMemberWithUser[]>();
      const projectCountMap = new Map<string, number>();

      for (const row of allMembers) {
        const existing = membersMap.get(row.member.workspaceId) || [];
        existing.push({ ...row.member, user: row.user });
        membersMap.set(row.member.workspaceId, existing);
      }

      for (const pc of projectCounts) {
        projectCountMap.set(pc.workspaceId, pc.count);
      }

      // Build result
      const result: WorkspaceWithRelations[] = workspaceRows.map((workspace) => ({
        ...workspace,
        members: membersMap.get(workspace.id) || [],
        projectCount: projectCountMap.get(workspace.id) ?? 0,
      }));

      return ok(result);
    } catch (error) {
      return err(toError(error));
    }
  }

  async getAgentAiSettings(workspaceId: string): Promise<Result<WorkspaceAiSettings, Error>> {
    try {
      const [workspace] = await this.db
        .select({
          allowedAgentModels: workspaces.allowedAgentModels,
          defaultAgentId: workspaces.defaultAgentId,
        })
        .from(workspaces)
        .where(eq(workspaces.id, workspaceId));

      if (!workspace) {
        return err(new DomainError('NOT_FOUND', 'Workspace not found'));
      }

      const sanitizedModels = this.normalizeAllowedModels(workspace.allowedAgentModels);

      return ok({
        allowedModels: sanitizedModels,
        defaultAgentId: workspace.defaultAgentId,
      });
    } catch (error) {
      return err(toError(error));
    }
  }

  async updateAgentAiSettings(
    workspaceId: string,
    input: UpdateWorkspaceAiSettings
  ): Promise<Result<WorkspaceAiSettings, Error>> {
    try {
      const [updated] = await this.db
        .update(workspaces)
        .set({
          allowedAgentModels: this.normalizeAllowedModels(input.allowedModels),
          defaultAgentId: input.defaultAgentId,
        })
        .where(eq(workspaces.id, workspaceId))
        .returning({ id: workspaces.id });

      if (!updated) {
        return err(new DomainError('NOT_FOUND', 'Workspace not found'));
      }

      return this.getAgentAiSettings(workspaceId);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * List recent task activity for a workspace.
   */
  async listActivity(
    workspaceId: string,
    options: WorkspaceActivityListOptions = {}
  ): Promise<
    Result<
      { items: WorkspaceActivityItem[]; nextCursor: WorkspaceActivityCursorInput | null },
      Error
    >
  > {
    try {
      const limit = Math.max(1, Math.min(100, options.limit ?? 20));
      const conditions: SQL[] = [eq(projects.workspaceId, workspaceId)];

      if (options.projectIds) {
        if (options.projectIds.length === 0) {
          return ok({ items: [], nextCursor: null });
        }
        conditions.push(inArray(projects.id, [...options.projectIds]));
      }

      if (options.cursor) {
        conditions.push(
          or(
            lt(taskEvents.createdAt, options.cursor.createdAt),
            and(
              eq(taskEvents.createdAt, options.cursor.createdAt),
              lt(taskEvents.id, options.cursor.id)
            )
          )!
        );
      }

      const rows = await this.db
        .select({
          id: taskEvents.id,
          createdAt: taskEvents.createdAt,
          eventType: taskEvents.eventType,
          fieldName: taskEvents.fieldName,
          task: {
            id: tasks.id,
            title: tasks.title,
            sequenceNumber: tasks.sequenceNumber,
          },
          project: {
            id: projects.id,
            identifier: projects.identifier,
            name: projects.name,
          },
          actor: {
            id: users.id,
            name: users.name,
            email: users.email,
          },
          mcpClient: {
            id: mcpOAuthClients.clientId,
            name: mcpOAuthClients.clientName,
          },
          mcpClientId: taskEvents.mcpClientId,
        })
        .from(taskEvents)
        .innerJoin(tasks, eq(taskEvents.taskId, tasks.id))
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .leftJoin(users, eq(taskEvents.actorId, users.id))
        .leftJoin(mcpOAuthClients, eq(taskEvents.mcpClientId, mcpOAuthClients.clientId))
        .where(and(...conditions))
        .orderBy(desc(taskEvents.createdAt), desc(taskEvents.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const pageRows = rows.slice(0, limit);

      const items: WorkspaceActivityItem[] = pageRows.map((row) => {
        const actor = row.actor;

        return {
          id: row.id,
          createdAt: row.createdAt,
          eventType: row.eventType as WorkspaceActivityItem['eventType'],
          fieldName: row.fieldName,
          task: {
            id: row.task.id,
            title: row.task.title,
            sequenceNumber: row.task.sequenceNumber,
            project: row.project,
          },
          actor:
            actor?.id && actor.email
              ? {
                  id: actor.id,
                  name: actor.name,
                  email: actor.email,
                }
              : null,
          agent: row.mcpClient?.id
            ? {
                id: row.mcpClient.id,
                name: row.mcpClient.name,
              }
            : null,
        };
      });

      const last = items[items.length - 1] || null;
      const nextCursor = hasMore && last ? { createdAt: last.createdAt, id: last.id } : null;

      return ok({ items, nextCursor });
    } catch (error) {
      return err(toError(error));
    }
  }

  // === Member Management ===
  //
  // Role changes are authorized here (not only in routes) so every caller gets
  // the owner-escalation rules: only an owner may grant/revoke `owner` or touch
  // an owner, and everyone else may only assign roles at or below their own.
  // Each mutation runs in a transaction that locks the workspace's member rows,
  // so concurrent demotions/removals cannot leave a workspace without an owner.

  /**
   * Add a member to a workspace. `addedBy` must be a member allowed to grant `role`.
   */
  async addMember(input: AddMemberInput): Promise<Result<WorkspaceMemberWithUser, Error>> {
    try {
      return await this.db.transaction(async (tx) => {
        const members = await this.lockMembers(tx, input.workspaceId);
        const actorRole = members.get(input.addedBy) ?? null;
        if (!actorRole) {
          return err(new DomainError('FORBIDDEN', 'Not a workspace member'));
        }
        const decision = canGrantRole(actorRole, input.role);
        if (!decision.allowed) {
          return err(new DomainError('FORBIDDEN', decision.reason));
        }
        if (members.has(input.userId)) {
          return err(new DomainError('CONFLICT', 'User is already a member'));
        }

        const [user] = await tx.select().from(users).where(eq(users.id, input.userId));
        if (!user) {
          return err(new DomainError('NOT_FOUND', 'User not found'));
        }

        const [member] = await tx
          .insert(workspaceMembers)
          .values({ workspaceId: input.workspaceId, userId: input.userId, role: input.role })
          .onConflictDoNothing()
          .returning();
        if (!member) {
          return err(new DomainError('CONFLICT', 'User is already a member'));
        }
        return ok({ ...member, user });
      });
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Change a member's role. `updatedBy` must be allowed to make the change.
   */
  async updateMember(input: UpdateMemberInput): Promise<Result<WorkspaceMemberWithUser, Error>> {
    try {
      return await this.db.transaction(async (tx) => {
        const members = await this.lockMembers(tx, input.workspaceId);
        const actorRole = members.get(input.updatedBy) ?? null;
        if (!actorRole) {
          return err(new DomainError('FORBIDDEN', 'Not a workspace member'));
        }
        const targetRole = members.get(input.userId);
        if (!targetRole) {
          return err(new DomainError('NOT_FOUND', 'Member not found'));
        }
        const decision = canChangeRole(actorRole, targetRole, input.role);
        if (!decision.allowed) {
          return err(new DomainError('FORBIDDEN', decision.reason));
        }
        if (targetRole === 'owner' && input.role !== 'owner' && countOwners(members) <= 1) {
          return err(new DomainError('CONFLICT', 'Cannot demote the last owner'));
        }

        const [updated] = await tx
          .update(workspaceMembers)
          .set({ role: input.role })
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.userId)
            )
          )
          .returning();
        const [user] = await tx.select().from(users).where(eq(users.id, input.userId));
        if (!updated || !user) {
          return err(new DomainError('NOT_FOUND', 'Member not found'));
        }
        return ok({ ...updated, user });
      });
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Remove a member (or leave, when `removedBy === userId`).
   */
  async removeMember(input: RemoveMemberInput): Promise<Result<void, Error>> {
    try {
      return await this.db.transaction(async (tx) => {
        const members = await this.lockMembers(tx, input.workspaceId);
        const targetRole = members.get(input.userId);
        if (!targetRole) {
          return err(new DomainError('NOT_FOUND', 'Member not found'));
        }
        const isSelf = input.removedBy === input.userId;
        const decision = canRemoveMember(members.get(input.removedBy) ?? null, targetRole, isSelf);
        if (!decision.allowed) {
          return err(new DomainError('FORBIDDEN', decision.reason));
        }
        if (targetRole === 'owner' && countOwners(members) <= 1) {
          return err(new DomainError('CONFLICT', 'Cannot remove the last owner'));
        }

        await tx
          .delete(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.userId)
            )
          );
        // Project-level ACL entries are meaningless without workspace membership.
        const workspaceProjectIds = tx
          .select({ id: projects.id })
          .from(projects)
          .where(eq(projects.workspaceId, input.workspaceId));
        await tx
          .delete(projectMembers)
          .where(
            and(
              eq(projectMembers.userId, input.userId),
              inArray(projectMembers.projectId, workspaceProjectIds)
            )
          );
        return ok(undefined);
      });
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Hand ownership to another member. Only an owner may do this; the previous
   * owner becomes an admin.
   */
  async transferOwnership(
    input: TransferOwnershipInput
  ): Promise<Result<WorkspaceMemberWithUser, Error>> {
    try {
      return await this.db.transaction(async (tx) => {
        const members = await this.lockMembers(tx, input.workspaceId);
        if (members.get(input.fromUserId) !== 'owner') {
          return err(new DomainError('FORBIDDEN', 'Only an owner can transfer ownership'));
        }
        if (input.fromUserId === input.toUserId) {
          return err(new DomainError('BAD_REQUEST', 'You already own this workspace'));
        }
        if (!members.has(input.toUserId)) {
          return err(new DomainError('NOT_FOUND', 'The new owner must be a workspace member'));
        }

        const [promoted] = await tx
          .update(workspaceMembers)
          .set({ role: 'owner' })
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.toUserId)
            )
          )
          .returning();
        await tx
          .update(workspaceMembers)
          .set({ role: 'admin' })
          .where(
            and(
              eq(workspaceMembers.workspaceId, input.workspaceId),
              eq(workspaceMembers.userId, input.fromUserId)
            )
          );
        const [user] = await tx.select().from(users).where(eq(users.id, input.toUserId));
        if (!promoted || !user) {
          return err(new DomainError('NOT_FOUND', 'Member not found'));
        }
        return ok({ ...promoted, user });
      });
    } catch (error) {
      return err(toError(error));
    }
  }

  /** Lock and return the workspace's members (userId -> role) for a mutation. */
  private async lockMembers(
    tx: Transaction,
    workspaceId: string
  ): Promise<Map<string, WorkspaceRole>> {
    const rows = await tx
      .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.workspaceId, workspaceId))
      .for('update');
    const members = new Map<string, WorkspaceRole>();
    for (const row of rows) {
      if (isWorkspaceRole(row.role)) members.set(row.userId, row.role);
    }
    return members;
  }

  /**
   * Get a user's role in a workspace.
   */
  async getMemberRole(
    workspaceId: string,
    userId: string
  ): Promise<Result<WorkspaceRole | null, Error>> {
    try {
      if (!isUuid(workspaceId) || !isUuid(userId)) {
        return ok(null);
      }
      const [member] = await this.db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId))
        );

      return ok(member && isWorkspaceRole(member.role) ? member.role : null);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Check if a user is a member of a workspace.
   */
  async isMember(workspaceId: string, userId: string): Promise<boolean> {
    const result = await this.getMemberRole(workspaceId, userId);
    return result.ok && result.value !== null;
  }
}
