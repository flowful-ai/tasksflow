import { eq, and, sql, desc, asc, like, SQL } from 'drizzle-orm';
import type { Database } from '@flowtask/database';
import { projects, taskStates, labels, projectIntegrations, tasks } from '@flowtask/database';
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
        .where(and(eq(projects.workspaceId, input.workspaceId), eq(projects.identifier, input.identifier)));

      if (existing) {
        return err(new Error(`Project with identifier "${input.identifier}" already exists`));
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
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get a project by ID with all relations.
   */
  async getById(projectId: string): Promise<Result<ProjectWithRelations, Error>> {
    try {
      const [project] = await this.db.select().from(projects).where(eq(projects.id, projectId));

      if (!project) {
        return err(new Error('Project not found'));
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
        .select({ count: sql<number>`COUNT(*)` })
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
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Update a project.
   */
  async update(projectId: string, input: ProjectUpdateInput): Promise<Result<ProjectWithRelations, Error>> {
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
      return err(error instanceof Error ? error : new Error('Unknown error'));
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
      return err(error instanceof Error ? error : new Error('Unknown error'));
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
        conditions.push(like(projects.name, `%${filters.search}%`));
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
        .orderBy(orderFn(sortColumn!));

      // Get all related data
      const projectIds = projectRows.map((p) => p.id);

      if (projectIds.length === 0) {
        return ok([]);
      }

      // Get states, labels, integrations, and task counts for all projects
      const [allStates, allLabels, allIntegrations, taskCounts] = await Promise.all([
        this.db.select().from(taskStates).orderBy(asc(taskStates.position)),
        this.db.select().from(labels).orderBy(asc(labels.name)),
        this.db.select().from(projectIntegrations),
        this.db
          .select({ projectId: tasks.projectId, count: sql<number>`COUNT(*)` })
          .from(tasks)
          .groupBy(tasks.projectId),
      ]);

      // Build maps
      const statesMap = new Map<string, typeof taskStates.$inferSelect[]>();
      const labelsMap = new Map<string, typeof labels.$inferSelect[]>();
      const integrationsMap = new Map<string, typeof projectIntegrations.$inferSelect[]>();
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

      // Build result
      const result: ProjectWithRelations[] = projectRows.map((project) => ({
        ...project,
        taskStates: statesMap.get(project.id) || [],
        labels: labelsMap.get(project.id) || [],
        integrations: integrationsMap.get(project.id) || [],
        taskCount: taskCountMap.get(project.id) ?? 0,
      }));

      return ok(result);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  // === Task State Management ===

  /**
   * Create a new task state.
   */
  async createTaskState(input: TaskStateCreateInput): Promise<Result<typeof taskStates.$inferSelect, Error>> {
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
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Update a task state.
   */
  async updateTaskState(stateId: string, input: TaskStateUpdateInput): Promise<Result<typeof taskStates.$inferSelect, Error>> {
    try {
      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.color !== undefined) updateData.color = input.color;

      const [updated] = await this.db
        .update(taskStates)
        .set(updateData)
        .where(eq(taskStates.id, stateId))
        .returning();

      if (!updated) {
        return err(new Error('Failed to update task state'));
      }

      return ok(updated);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Delete a task state (sets tasks to null state).
   */
  async deleteTaskState(stateId: string): Promise<Result<void, Error>> {
    try {
      // Update tasks to remove the state reference
      await this.db.update(tasks).set({ stateId: null }).where(eq(tasks.stateId, stateId));

      // Delete the state
      await this.db.delete(taskStates).where(eq(taskStates.id, stateId));

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
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
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Update a label.
   */
  async updateLabel(labelId: string, input: LabelUpdateInput): Promise<Result<typeof labels.$inferSelect, Error>> {
    try {
      const updateData: Record<string, unknown> = {};
      if (input.name !== undefined) updateData.name = input.name;
      if (input.color !== undefined) updateData.color = input.color;

      const [updated] = await this.db
        .update(labels)
        .set(updateData)
        .where(eq(labels.id, labelId))
        .returning();

      if (!updated) {
        return err(new Error('Failed to update label'));
      }

      return ok(updated);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Delete a label (removes from all tasks).
   */
  async deleteLabel(labelId: string): Promise<Result<void, Error>> {
    try {
      await this.db.delete(labels).where(eq(labels.id, labelId));
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }
}
