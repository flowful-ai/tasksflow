import { eq, and, or, inArray, isNull, sql, desc, asc, ilike, lt, gt, SQL } from 'drizzle-orm';

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}
import type { Database } from '@flowtask/database';
import {
  tasks,
  taskStates,
  taskAssignees,
  taskLabels,
  taskEvents,
  labels,
  users,
  projects,
  workspaceAgents,
  externalLinks,
} from '@flowtask/database';
import { generatePosition, positionAfter, positionBetween } from '@flowtask/shared';
import type { Result } from '@flowtask/shared';
import { ok, err } from '@flowtask/shared';
import type {
  TaskWithRelations,
  TaskCreateInput,
  TaskUpdateInput,
  TaskMoveInput,
  TaskFilters,
  TaskListOptions,
  TaskEventInput,
} from './types.js';

export function taskListNeedsAssigneeJoin(
  filters: TaskFilters,
  requiredJoins: Set<'task_states' | 'task_assignees' | 'task_labels'>
): boolean {
  return requiredJoins.has('task_assignees') || Boolean(filters.assigneeId) || Boolean(filters.assigneeIds?.length);
}

export function buildTaskAssigneeConditions(filters: TaskFilters): SQL[] {
  const conditions: SQL[] = [];

  if (filters.assigneeId) {
    conditions.push(eq(taskAssignees.userId, filters.assigneeId));
  }

  if (filters.assigneeIds?.length) {
    conditions.push(inArray(taskAssignees.userId, filters.assigneeIds));
  }

  return conditions;
}

export class TaskService {
  constructor(private db: Database) {}

