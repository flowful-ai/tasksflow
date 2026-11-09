/**
 * Global search for the ⌘K palette: tasks (key, full-text, prefix) and
 * projects, limited to the projects the caller can access.
 */
import { escapeLike } from '@flowtask/shared';
import { and, asc, desc, eq, ilike, inArray, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../../db/index.js';
import { projects, taskStates, tasks } from '../../db/index.js';
import {
  formatTaskKey,
  ok,
  err,
  parseTaskKey,
  type Result,
  type SearchResult,
} from '@flowtask/shared';
import { toError } from '../task/errors.js';
import {
  buildPrefixTsQuery,
  buildTaskKeyCondition,
  buildTextSearchCondition,
} from '../task/service.js';

export interface SearchInput {
  /** Projects the caller may see (resolve with listAccessibleProjectIds). */
  projectIds: readonly string[];
  q: string;
  limit?: number;
}

export class SearchService {
  constructor(private db: Database) {}

  async search(input: SearchInput): Promise<Result<SearchResult, Error>> {
    try {
      const q = input.q.trim();
      const limit = Math.max(1, Math.min(50, input.limit ?? 10));
      if (!q || input.projectIds.length === 0) return ok({ tasks: [], projects: [] });
      const projectIds = [...input.projectIds];

      const key = parseTaskKey(q);
      const keyCondition = key ? buildTaskKeyCondition(key.identifier, key.sequenceNumber) : null;
      const textCondition = buildTextSearchCondition(q);
      const prefix = buildPrefixTsQuery(q);
      const rank = prefix
        ? sql<number>`ts_rank(${tasks.searchVector}, websearch_to_tsquery('simple', ${q}) || to_tsquery('simple', ${prefix}))`
        : sql<number>`ts_rank(${tasks.searchVector}, websearch_to_tsquery('simple', ${q}))`;
      const exact = keyCondition ? sql<boolean>`(${keyCondition})` : sql<boolean>`false`;
      // ORDER BY a constant is rejected by Postgres, so only rank by `exact` when it can vary.
      const order = keyCondition
        ? [desc(exact), desc(rank), desc(tasks.updatedAt), asc(tasks.id)]
        : [desc(rank), desc(tasks.updatedAt), asc(tasks.id)];

      const taskRows = await this.db
        .select({
          id: tasks.id,
          title: tasks.title,
          sequenceNumber: tasks.sequenceNumber,
          priority: tasks.priority,
          projectId: projects.id,
          projectName: projects.name,
          identifier: projects.identifier,
          stateId: taskStates.id,
          stateName: taskStates.name,
          stateCategory: taskStates.category,
          stateColor: taskStates.color,
          exact,
        })
        .from(tasks)
        .innerJoin(projects, eq(tasks.projectId, projects.id))
        .leftJoin(taskStates, eq(tasks.stateId, taskStates.id))
        .where(
          and(
            inArray(tasks.projectId, projectIds),
            isNull(tasks.deletedAt),
            keyCondition ? or(keyCondition, textCondition) : textCondition
          )
        )
        .orderBy(...order)
        .limit(limit);

      const pattern = `%${escapeLike(q)}%`;
      const projectRows = await this.db
        .select({
          id: projects.id,
          name: projects.name,
          identifier: projects.identifier,
          icon: projects.icon,
        })
        .from(projects)
        .where(
          and(
            inArray(projects.id, projectIds),
            eq(projects.isArchived, false),
            or(ilike(projects.name, pattern), ilike(projects.identifier, pattern))
          )
        )
        .orderBy(asc(projects.name), asc(projects.id))
        .limit(Math.min(limit, 10));

      return ok({
        tasks: taskRows.map((row) => ({
          id: row.id,
          key: formatTaskKey(row.identifier, row.sequenceNumber),
          title: row.title,
          projectId: row.projectId,
          projectName: row.projectName,
          state:
            row.stateId && row.stateName && row.stateCategory
              ? {
                  id: row.stateId,
                  name: row.stateName,
                  category: row.stateCategory,
                  color: row.stateColor,
                }
              : null,
          priority: row.priority,
          exactKeyMatch: Boolean(row.exact),
        })),
        projects: projectRows,
      });
    } catch (error) {
      return err(toError(error));
    }
  }
}
