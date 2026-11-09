import { describe, expect, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../../api/queryKeys';
import { invalidateRekeyedLists, isFilteredListKey } from './cacheUpdates';

describe('isFilteredListKey', () => {
  const key = (filters: object | undefined) => ['tasks', 'project', 'p1', filters];

  test('no filters is unfiltered', () => {
    expect(isFilteredListKey(key(undefined))).toBe(false);
    expect(isFilteredListKey(key({}))).toBe(false);
  });

  test('top-level-only boards still take new top-level tasks', () => {
    expect(isFilteredListKey(key({ parentId: 'none' }), { parentId: null })).toBe(false);
  });

  test('a new sub-task is not appended to a top-level-only board', () => {
    expect(isFilteredListKey(key({ parentId: 'none' }), { parentId: 't1' })).toBe(true);
  });

  test('any other filter blocks the append', () => {
    expect(isFilteredListKey(key({ parentId: 'none', assigneeId: 'u1' }), { parentId: null })).toBe(
      true
    );
  });
});

describe('invalidateRekeyedLists', () => {
  function seeded() {
    const client = new QueryClient();
    for (const projectId of ['p1', 'p2']) {
      client.setQueryData(queryKeys.tasks.list(projectId), { pages: [], pageParams: [] });
    }
    const invalidated = (projectId: string) =>
      client.getQueryState(queryKeys.tasks.list(projectId))?.isInvalidated ?? false;
    return { client, invalidated };
  }

  test('does nothing when no column was re-keyed', async () => {
    const { client, invalidated } = seeded();
    await invalidateRekeyedLists(client, false, ['p1']);
    expect(invalidated('p1')).toBe(false);
  });

  test("refetches only the affected projects' task lists after a re-key", async () => {
    const { client, invalidated } = seeded();
    await invalidateRekeyedLists(client, true, ['p1', 'p1']);
    expect(invalidated('p1')).toBe(true);
    expect(invalidated('p2')).toBe(false);
  });

  test('refetches every task list when the projects are unknown', async () => {
    const { client, invalidated } = seeded();
    await invalidateRekeyedLists(client, true, []);
    expect(invalidated('p1')).toBe(true);
    expect(invalidated('p2')).toBe(true);
  });
});