  /**
   * Create a new task in a project.
   */
  async create(input: TaskCreateInput): Promise<Result<TaskWithRelations, Error>> {
    try {
      // Default to first backlog state if stateId not provided
      let stateId = input.stateId;
      if (!stateId) {
        const [defaultState] = await this.db
          .select({ id: taskStates.id })
          .from(taskStates)
          .where(
            and(
              eq(taskStates.projectId, input.projectId),
              eq(taskStates.category, 'backlog')
            )
          )
          .orderBy(asc(taskStates.position))
          .limit(1);

        if (defaultState) {
          stateId = defaultState.id;
        }
      }

      // Get the next sequence number for the project
      const [maxSeq] = await this.db
        .select({ maxSeq: sql<number>`COALESCE(MAX(${tasks.sequenceNumber}), 0)` })
        .from(tasks)
        .where(eq(tasks.projectId, input.projectId));

      const sequenceNumber = (maxSeq?.maxSeq ?? 0) + 1;

      // Get the last position in the target state (or globally if no state specified)
      let position: string;
      if (stateId) {
        const [lastTask] = await this.db
          .select({ position: tasks.position })
          .from(tasks)
          .where(and(eq(tasks.projectId, input.projectId), eq(tasks.stateId, stateId)))
          .orderBy(desc(tasks.position))
          .limit(1);
        position = positionAfter(lastTask?.position);
      } else {
        position = generatePosition();
      }

      // Create the task
      const [task] = await this.db
        .insert(tasks)
        .values({
          projectId: input.projectId,
          stateId: stateId || null,
          sequenceNumber,
          title: input.title,
          description: input.description || null,
          priority: input.priority || null,
          position,
          dueDate: input.dueDate || null,
          startDate: input.startDate || null,
          createdBy: input.createdBy,
          agentId: input.agentId || null,
        })
        .returning();

      if (!task) {
        return err(new Error('Failed to create task'));
      }

      // Add assignees if provided
      if (input.assigneeIds?.length) {
        await this.db.insert(taskAssignees).values(
          input.assigneeIds.map((userId) => ({
            taskId: task.id,
            userId,
          }))
        );
      }

      // Add labels if provided
      if (input.labelIds?.length) {
        await this.db.insert(taskLabels).values(
          input.labelIds.map((labelId) => ({
            taskId: task.id,
            labelId,
          }))
        );
      }

      // Record the creation event
      await this.recordEvent({
        taskId: task.id,
        actorId: input.createdBy,
        eventType: 'created',
      });

      // Return the task with relations
      return this.getById(task.id);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get a task by ID with all relations.
   */
  async getById(taskId: string): Promise<Result<TaskWithRelations, Error>> {
    try {
      const [task] = await this.db
        .select({
          task: tasks,
          state: taskStates,
          project: {
            id: projects.id,
            identifier: projects.identifier,
            name: projects.name,
          },
          agent: {
            id: workspaceAgents.id,
            name: workspaceAgents.name,
          },
        })
        .from(tasks)
        .leftJoin(taskStates, eq(tasks.stateId, taskStates.id))
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .leftJoin(workspaceAgents, eq(tasks.agentId, workspaceAgents.id))
        .where(eq(tasks.id, taskId));

      if (!task) {
        return err(new Error('Task not found'));
      }

      // Get assignees
      const assigneeRows = await this.db
        .select({ user: users })
        .from(taskAssignees)
        .innerJoin(users, eq(taskAssignees.userId, users.id))
        .where(eq(taskAssignees.taskId, taskId));

      // Get labels
      const labelRows = await this.db
        .select({ label: labels })
        .from(taskLabels)
        .innerJoin(labels, eq(taskLabels.labelId, labels.id))
        .where(eq(taskLabels.taskId, taskId));

      // Get external links (GitHub issues/PRs)
      const externalLinkRows = await this.db
        .select()
        .from(externalLinks)
        .where(eq(externalLinks.taskId, taskId));

      return ok({
        ...task.task,
        state: task.state,
        project: task.project,
        assignees: assigneeRows.map((r) => r.user),
        labels: labelRows.map((r) => r.label),
        agent: task.agent?.id ? task.agent : null,
        externalLinks: externalLinkRows.map((r) => ({
          id: r.id,
          externalType: r.externalType as 'github_issue' | 'github_pr',
          externalId: r.externalId,
          externalUrl: r.externalUrl,
        })),
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Update a task.
   */
  async update(taskId: string, input: TaskUpdateInput): Promise<Result<TaskWithRelations, Error>> {
    try {
      // Get current task for event logging
      const currentResult = await this.getById(taskId);
      if (!currentResult.ok) {
        return currentResult;
      }
      const current = currentResult.value;

      // Build update object
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.title !== undefined) updateData.title = input.title;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.stateId !== undefined) updateData.stateId = input.stateId;
      if (input.priority !== undefined) updateData.priority = input.priority;
      if (input.position !== undefined) updateData.position = input.position;
      if (input.dueDate !== undefined) updateData.dueDate = input.dueDate;
      if (input.startDate !== undefined) updateData.startDate = input.startDate;

      const [updated] = await this.db
        .update(tasks)
        .set(updateData)
        .where(eq(tasks.id, taskId))
        .returning();

      if (!updated) {
        return err(new Error('Failed to update task'));
      }

      // Record update events for changed fields
      const fieldsToTrack = ['title', 'description', 'stateId', 'priority', 'dueDate', 'startDate'];
      for (const field of fieldsToTrack) {
        if (input[field as keyof TaskUpdateInput] !== undefined) {
          const oldValue = current[field as keyof typeof current];
          const newValue = input[field as keyof TaskUpdateInput];
          if (oldValue !== newValue) {
            await this.recordEvent({
              taskId,
              actorId: input.updatedBy,
              eventType: 'updated',
              fieldName: field,
              oldValue,
              newValue,
            });
          }
        }
      }

      return this.getById(taskId);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Move a task to a new state and/or position.
   */
  async move(taskId: string, input: TaskMoveInput): Promise<Result<TaskWithRelations, Error>> {
    try {
      const currentResult = await this.getById(taskId);
      if (!currentResult.ok) {
        return currentResult;
      }
      const current = currentResult.value;

      const [updated] = await this.db
        .update(tasks)
        .set({
          stateId: input.stateId,
          position: input.position,
          updatedAt: new Date(),
        })
        .where(eq(tasks.id, taskId))
        .returning();

      if (!updated) {
        return err(new Error('Failed to move task'));
      }

      // Record move event if state changed
      if (current.stateId !== input.stateId) {
        await this.recordEvent({
          taskId,
          actorId: input.movedBy,
          eventType: 'moved',
          fieldName: 'stateId',
          oldValue: current.stateId,
          newValue: input.stateId,
        });
      }

      return this.getById(taskId);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Soft delete a task.
   */
  async delete(taskId: string, deletedBy: string | null): Promise<Result<void, Error>> {
    try {
      await this.db
        .update(tasks)
        .set({ deletedAt: new Date() })
        .where(eq(tasks.id, taskId));

      await this.recordEvent({
        taskId,
        actorId: deletedBy,
        eventType: 'deleted',
      });

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Restore a soft-deleted task.
   */
  async restore(taskId: string, restoredBy: string | null): Promise<Result<TaskWithRelations, Error>> {
    try {
      await this.db.update(tasks).set({ deletedAt: null }).where(eq(tasks.id, taskId));

      await this.recordEvent({
        taskId,
        actorId: restoredBy,
        eventType: 'restored',
      });

      return this.getById(taskId);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * List tasks with filtering and pagination.
   */
  async list(options: TaskListOptions = {}): Promise<Result<{ tasks: TaskWithRelations[]; total: number }, Error>> {
    try {
      const { filters = {}, filterSql, requiredJoins = new Set(), sortBy = 'position', sortOrder = 'asc', page = 1, limit = 50 } = options;

      // Build where conditions
      const conditions: SQL[] = [];

      if (!filters.includeDeleted) {
        conditions.push(isNull(tasks.deletedAt));
      }

      if (filters.projectId) {
        conditions.push(eq(tasks.projectId, filters.projectId));
      }

      if (filters.projectIds?.length) {
        conditions.push(inArray(tasks.projectId, filters.projectIds));
      }

      if (filters.stateId) {
        conditions.push(eq(tasks.stateId, filters.stateId));
      }

      if (filters.stateIds?.length) {
        conditions.push(inArray(tasks.stateId, filters.stateIds));
      }

      conditions.push(...buildTaskAssigneeConditions(filters));

      if (filters.priority) {
        conditions.push(eq(tasks.priority, filters.priority));
      }

      if (filters.priorities?.length) {
        conditions.push(inArray(tasks.priority, filters.priorities));
      }

      if (filters.createdBy) {
        conditions.push(eq(tasks.createdBy, filters.createdBy));
      }

      if (filters.dueBefore) {
        conditions.push(lt(tasks.dueDate, filters.dueBefore));
      }

      if (filters.dueAfter) {
        conditions.push(gt(tasks.dueDate, filters.dueAfter));
      }

      if (filters.search) {
        conditions.push(
          or(ilike(tasks.title, `%${escapeLike(filters.search)}%`), ilike(tasks.description, `%${escapeLike(filters.search)}%`))!
        );
      }

      // Add raw SQL filter from Smart View FilterEngine
      if (filterSql) {
        conditions.push(filterSql);
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Build sort clause
      const sortColumn = {
        position: tasks.position,
        created_at: tasks.createdAt,
        updated_at: tasks.updatedAt,
        due_date: tasks.dueDate,
        priority: tasks.priority,
        sequence_number: tasks.sequenceNumber,
      }[sortBy];

      const orderFn = sortOrder === 'desc' ? desc : asc;

      // Determine if we need additional joins for the count query
      const needsAssigneeJoin = taskListNeedsAssigneeJoin(filters, requiredJoins);
      const needsLabelJoin = requiredJoins.has('task_labels');

      // Get total count (with necessary joins for filter conditions)
      let countQuery = this.db
        .select({ count: sql<number>`COUNT(DISTINCT ${tasks.id})` })
        .from(tasks)
        .leftJoin(taskStates, eq(tasks.stateId, taskStates.id))
        .$dynamic();

      if (needsAssigneeJoin) {
        countQuery = countQuery.leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId));
      }
      if (needsLabelJoin) {
        countQuery = countQuery.leftJoin(taskLabels, eq(tasks.id, taskLabels.taskId));
      }

      const [countResult] = await countQuery.where(whereClause);
      const total = countResult?.count ?? 0;

      // Build base query with conditional joins
      // Use selectDistinct to avoid duplicates when joins produce multiple rows
      let taskQuery = this.db
        .selectDistinct({
          task: tasks,
          state: taskStates,
          project: {
            id: projects.id,
            identifier: projects.identifier,
            name: projects.name,
          },
          agent: {
            id: workspaceAgents.id,
            name: workspaceAgents.name,
          },
        })
        .from(tasks)
        .leftJoin(taskStates, eq(tasks.stateId, taskStates.id))
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .leftJoin(workspaceAgents, eq(tasks.agentId, workspaceAgents.id))
        .$dynamic();

      // Add conditional joins for filter conditions
      if (needsAssigneeJoin) {
        taskQuery = taskQuery.leftJoin(taskAssignees, eq(tasks.id, taskAssignees.taskId));
      }
      if (needsLabelJoin) {
        taskQuery = taskQuery.leftJoin(taskLabels, eq(tasks.id, taskLabels.taskId));
      }

      // Get tasks
      const taskRows = await taskQuery
        .where(whereClause)
        .orderBy(orderFn(sortColumn!))
        .limit(limit)
        .offset((page - 1) * limit);

      // Get all assignees, labels, and external links for the tasks
      const taskIds = taskRows.map((r) => r.task.id);

      let assigneesMap = new Map<string, typeof users.$inferSelect[]>();
      let labelsMap = new Map<string, typeof labels.$inferSelect[]>();
      let externalLinksMap = new Map<string, { id: string; externalType: 'github_issue' | 'github_pr'; externalId: string; externalUrl: string }[]>();

      if (taskIds.length > 0) {
        const assigneeRows = await this.db
          .select({ taskId: taskAssignees.taskId, user: users })
          .from(taskAssignees)
          .innerJoin(users, eq(taskAssignees.userId, users.id))
          .where(inArray(taskAssignees.taskId, taskIds));

        for (const row of assigneeRows) {
          const existing = assigneesMap.get(row.taskId) || [];
          existing.push(row.user);
          assigneesMap.set(row.taskId, existing);
        }

        const labelRows = await this.db
          .select({ taskId: taskLabels.taskId, label: labels })
          .from(taskLabels)
          .innerJoin(labels, eq(taskLabels.labelId, labels.id))
          .where(inArray(taskLabels.taskId, taskIds));

        for (const row of labelRows) {
          const existing = labelsMap.get(row.taskId) || [];
          existing.push(row.label);
          labelsMap.set(row.taskId, existing);
        }

        const externalLinkRows = await this.db
          .select()
          .from(externalLinks)
          .where(inArray(externalLinks.taskId, taskIds));

        for (const row of externalLinkRows) {
          const existing = externalLinksMap.get(row.taskId) || [];
          existing.push({
            id: row.id,
            externalType: row.externalType as 'github_issue' | 'github_pr',
            externalId: row.externalId,
            externalUrl: row.externalUrl,
          });
          externalLinksMap.set(row.taskId, existing);
        }
      }

      // Build result
      const tasksWithRelations: TaskWithRelations[] = taskRows.map((row) => ({
        ...row.task,
        state: row.state,
        project: row.project,
        assignees: assigneesMap.get(row.task.id) || [],
        labels: labelsMap.get(row.task.id) || [],
        agent: row.agent?.id ? row.agent : null,
        externalLinks: externalLinksMap.get(row.task.id) || [],
      }));

      return ok({ tasks: tasksWithRelations, total });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Add an assignee to a task.
   */
  async addAssignee(taskId: string, userId: string, assignedBy: string | null): Promise<Result<void, Error>> {
    try {
      await this.db.insert(taskAssignees).values({ taskId, userId }).onConflictDoNothing();

      await this.recordEvent({
        taskId,
        actorId: assignedBy,
        eventType: 'assigned',
        newValue: userId,
      });

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Remove an assignee from a task.
   */
  async removeAssignee(taskId: string, userId: string, removedBy: string | null): Promise<Result<void, Error>> {
    try {
      await this.db
        .delete(taskAssignees)
        .where(and(eq(taskAssignees.taskId, taskId), eq(taskAssignees.userId, userId)));

      await this.recordEvent({
        taskId,
        actorId: removedBy,
        eventType: 'unassigned',
        oldValue: userId,
      });

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Add a label to a task.
   */
  async addLabel(taskId: string, labelId: string, addedBy: string): Promise<Result<void, Error>> {
    try {
      await this.db.insert(taskLabels).values({ taskId, labelId }).onConflictDoNothing();

      await this.recordEvent({
        taskId,
        actorId: addedBy,
        eventType: 'labeled',
        newValue: labelId,
      });

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Remove a label from a task.
   */
  async removeLabel(taskId: string, labelId: string, removedBy: string): Promise<Result<void, Error>> {
    try {
      await this.db
        .delete(taskLabels)
        .where(and(eq(taskLabels.taskId, taskId), eq(taskLabels.labelId, labelId)));

      await this.recordEvent({
        taskId,
        actorId: removedBy,
        eventType: 'unlabeled',
        oldValue: labelId,
      });

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Calculate position for inserting a task between two others.
   */
  calculatePositionBetween(beforePosition: string | null, afterPosition: string | null): string {
    if (!beforePosition && !afterPosition) {
      return generatePosition();
    }
    if (!beforePosition) {
      return generatePosition(null, afterPosition);
    }
    if (!afterPosition) {
      return positionAfter(beforePosition);
    }
    return positionBetween(beforePosition, afterPosition);
  }

  /**
   * Record a task event for audit logging.
   */
  private async recordEvent(input: TaskEventInput): Promise<void> {
    await this.db.insert(taskEvents).values({
      taskId: input.taskId,
      actorId: input.actorId,
      eventType: input.eventType,
      fieldName: input.fieldName || null,
      oldValue: input.oldValue ?? null,
      newValue: input.newValue ?? null,
    });
  }
}
