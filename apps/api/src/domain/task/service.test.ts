import { describe, expect, it } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and } from 'drizzle-orm';
import {
  buildPrefixTsQuery,
  buildTaskAssigneeConditions,
  buildTaskLabelConditions,
  buildTextSearchCondition,
  searchTokens,
  taskListNeedsAssigneeJoin,
} from './service.js';
import { keyForIndex, resolveInsertIndex, type ColumnTask } from './positions.js';
import { TaskError, isTaskError } from './errors.js';
import { projectAclAllows as canAccessProject } from '../workspace/authorization.js';

const dialect = new PgDialect();
const render = (conditions: ReturnType<typeof buildTaskAssigneeConditions>) => dialect.sqlToQuery(and(...conditions)!);
type Joins = Set<'task_states' | 'task_assignees' | 'task_labels'>;

describe('task list assignee/label filtering helpers', () => {
  it('only joins task_assignees for legacy filterSql that needs it', () => {
    expect(taskListNeedsAssigneeJoin({ assigneeId: 'user-1' }, new Set())).toBe(false);
    expect(taskListNeedsAssigneeJoin({}, new Set(['task_assignees']) as Joins)).toBe(true);
  });

  it('builds EXISTS conditions for assignee filters (no join, no duplicates)', () => {
    const conditions = buildTaskAssigneeConditions({ assigneeId: 'user-1', assigneeIds: ['user-2', 'user-3'] });
    expect(conditions.length).toBe(2);
    const { sql, params } = render(conditions);
    expect(sql).toContain('EXISTS (SELECT 1 FROM "task_assignees"');
    expect(params).toEqual(['user-1', 'user-2', 'user-3']);
  });

  it('builds EXISTS conditions for label filters', () => {
    const { sql, params } = render(buildTaskLabelConditions({ labelId: 'l1', labelIds: ['l2'] }));
    expect(sql).toContain('EXISTS (SELECT 1 FROM "task_labels"');
    expect(params).toEqual(['l1', 'l2']);
  });
});

describe('search helpers', () => {
  it('tokenises queries into safe prefix tsqueries', () => {
    expect(searchTokens("Lexico-graph's  midpoint!")).toEqual(['lexico', 'graph', 's', 'midpoint']);
    expect(buildPrefixTsQuery('lexico graph')).toBe('lexico:* & graph:*');
    expect(buildPrefixTsQuery("&|!():*")).toBeNull();
    expect(buildPrefixTsQuery('café ÉTÉ')).toBe('café:* & été:*');
  });

  it('adds an ILIKE prefix fallback only for short queries', () => {
    const short = dialect.sqlToQuery(buildTextSearchCondition('ab'));
    expect(short.sql).toContain('ilike');
    expect(short.params).toContain('ab%');
    const long = dialect.sqlToQuery(buildTextSearchCondition('abc'));
    expect(long.sql).not.toContain('ilike');
    expect(long.sql).toContain("websearch_to_tsquery('simple'");
    expect(long.params).toEqual(['abc', 'abc:*']);
  });
});

describe('column placement (pure)', () => {
  const col = (...positions: string[]): ColumnTask[] => positions.map((p, i) => ({ id: `t${i}`, position: p }));

  it('resolves the insert index from neighbours or a legacy key', () => {
    const column = col('a0', 'a1', 'a2');
    expect(resolveInsertIndex(column, { projectId: 'p', stateId: 's', afterTaskId: 't0' })).toBe(1);
    expect(resolveInsertIndex(column, { projectId: 'p', stateId: 's', beforeTaskId: 't0' })).toBe(0);
    expect(resolveInsertIndex(column, { projectId: 'p', stateId: 's', position: 'a1V' })).toBe(2);
    expect(resolveInsertIndex(column, { projectId: 'p', stateId: 's', position: 'a1' })).toBe(2);
    expect(resolveInsertIndex(column, { projectId: 'p', stateId: 's' })).toBe(3);
    expect(() => resolveInsertIndex(column, { projectId: 'p', stateId: 's', afterTaskId: 'nope' })).toThrow(TaskError);
  });

  it('keeps a valid client key that fits, otherwise generates one', () => {
    const column = col('a0', 'a2');
    expect(keyForIndex(column, 1, 'a1')).toBe('a1');
    const generated = keyForIndex(column, 1, 'zz');
    expect(generated! > 'a0' && generated! < 'a2').toBe(true);
  });

  it('asks for a re-key when neighbours are invalid or collide', () => {
    expect(keyForIndex(col('b0', 'b1'), 1)).toBeNull();
    expect(keyForIndex(col('a0', 'a0'), 1)).toBeNull();
    // Even appending after an invalid key re-keys the column.
    expect(keyForIndex(col('a0', 'b0'), 2)).toBeNull();
    expect(keyForIndex(col('b0', 'c000'), 2)).not.toBeNull(); // only the neighbours matter
  });
});

describe('task errors and access rules', () => {
  it('carries code and status', () => {
    const error = new TaskError('INVALID_LABEL', 'nope', ['l1']);
    expect(isTaskError(error)).toBe(true);
    expect(error.status).toBe(400);
    expect(new TaskError('TASK_NOT_FOUND', 'x').status).toBe(404);
    expect(isTaskError(new Error('x'))).toBe(false);
  });

  it('applies the project ACL', () => {
    expect(canAccessProject('admin', 'admin', false)).toBe(true);
    expect(canAccessProject('admin', 'member', true)).toBe(false);
    expect(canAccessProject('members', 'member', false)).toBe(false);
    expect(canAccessProject('members', 'member', true)).toBe(true);
    expect(canAccessProject('all', 'member', false)).toBe(true);
    // Unknown access values deny members (fail closed).
    expect(canAccessProject('weird', 'member', true)).toBe(false);
  });
});
