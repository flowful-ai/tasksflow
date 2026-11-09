import { describe, expect, test } from 'bun:test';
import { isFilteredListKey } from './cacheUpdates';

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
