/**
 * Column-level position management for tasks (fractional indexing).
 *
 * A "column" is (project_id, state_id). Every write that places a task takes a
 * transaction-scoped advisory lock on the column, loads the column in
 * byte-wise order (position COLLATE "C", id) and generates a key between the
 * neighbours. When a neighbour key is invalid (legacy generator output) or two
 * neighbours collide, the whole column is re-keyed in its current order inside
 * the same transaction.
 */
import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { tasks } from '@flowtask/database';
import {
  InvalidPositionError,
  comparePositions,
  generatePosition,
  generatePositions,
  isValidPosition,
} from '@flowtask/shared';
import type { DbExecutor } from './db.js';
import { TaskError } from './errors.js';

export interface ColumnTask {
  id: string;
  position: string;
}

export interface PlacementRequest {
  projectId: string;
  stateId: string | null;
  /** The task being placed (excluded from the column); omit for a new task. */
  taskId?: string;
  /** Task that should end up directly above. */
  afterTaskId?: string | null;
  /** Task that should end up directly below. */
  beforeTaskId?: string | null;
  /** Legacy client-computed key. */
  position?: string;
}

export interface PlacementResult {
  position: string;
  /** Other tasks whose positions were rewritten (column re-key). */
  rekeyed: boolean;
}

/** ORDER BY expression for position with a deterministic tiebreak. */
export function positionOrder(): SQL[] {
  return [sql`${tasks.position} COLLATE "C"`, asc(tasks.id)];
}

function columnCondition(projectId: string, stateId: string | null): SQL {
  return and(eq(tasks.projectId, projectId), stateId ? eq(tasks.stateId, stateId) : isNull(tasks.stateId))!;
}

/** Serialise writers of one column for the rest of the transaction. */
export async function lockColumn(db: DbExecutor, projectId: string, stateId: string | null): Promise<void> {
  const key = `tasks-column:${projectId}:${stateId ?? 'none'}`;
  await db.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`);
}

/** All tasks of a column (soft-deleted included, so a re-key keeps them valid), in key order. */
export async function loadColumn(
  db: DbExecutor,
  projectId: string,
  stateId: string | null,
  excludeTaskId?: string
): Promise<ColumnTask[]> {
  const conditions: SQL[] = [columnCondition(projectId, stateId)];
  if (excludeTaskId) conditions.push(ne(tasks.id, excludeTaskId));
  return db
    .select({ id: tasks.id, position: tasks.position })
    .from(tasks)
    .where(and(...conditions))
    .orderBy(...positionOrder());
}

/** Index at which a new item lands in `column` for the request. */
export function resolveInsertIndex(column: readonly ColumnTask[], request: PlacementRequest): number {
  if (request.afterTaskId) {
    const index = column.findIndex((t) => t.id === request.afterTaskId);
    if (index === -1) {
      throw new TaskError('INVALID_NEIGHBOR', 'afterTaskId is not in the target column', [request.afterTaskId]);
    }
    return index + 1;
  }
  if (request.beforeTaskId) {
    const index = column.findIndex((t) => t.id === request.beforeTaskId);
    if (index === -1) {
      throw new TaskError('INVALID_NEIGHBOR', 'beforeTaskId is not in the target column', [request.beforeTaskId]);
    }
    return index;
  }
  if (request.position !== undefined) {
    const wanted = request.position;
    // Insert after every key that sorts at or before the requested key.
    let index = 0;
    while (index < column.length && comparePositions(column[index]!.position, wanted) <= 0) index++;
    return index;
  }
  return column.length;
}

/**
 * Pure placement: returns the key for inserting at `index`, or null when the
 * neighbours require a re-key.
 */
export function keyForIndex(column: readonly ColumnTask[], index: number, requested?: string): string | null {
  const before = index > 0 ? column[index - 1]!.position : null;
  const after = index < column.length ? column[index]!.position : null;

  // Legacy fast path: keep a client key that is valid and fits strictly.
  if (
    requested !== undefined &&
    isValidPosition(requested) &&
    (before === null || comparePositions(before, requested) < 0) &&
    (after === null || comparePositions(requested, after) < 0)
  ) {
    return requested;
  }

  // Any invalid neighbour (legacy generator output) means the column gets re-keyed.
  if ((before !== null && !isValidPosition(before)) || (after !== null && !isValidPosition(after))) return null;

  try {
    return generatePosition(before, after);
  } catch (error) {
    if (error instanceof InvalidPositionError) return null;
    throw error;
  }
}

/** Rewrite every key in the column (keeping order) and reserve a slot at `index`. */
export async function rekeyColumn(db: DbExecutor, column: readonly ColumnTask[], index: number): Promise<string> {
  const keys = generatePositions(column.length + 1);
  const updates = column.map((task, i) => ({ id: task.id, position: keys[i < index ? i : i + 1]! }));
  await writePositions(db, updates);
  return keys[index]!;
}

/** Bulk-update positions with one statement. */
export async function writePositions(db: DbExecutor, updates: readonly ColumnTask[]): Promise<void> {
  if (updates.length === 0) return;
  const CHUNK = 500;
  for (let start = 0; start < updates.length; start += CHUNK) {
    const chunk = updates.slice(start, start + CHUNK);
    const values = sql.join(
      chunk.map((u) => sql`(${u.id}::uuid, ${u.position}::text)`),
      sql`, `
    );
    await db.execute(
      sql`UPDATE tasks SET position = v.position FROM (VALUES ${values}) AS v(id, position) WHERE tasks.id = v.id`
    );
  }
}

/**
 * Compute (and reserve) the position for placing a task in a column. Must run
 * inside a transaction; takes the column lock.
 */
export async function placeTask(db: DbExecutor, request: PlacementRequest): Promise<PlacementResult> {
  await lockColumn(db, request.projectId, request.stateId);
  const column = await loadColumn(db, request.projectId, request.stateId, request.taskId);
  const index = resolveInsertIndex(column, request);
  const key = keyForIndex(column, index, request.afterTaskId || request.beforeTaskId ? undefined : request.position);
  if (key !== null) return { position: key, rekeyed: false };
  return { position: await rekeyColumn(db, column, index), rekeyed: true };
}
