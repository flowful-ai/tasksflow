/**
 * Task relations: blocks / relates / duplicates.
 *
 * Storage: one row (task_id → related_task_id, type). 'blocks' means task_id
 * blocks related_task_id; 'duplicates' means task_id duplicates
 * related_task_id; 'relates' is symmetric and stored once (either direction
 * counts as the same pair). Both tasks must be in the same workspace.
 */
import { and, desc, eq, isNull, or } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { projects, taskRelations, tasks } from '../../db/index.js';
import { ok, err, type Result, type TaskRelationType } from '@flowtask/shared';
import { TaskError, toError } from './errors.js';
import { selectTaskRefs, toTaskRef } from './queries.js';
import { recordTaskEvents } from './service.js';
import type { TaskRelationView } from './types.js';

function isRelationType(value: string): value is TaskRelationType {
  return value === 'blocks' || value === 'relates' || value === 'duplicates';
}

export interface AddRelationInput {
  taskId: string;
  relatedTaskId: string;
  type: TaskRelationType;
  direction?: 'outgoing' | 'incoming';
  createdBy: string | null;
  mcpClientId?: string | null;
}

export class TaskRelationService {
  constructor(private db: Database) {}

  /** All relations of a task, seen from that task. Relations to deleted tasks are hidden. */
  async list(taskId: string): Promise<Result<TaskRelationView[], Error>> {
    try {
      const [outgoing, incoming] = await Promise.all([
        selectTaskRefs(this.db)
          .innerJoin(taskRelations, eq(taskRelations.relatedTaskId, tasks.id))
          .where(and(eq(taskRelations.taskId, taskId), isNull(tasks.deletedAt)))
          .orderBy(desc(taskRelations.createdAt)),
        selectTaskRefs(this.db)
          .innerJoin(taskRelations, eq(taskRelations.taskId, tasks.id))
          .where(and(eq(taskRelations.relatedTaskId, taskId), isNull(tasks.deletedAt)))
          .orderBy(desc(taskRelations.createdAt)),
      ]);
      // selectTaskRefs only selects ref columns; load relation metadata separately.
      const rows = await this.db
        .select()
        .from(taskRelations)
        .where(or(eq(taskRelations.taskId, taskId), eq(taskRelations.relatedTaskId, taskId)));

      const views: TaskRelationView[] = [];
      for (const rel of rows) {
        if (!isRelationType(rel.type)) continue;
        const isOutgoing = rel.taskId === taskId;
        const otherId = isOutgoing ? rel.relatedTaskId : rel.taskId;
        const ref = (isOutgoing ? outgoing : incoming).find((r) => r.id === otherId);
        if (!ref) continue;
        views.push({
          id: rel.id,
          type: rel.type,
          direction: rel.type === 'relates' ? 'outgoing' : isOutgoing ? 'outgoing' : 'incoming',
          task: toTaskRef(ref),
          createdAt: rel.createdAt,
          createdBy: rel.createdBy,
        });
      }
      views.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      return ok(views);
    } catch (error) {
      return err(toError(error));
    }
  }

