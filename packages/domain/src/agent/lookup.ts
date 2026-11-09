import { and, eq, isNull, sql } from 'drizzle-orm';
import type { Database } from '@flowtask/database';
import { projects, tasks } from '@flowtask/database';

export interface TaskKey {
  identifier: string;
  sequenceNumber: number;
}

const TASK_KEY_PATTERN = /^([A-Za-z][A-Za-z0-9]{0,19})-(\d{1,9})$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/** Parses a human task key such as "ENG-123". Returns null for anything else. */
export function parseTaskKey(ref: string): TaskKey | null {
  const match = TASK_KEY_PATTERN.exec(ref.trim());
  if (!match?.[1] || !match[2]) {
    return null;
  }
  const sequenceNumber = Number.parseInt(match[2], 10);
  if (!Number.isSafeInteger(sequenceNumber) || sequenceNumber <= 0) {
    return null;
  }
  return { identifier: match[1].toUpperCase(), sequenceNumber };
}

/**
 * Lookups the agent tools need that no other service exposes.
 */
export class AgentLookupService {
  constructor(private db: Database) {}

  /** Resolves a task key inside one workspace; soft-deleted tasks are ignored. */
  async findTaskIdByKey(workspaceId: string, key: TaskKey): Promise<string | null> {
    const [row] = await this.db
      .select({ id: tasks.id })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          eq(projects.workspaceId, workspaceId),
          sql`upper(${projects.identifier}) = ${key.identifier}`,
          eq(tasks.sequenceNumber, key.sequenceNumber),
          isNull(tasks.deletedAt)
        )
      )
      .limit(1);
    return row?.id ?? null;
  }
}
