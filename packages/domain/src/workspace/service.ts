import { eq, and, sql, desc, asc, like, inArray, SQL } from 'drizzle-orm';

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}
import type { Database } from '@flowtask/database';
import { workspaces, workspaceMembers, users, projects } from '@flowtask/database';
import type { Result, WorkspaceRole } from '@flowtask/shared';
import { ok, err } from '@flowtask/shared';
import type {
  WorkspaceWithRelations,
  WorkspaceMemberWithUser,
  WorkspaceCreateInput,
  WorkspaceUpdateInput,
  AddMemberInput,
  UpdateMemberInput,
  RemoveMemberInput,
  WorkspaceListOptions,
} from './types.js';

export class WorkspaceService {
  constructor(private db: Database) {}

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
        return err(new Error(`Workspace with slug "${input.slug}" already exists`));
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
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get a workspace by ID with all relations.
   */
  async getById(workspaceId: string): Promise<Result<WorkspaceWithRelations, Error>> {
    try {
      const [workspace] = await this.db.select().from(workspaces).where(eq(workspaces.id, workspaceId));

      if (!workspace) {
        return err(new Error('Workspace not found'));
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
        .select({ count: sql<number>`COUNT(*)` })
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
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get a workspace by slug.
   */
  async getBySlug(slug: string): Promise<Result<WorkspaceWithRelations, Error>> {
    try {
      const [workspace] = await this.db.select().from(workspaces).where(eq(workspaces.slug, slug));

      if (!workspace) {
        return err(new Error('Workspace not found'));
      }

      return this.getById(workspace.id);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Update a workspace.
   */
  async update(workspaceId: string, input: WorkspaceUpdateInput): Promise<Result<WorkspaceWithRelations, Error>> {
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
      return err(error instanceof Error ? error : new Error('Unknown error'));
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
      return err(error instanceof Error ? error : new Error('Unknown error'));
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
        .orderBy(orderFn(sortColumn!));

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
          .select({ workspaceId: projects.workspaceId, count: sql<number>`COUNT(*)` })
          .from(projects)
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
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  // === Member Management ===

  /**
   * Add a member to a workspace.
   */
  async addMember(input: AddMemberInput): Promise<Result<WorkspaceMemberWithUser, Error>> {
    try {
      const [member] = await this.db
        .insert(workspaceMembers)
        .values({
          workspaceId: input.workspaceId,
          userId: input.userId,
          role: input.role,
        })
        .onConflictDoNothing()
        .returning();

      if (!member) {
        return err(new Error('User is already a member or failed to add'));
      }

      // Get the user info
      const [user] = await this.db.select().from(users).where(eq(users.id, input.userId));

      if (!user) {
        return err(new Error('User not found'));
      }

      return ok({ ...member, user });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Update a member's role.
   */
  async updateMember(input: UpdateMemberInput): Promise<Result<WorkspaceMemberWithUser, Error>> {
    try {
      // Prevent demoting the last owner
      if (input.role !== 'owner') {
        const [ownerCount] = await this.db
          .select({ count: sql<number>`COUNT(*)` })
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.role, 'owner')));

        const [currentMember] = await this.db
          .select()
          .from(workspaceMembers)
          .where(
            and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId))
          );

        if (currentMember?.role === 'owner' && (ownerCount?.count ?? 0) <= 1) {
          return err(new Error('Cannot demote the last owner'));
        }
      }

      const [updated] = await this.db
        .update(workspaceMembers)
        .set({ role: input.role })
        .where(
          and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId))
        )
        .returning();

      if (!updated) {
        return err(new Error('Failed to update member'));
      }

      // Get the user info
      const [user] = await this.db.select().from(users).where(eq(users.id, input.userId));

      if (!user) {
        return err(new Error('User not found'));
      }

      return ok({ ...updated, user });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Remove a member from a workspace.
   */
  async removeMember(input: RemoveMemberInput): Promise<Result<void, Error>> {
    try {
      // Prevent removing the last owner
      const [ownerCount] = await this.db
        .select({ count: sql<number>`COUNT(*)` })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.role, 'owner')));

      const [member] = await this.db
        .select()
        .from(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId))
        );

      if (member?.role === 'owner' && (ownerCount?.count ?? 0) <= 1) {
        return err(new Error('Cannot remove the last owner'));
      }

      await this.db
        .delete(workspaceMembers)
        .where(
          and(eq(workspaceMembers.workspaceId, input.workspaceId), eq(workspaceMembers.userId, input.userId))
        );

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get a user's role in a workspace.
   */
  async getMemberRole(workspaceId: string, userId: string): Promise<Result<WorkspaceRole | null, Error>> {
    try {
      const [member] = await this.db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.userId, userId)));

      return ok((member?.role as WorkspaceRole) || null);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
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