  async add(input: AddRelationInput): Promise<Result<TaskRelationView, Error>> {
    try {
      if (input.taskId === input.relatedTaskId) {
        throw new TaskError('INVALID_RELATION', 'A task cannot be related to itself');
      }
      const reversed = input.type !== 'relates' && input.direction === 'incoming';
      const from = reversed ? input.relatedTaskId : input.taskId;
      const to = reversed ? input.taskId : input.relatedTaskId;

      const relationId = await this.db.transaction(async (tx) => {
        const pair = await tx
          .select({ id: tasks.id, workspaceId: projects.workspaceId })
          .from(tasks)
          .innerJoin(projects, eq(tasks.projectId, projects.id))
          .where(and(or(eq(tasks.id, from), eq(tasks.id, to)), isNull(tasks.deletedAt)));
        if (pair.length !== 2) throw new TaskError('TASK_NOT_FOUND', 'Task not found');
        if (pair[0]!.workspaceId !== pair[1]!.workspaceId) {
          throw new TaskError('INVALID_RELATION', 'Related tasks must be in the same workspace');
        }

        const existing = await tx
          .select({ id: taskRelations.id })
          .from(taskRelations)
          .where(
            and(
              eq(taskRelations.type, input.type),
              input.type === 'relates'
                ? or(
                    and(eq(taskRelations.taskId, from), eq(taskRelations.relatedTaskId, to)),
                    and(eq(taskRelations.taskId, to), eq(taskRelations.relatedTaskId, from))
                  )
                : and(eq(taskRelations.taskId, from), eq(taskRelations.relatedTaskId, to))
            )
          )
          .limit(1);
        if (existing.length) throw new TaskError('RELATION_EXISTS', 'Relation already exists');

        if (input.type === 'blocks') {
          // Reject the inverse "blocks" (A blocks B and B blocks A is a deadlock).
          const inverse = await tx
            .select({ id: taskRelations.id })
            .from(taskRelations)
            .where(
              and(
                eq(taskRelations.type, 'blocks'),
                eq(taskRelations.taskId, to),
                eq(taskRelations.relatedTaskId, from)
              )
            )
            .limit(1);
          if (inverse.length)
            throw new TaskError('INVALID_RELATION', 'The related task already blocks this task');
        }

        const [row] = await tx
          .insert(taskRelations)
          .values({ taskId: from, relatedTaskId: to, type: input.type, createdBy: input.createdBy })
          .onConflictDoNothing()
          .returning({ id: taskRelations.id });
        if (!row) throw new TaskError('RELATION_EXISTS', 'Relation already exists');

        const value = { relationId: row.id, type: input.type, taskId: from, relatedTaskId: to };
        await recordTaskEvents(tx, [
          {
            taskId: from,
            actorId: input.createdBy,
            mcpClientId: input.mcpClientId,
            eventType: 'relation_added',
            newValue: value,
          },
          {
            taskId: to,
            actorId: input.createdBy,
            mcpClientId: input.mcpClientId,
            eventType: 'relation_added',
            newValue: value,
          },
        ]);
        return row.id;
      });

      const list = await this.list(input.taskId);
      if (!list.ok) return list;
      const view = list.value.find((v) => v.id === relationId);
      return view ? ok(view) : err(new TaskError('RELATION_NOT_FOUND', 'Relation not found'));
    } catch (error) {
      return err(toError(error));
    }
  }

  /** Remove a relation that involves `taskId` (either side). */
  async remove(
    taskId: string,
    relationId: string,
    removedBy: string | null,
    options?: { mcpClientId?: string | null }
  ): Promise<Result<void, Error>> {
    try {
      await this.db.transaction(async (tx) => {
        const [row] = await tx
          .delete(taskRelations)
          .where(
            and(
              eq(taskRelations.id, relationId),
              or(eq(taskRelations.taskId, taskId), eq(taskRelations.relatedTaskId, taskId))
            )
          )
          .returning();
        if (!row) throw new TaskError('RELATION_NOT_FOUND', 'Relation not found', [relationId]);
        const value = {
          relationId: row.id,
          type: row.type,
          taskId: row.taskId,
          relatedTaskId: row.relatedTaskId,
        };
        await recordTaskEvents(tx, [
          {
            taskId: row.taskId,
            actorId: removedBy,
            mcpClientId: options?.mcpClientId,
            eventType: 'relation_removed',
            oldValue: value,
          },
          {
            taskId: row.relatedTaskId,
            actorId: removedBy,
            mcpClientId: options?.mcpClientId,
            eventType: 'relation_removed',
            oldValue: value,
          },
        ]);
      });
      return ok(undefined);
    } catch (error) {
      return err(toError(error));
    }
  }
}
