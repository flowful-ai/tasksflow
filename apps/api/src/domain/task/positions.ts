/**
 * Column-level position management for tasks (fractional indexing).
 *
 * A "column" is (project_id, state_id). Every write that places a task takes a
 * transaction-scoped advisory lock on the column, reads only the one or two
 * neighbour keys in byte-wise order (position COLLATE "C", id) and generates a
 * key between them. When a neighbour key is invalid (legacy generator output)
 * or two neighbours collide, the whole column is loaded and re-keyed in its
 * current order inside the same transaction.
 */
import { and, asc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import { tasks } from '../../db/index.js';
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
  /** Insert where this key would sort (task update with an explicit position). */
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
  return and(
    eq(tasks.projectId, projectId),
    stateId ? eq(tasks.stateId, stateId) : isNull(tasks.stateId)
  )!;
}

/** Serialise writers of one column for the rest of the transaction. */
export async function lockColumn(
  db: DbExecutor,
  projectId: string,
  stateId: string | null
): Promise<void> {
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
export function resolveInsertIndex(
  column: readonly ColumnTask[],
  request: PlacementRequest
): number {
  if (request.afterTaskId) {
    const index = column.findIndex((t) => t.id === request.afterTaskId);
    if (index === -1) {
      throw new TaskError('INVALID_NEIGHBOR', 'afterTaskId is not in the target column', [
        request.afterTaskId,
      ]);
    }
    return index + 1;
  }
  if (request.beforeTaskId) {
    const index = column.findIndex((t) => t.id === request.beforeTaskId);
    if (index === -1) {
      throw new TaskError('INVALID_NEIGHBOR', 'beforeTaskId is not in the target column', [
        request.beforeTaskId,
      ]);
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
export function keyForIndex(column: readonly ColumnTask[], index: number): string | null {
  const before = index > 0 ? column[index - 1]!.position : null;
  const after = index < column.length ? column[index]!.position : null;

  // Any invalid neighbour (legacy generator output) means the column gets re-keyed.
  if ((before !== null && !isValidPosition(before)) || (after !== null && !isValidPosition(after)))
    return null;

  try {
    return generatePosition(before, after);
  } catch (error) {
    if (error instanceof InvalidPositionError) return null;
    throw error;
  }
}

/** Rewrite every key in the column (keeping order) and reserve a slot at `index`. */
export async function rekeyColumn(
  db: DbExecutor,
  column: readonly ColumnTask[],
  index: number
): Promise<string> {
  const keys = generatePositions(column.length + 1);
  const updates = column.map((task, i) => ({
    id: task.id,
    position: keys[i < index ? i : i + 1]!,
  }));
  await writePositions(db, updates);
  return keys[index]!;
}

/** Bulk-update positions with one statement. */
export async function writePositions(
  db: DbExecutor,
  updates: readonly ColumnTask[]
): Promise<void> {
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

/** Column condition as raw SQL on table alias `t` (for the neighbour queries). */
function columnSql(alias: string, projectId: string, stateId: string | null): SQL {
  const t = sql.raw(alias);
  return stateId
    ? sql`${t}.project_id = ${projectId} AND ${t}.state_id = ${stateId}`
    : sql`${t}.project_id = ${projectId} AND ${t}.state_id IS NULL`;
}

function excludeSql(alias: string, taskId: string | undefined): SQL {
  return taskId ? sql` AND ${sql.raw(alias)}.id <> ${taskId}` : sql``;
}

/** A neighbour row as returned by db.execute. */
type NeighbourRow = { id: string; position: string };

/** Keys outside ASCII may order differently in JS (UTF-16) and Postgres (UTF-8 bytes). */
const NON_ASCII = /[\u0080-\uffff]/;

/**
 * The neighbours the request lands between, read with index-backed LIMIT
 * queries instead of the whole column. Returns null when the neighbours must
 * be resolved against the full column (non-ASCII requested key).
 */
async function loadNeighbours(
  db: DbExecutor,
  request: PlacementRequest
): Promise<{ before: ColumnTask | null; after: ColumnTask | null } | null> {
  const { projectId, stateId, taskId } = request;
  const col = columnSql('t', projectId, stateId);
  const exclude = excludeSql('t', taskId);

  const anchorId = request.afterTaskId || request.beforeTaskId;
  if (anchorId) {
    // The anchor plus the adjacent row on the side the task goes.
    const isAfter = Boolean(request.afterTaskId);
    const rows = await db.execute<NeighbourRow>(sql`
      SELECT t.id, t.position FROM tasks t, tasks a
      WHERE a.id = ${anchorId} AND ${columnSql('a', projectId, stateId)}${excludeSql('a', taskId)}
        AND ${col}${exclude}
        AND (t.position COLLATE "C", t.id) ${sql.raw(isAfter ? '>=' : '<=')} (a.position COLLATE "C", a.id)
      ORDER BY t.position COLLATE "C" ${sql.raw(isAfter ? 'ASC' : 'DESC')}, t.id ${sql.raw(isAfter ? 'ASC' : 'DESC')}
      LIMIT 2`);
    const [anchor, adjacent] = rows;
    if (!anchor || anchor.id !== anchorId) {
      const field = isAfter ? 'afterTaskId' : 'beforeTaskId';
      throw new TaskError('INVALID_NEIGHBOR', `${field} is not in the target column`, [anchorId]);
    }
    return isAfter
      ? { before: anchor, after: adjacent ?? null }
      : { before: adjacent ?? null, after: anchor };
  }

  if (request.position !== undefined) {
    if (NON_ASCII.test(request.position)) return null;
    // Insert after every key that sorts at or before the requested key.
    const rows = await db.execute<NeighbourRow & { side: string }>(sql`
      (SELECT 'before' AS side, t.id, t.position FROM tasks t
        WHERE ${col}${exclude} AND t.position COLLATE "C" <= ${request.position}
        ORDER BY t.position COLLATE "C" DESC, t.id DESC LIMIT 1)
      UNION ALL
      (SELECT 'after' AS side, t.id, t.position FROM tasks t
        WHERE ${col}${exclude} AND t.position COLLATE "C" > ${request.position}
        ORDER BY t.position COLLATE "C" ASC, t.id ASC LIMIT 1)`);
    const pick = (side: string): ColumnTask | null => {
      const row = rows.find((r) => r.side === side);
      return row ? { id: row.id, position: row.position } : null;
    };
    return { before: pick('before'), after: pick('after') };
  }

  // Append: after the last key of the column (soft-deleted included, as before).
  const [last] = await db.execute<NeighbourRow>(sql`
    SELECT t.id, t.position FROM tasks t
    WHERE ${col}${exclude}
    ORDER BY t.position COLLATE "C" DESC, t.id DESC
    LIMIT 1`);
  return { before: last ?? null, after: null };
}

/**
 * Compute (and reserve) the position for placing a task in a column. Must run
 * inside a transaction; takes the column lock. Only the neighbour keys are
 * read; the full column is loaded when they cannot produce a key (re-key).
 */
export async function placeTask(
  db: DbExecutor,
  request: PlacementRequest
): Promise<PlacementResult> {
  await lockColumn(db, request.projectId, request.stateId);
  const neighbours = await loadNeighbours(db, request);
  if (neighbours) {
    const slice = [neighbours.before, neighbours.after].filter((t): t is ColumnTask => t !== null);
    const key = keyForIndex(slice, neighbours.before ? 1 : 0);
    if (key !== null) return { position: key, rekeyed: false };
  }
  return placeInFullColumn(db, request);
}

/** Slow path: load the whole column, place by index, re-key when needed. */
async function placeInFullColumn(
  db: DbExecutor,
  request: PlacementRequest
): Promise<PlacementResult> {
  const column = await loadColumn(db, request.projectId, request.stateId, request.taskId);
  const index = resolveInsertIndex(column, request);
  const key = keyForIndex(column, index);
  if (key !== null) return { position: key, rekeyed: false };
  return { position: await rekeyColumn(db, column, index), rekeyed: true };
}
