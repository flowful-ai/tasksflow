import type { DbExecutor } from '../../domain/index.js';
import { projects, taskStates, tasks } from '../../db/index.js';
import type { TaskReference, TaskStateCategory } from '@flowtask/shared';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

/** First state (by position) of a category in a project, e.g. the first `done` column. */
export async function findFirstStateByCategory(
  db: DbExecutor,
  projectId: string,
  category: TaskStateCategory
): Promise<{ id: string; name: string } | null> {
  const [state] = await db
    .select({ id: taskStates.id, name: taskStates.name })
    .from(taskStates)
    .where(and(eq(taskStates.projectId, projectId), eq(taskStates.category, category)))
    .orderBy(asc(taskStates.position))
    .limit(1);
  return state ?? null;
}

export async function getStateCategory(
  db: DbExecutor,
  stateId: string | null
): Promise<string | null> {
  if (!stateId) return null;
  const [state] = await db
    .select({ category: taskStates.category })
    .from(taskStates)
    .where(eq(taskStates.id, stateId));
  return state?.category ?? null;
}

/**
 * Resolve `FLOW-123` style references to live task ids within one project.
 * References to other projects' identifiers are ignored.
 */
export async function resolveTaskReferencesInProject(
  db: DbExecutor,
  projectId: string,
  refs: readonly TaskReference[]
): Promise<string[]> {
  if (refs.length === 0) return [];
  const [project] = await db
    .select({ identifier: projects.identifier })
    .from(projects)
    .where(eq(projects.id, projectId));
  if (!project) return [];

  const sequenceNumbers = refs
    .filter((ref) => ref.identifier === project.identifier.toUpperCase())
    .map((ref) => ref.sequenceNumber);
  if (sequenceNumbers.length === 0) return [];

  const rows = await db
    .select({ id: tasks.id, sequenceNumber: tasks.sequenceNumber })
    .from(tasks)
    .where(
      and(
        eq(tasks.projectId, projectId),
        inArray(tasks.sequenceNumber, sequenceNumbers),
        isNull(tasks.deletedAt)
      )
    );

  // Keep the order in which the references appeared.
  return sequenceNumbers.flatMap((seq) =>
    rows.filter((r) => r.sequenceNumber === seq).map((r) => r.id)
  );
}
