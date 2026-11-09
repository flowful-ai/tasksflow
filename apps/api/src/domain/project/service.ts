import { escapeLike } from '@flowtask/shared';
import { eq, and, sql, desc, asc, like, inArray, SQL } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import {
  projects,
  taskStates,
  labels,
  projectIntegrations,
  tasks,
  projectMembers,
  users,
  workspaceMembers,
} from '../../db/index.js';
import { generatePosition, positionAfter } from '@flowtask/shared';
import { DEFAULT_TASK_STATES } from '@flowtask/shared';
import type { Result } from '@flowtask/shared';
import { ok, err } from '@flowtask/shared';
import type {
  ProjectWithRelations,
  ProjectCreateInput,
  ProjectUpdateInput,
  TaskStateCreateInput,
  TaskStateUpdateInput,
  LabelCreateInput,
  LabelUpdateInput,
  ProjectListOptions,
} from './types.js';
import { DomainError, toError } from '../workspace/errors.js';
import { isUuid, projectAclAllows } from '../workspace/authorization.js';
import { isAdminRole } from '../workspace/role-policy.js';

export class ProjectService {
  constructor(private db: Database) {}

  /**
   * Create a new project with default task states.
   */
  async create(input: ProjectCreateInput): Promise<Result<ProjectWithRelations, Error>> {
    try {
      // Check for duplicate identifier
      const [existing] = await this.db
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(
            eq(projects.workspaceId, input.workspaceId),
            eq(projects.identifier, input.identifier)
          )
        );

      if (existing) {
        return err(
          new DomainError(
            'CONFLICT',
            `Project with identifier "${input.identifier}" already exists`
          )
        );
      }

      // Create the project
      const [project] = await this.db
        .insert(projects)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          identifier: input.identifier,
          description: input.description || null,
          icon: input.icon || null,
          createdBy: input.createdBy,
        })
        .returning();

      if (!project) {
        return err(new Error('Failed to create project'));
      }

      // Create default task states
      let position = generatePosition();
      const stateValues = DEFAULT_TASK_STATES.map((state) => {
        const value = {
          projectId: project.id,
          name: state.name,
          category: state.category,
          position,
          color: state.color,
        };
        position = positionAfter(position);
        return value;
      });

      await this.db.insert(taskStates).values(stateValues);

      return this.getById(project.id);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Get a project by ID with all relations.
   */
  async getById(projectId: string): Promise<Result<ProjectWithRelations, Error>> {
    try {
      if (!isUuid(projectId)) {
        return err(new DomainError('NOT_FOUND', 'Project not found'));
      }
      const [project] = await this.db.select().from(projects).where(eq(projects.id, projectId));

      if (!project) {
        return err(new DomainError('NOT_FOUND', 'Project not found'));
      }

      // Get task states
      const states = await this.db
        .select()
        .from(taskStates)
        .where(eq(taskStates.projectId, projectId))
        .orderBy(asc(taskStates.position));

      // Get labels
      const projectLabels = await this.db
        .select()
        .from(labels)
        .where(eq(labels.projectId, projectId))
        .orderBy(asc(labels.name));

      // Get integrations
      const integrations = await this.db
        .select()
        .from(projectIntegrations)
        .where(eq(projectIntegrations.projectId, projectId));

      // Get task count
      const [countResult] = await this.db
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(tasks)
        .where(eq(tasks.projectId, projectId));

      return ok({
        ...project,
        taskStates: states,
        labels: projectLabels,
        integrations,
        taskCount: countResult?.count ?? 0,
      });
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Update a project.
   */
  async update(
    projectId: string,
    input: ProjectUpdateInput
  ): Promise<Result<ProjectWithRelations, Error>> {
    try {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.icon !== undefined) updateData.icon = input.icon;
      if (input.isArchived !== undefined) updateData.isArchived = input.isArchived;

      const [updated] = await this.db
        .update(projects)
        .set(updateData)
        .where(eq(projects.id, projectId))
        .returning();

      if (!updated) {
        return err(new Error('Failed to update project'));
      }

      return this.getById(projectId);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Delete a project (cascades to all related data).
   */
  async delete(projectId: string): Promise<Result<void, Error>> {
    try {
      await this.db.delete(projects).where(eq(projects.id, projectId));
      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * List projects with filtering.
   */
  async list(options: ProjectListOptions = {}): Promise<Result<ProjectWithRelations[], Error>> {
    try {
      const { filters = {}, sortBy = 'name', sortOrder = 'asc' } = options;

      // Build where conditions
      const conditions: SQL[] = [];

      if (filters.workspaceId) {
        conditions.push(eq(projects.workspaceId, filters.workspaceId));
      }

      if (!filters.includeArchived) {
        conditions.push(eq(projects.isArchived, false));
      }

      if (filters.search) {
        conditions.push(like(projects.name, `%${escapeLike(filters.search)}%`));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Build sort clause
      const sortColumn = {
        name: projects.name,
        created_at: projects.createdAt,
        updated_at: projects.updatedAt,
      }[sortBy];

      const orderFn = sortOrder === 'desc' ? desc : asc;

      // Get projects
      const projectRows = await this.db
        .select()
        .from(projects)
        .where(whereClause)
        .orderBy(orderFn(sortColumn));

      // Get all related data
      const projectIds = projectRows.map((p) => p.id);

      if (projectIds.length === 0) {
        return ok([]);
      }

      // Get states, labels, integrations, and task counts — scoped to just the
      // projects fetched above. Without these WHERE clauses every query scans
      // and returns rows for every project across all workspaces.
      const [allStates, allLabels, allIntegrations, taskCounts] = await Promise.all([
        this.db
          .select()
          .from(taskStates)
          .where(inArray(taskStates.projectId, projectIds))
          .orderBy(asc(taskStates.position)),
        this.db
          .select()
          .from(labels)
          .where(inArray(labels.projectId, projectIds))
          .orderBy(asc(labels.name)),
        this.db
          .select()
          .from(projectIntegrations)
          .where(inArray(projectIntegrations.projectId, projectIds)),
        this.db
          .select({ projectId: tasks.projectId, count: sql<number>`COUNT(*)::int` })
          .from(tasks)
          .where(inArray(tasks.projectId, projectIds))
          .groupBy(tasks.projectId),
      ]);

      // Build maps
      const statesMap = new Map<string, (typeof taskStates.$inferSelect)[]>();
      const labelsMap = new Map<string, (typeof labels.$inferSelect)[]>();
      const integrationsMap = new Map<string, (typeof projectIntegrations.$inferSelect)[]>();
      const taskCountMap = new Map<string, number>();

      for (const state of allStates) {
        const existing = statesMap.get(state.projectId) || [];
        existing.push(state);
        statesMap.set(state.projectId, existing);
      }

      for (const label of allLabels) {
        const existing = labelsMap.get(label.projectId) || [];
        existing.push(label);
        labelsMap.set(label.projectId, existing);
      }

      for (const integration of allIntegrations) {
        const existing = integrationsMap.get(integration.projectId) || [];
        existing.push(integration);
        integrationsMap.set(integration.projectId, existing);
      }

      for (const tc of taskCounts) {
        taskCountMap.set(tc.projectId, tc.count);
      }

      // Filter by access control if userId and role are provided
      let filteredRows = projectRows;
      if (filters.userId && filters.workspaceRole && !isAdminRole(filters.workspaceRole)) {
        // Members need access checks; owners/admins see everything
        const restrictedProjectIds = filteredRows
          .filter((p) => p.access !== 'all')
          .map((p) => p.id);

        if (restrictedProjectIds.length > 0) {
          // Get project_members entries for this user among restricted projects
          const memberEntries = await this.db
            .select({ projectId: projectMembers.projectId })
            .from(projectMembers)
            .where(
              and(
                inArray(projectMembers.projectId, restrictedProjectIds),
                eq(projectMembers.userId, filters.userId)
              )
            );
          const memberOfSet = new Set(memberEntries.map((m) => m.projectId));

          filteredRows = filteredRows.filter((p) =>
            projectAclAllows(p.access, 'member', memberOfSet.has(p.id))
          );
        }
      }

      // Build result
      const result: ProjectWithRelations[] = filteredRows.map((project) => ({
        ...project,
        taskStates: statesMap.get(project.id) || [],
        labels: labelsMap.get(project.id) || [],
        integrations: integrationsMap.get(project.id) || [],
        taskCount: taskCountMap.get(project.id) ?? 0,
      }));

      return ok(result);
    } catch (error) {
      return err(toError(error));
    }
  }

  // === Task State Management ===

  /**
   * Create a new task state.
   */
  async createTaskState(
    input: TaskStateCreateInput
  ): Promise<Result<typeof taskStates.$inferSelect, Error>> {
    try {
      // Get the last position
      const [lastState] = await this.db
        .select({ position: taskStates.position })
        .from(taskStates)
        .where(eq(taskStates.projectId, input.projectId))
        .orderBy(desc(taskStates.position))
        .limit(1);

      const position = positionAfter(lastState?.position);

      const [state] = await this.db
        .insert(taskStates)
        .values({
          projectId: input.projectId,
          name: input.name,
          category: input.category,
          position,
          color: input.color || null,
        })
        .returning();

      if (!state) {
        return err(new Error('Failed to create task state'));
      }

      return ok(state);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Update a task state. Scoped to `projectId` so a state of another project
   * (or workspace) can never be modified through this project.
   */
  async updateTaskState(
    projectId: string,
    stateId: string,
    input: TaskStateUpdateInput
  ): Promise<Result<typeof taskStates.$inferSelect, Error>> {
    try {
      if (!isUuid(stateId)) {
        return err(new DomainError('NOT_FOUND', 'Task state not found'));
      }
      const updateData: Partial<typeof taskStates.$inferInsert> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.color !== undefined) updateData.color = input.color;

      const scope = and(eq(taskStates.id, stateId), eq(taskStates.projectId, projectId));
      const [updated] =
        Object.keys(updateData).length > 0
          ? await this.db.update(taskStates).set(updateData).where(scope).returning()
          : await this.db.select().from(taskStates).where(scope);

      if (!updated) {
        return err(new DomainError('NOT_FOUND', 'Task state not found'));
      }

      return ok(updated);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Delete a task state of `projectId` (its tasks get a null state).
   */
  async deleteTaskState(projectId: string, stateId: string): Promise<Result<void, Error>> {
    try {
      if (!isUuid(stateId)) {
        return err(new DomainError('NOT_FOUND', 'Task state not found'));
      }
      return await this.db.transaction(async (tx) => {
        const scope = and(eq(taskStates.id, stateId), eq(taskStates.projectId, projectId));
        const [state] = await tx
          .select({ id: taskStates.id })
          .from(taskStates)
          .where(scope)
          .for('update');
        if (!state) {
          return err(new DomainError('NOT_FOUND', 'Task state not found'));
        }
        // Before the delete: the FK's ON DELETE SET NULL would leave nothing
        // matching `state_id = stateId` afterwards, and completedAt stale.
        await tx
          .update(tasks)
          .set({ stateId: null, completedAt: null })
          .where(eq(tasks.stateId, stateId));
        await tx.delete(taskStates).where(scope);
        return ok(undefined);
      });
    } catch (error) {
      return err(toError(error));
    }
  }

  // === Label Management ===

  /**
   * Create a new label.
   */
  async createLabel(input: LabelCreateInput): Promise<Result<typeof labels.$inferSelect, Error>> {
    try {
      const [label] = await this.db
        .insert(labels)
        .values({
          projectId: input.projectId,
          name: input.name,
          color: input.color || null,
        })
        .returning();

      if (!label) {
        return err(new Error('Failed to create label'));
      }

      return ok(label);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Update a label. Scoped to `projectId` (see updateTaskState).
   */
  async updateLabel(
    projectId: string,
    labelId: string,
    input: LabelUpdateInput
  ): Promise<Result<typeof labels.$inferSelect, Error>> {
    try {
      if (!isUuid(labelId)) {
        return err(new DomainError('NOT_FOUND', 'Label not found'));
      }
      const updateData: Partial<typeof labels.$inferInsert> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.color !== undefined) updateData.color = input.color;

      const scope = and(eq(labels.id, labelId), eq(labels.projectId, projectId));
      const [updated] =
        Object.keys(updateData).length > 0
          ? await this.db.update(labels).set(updateData).where(scope).returning()
          : await this.db.select().from(labels).where(scope);

      if (!updated) {
        return err(new DomainError('NOT_FOUND', 'Label not found'));
      }

      return ok(updated);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Delete a label of `projectId` (removes it from all tasks).
   */
  async deleteLabel(projectId: string, labelId: string): Promise<Result<void, Error>> {
    try {
      if (!isUuid(labelId)) {
        return err(new DomainError('NOT_FOUND', 'Label not found'));
      }
      const [deleted] = await this.db
        .delete(labels)
        .where(and(eq(labels.id, labelId), eq(labels.projectId, projectId)))
        .returning({ id: labels.id });
      if (!deleted) {
        return err(new DomainError('NOT_FOUND', 'Label not found'));
      }
      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }

  // === Access Control ===

  /**
   * Get project members with user details.
   */
  async getMembers(projectId: string): Promise<
    Result<
      {
        id: string;
        projectId: string;
        userId: string;
        createdAt: Date;
        user: { id: string; email: string; name: string | null; avatarUrl: string | null };
      }[],
      Error
    >
  > {
    try {
      const rows = await this.db
        .select({
          id: projectMembers.id,
          projectId: projectMembers.projectId,
          userId: projectMembers.userId,
          createdAt: projectMembers.createdAt,
          user: {
            id: users.id,
            email: users.email,
            name: users.name,
            avatarUrl: users.avatarUrl,
          },
        })
        .from(projectMembers)
        .innerJoin(users, eq(projectMembers.userId, users.id))
        .where(eq(projectMembers.projectId, projectId));

      return ok(rows);
    } catch (error) {
      return err(toError(error));
    }
  }

  /**
   * Set the access mode and member list for a project.
   * If access is not 'members', the members list is cleared.
   */
  async setAccess(
    projectId: string,
    access: 'all' | 'admin' | 'members',
    userIds?: string[]
  ): Promise<Result<void, Error>> {
    try {
      const uniqueUserIds = [...new Set(userIds ?? [])];
      if (access === 'members' && uniqueUserIds.length > 0) {
        const [project] = await this.db
          .select({ workspaceId: projects.workspaceId })
          .from(projects)
          .where(eq(projects.id, projectId));
        if (!project) {
          return err(new DomainError('NOT_FOUND', 'Project not found'));
        }
        const memberRows = await this.db
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(
            and(
              eq(workspaceMembers.workspaceId, project.workspaceId),
              inArray(workspaceMembers.userId, uniqueUserIds)
            )
          );
        if (memberRows.length !== uniqueUserIds.length) {
          return err(
            new DomainError('BAD_REQUEST', 'All project members must be workspace members')
          );
        }
      }

      await this.db.transaction(async (tx) => {
        // Update access column
        await tx
          .update(projects)
          .set({ access, updatedAt: new Date() })
          .where(eq(projects.id, projectId));

        // Clear existing members
        await tx.delete(projectMembers).where(eq(projectMembers.projectId, projectId));

        // Insert new members if access === 'members' and userIds provided
        if (access === 'members' && uniqueUserIds.length > 0) {
          await tx.insert(projectMembers).values(
            uniqueUserIds.map((userId) => ({
              projectId,
              userId,
            }))
          );
        }
      });

      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }
}
