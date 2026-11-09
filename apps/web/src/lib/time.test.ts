import { describe, expect, test } from 'bun:test';
import { relativeTime, shortRelativeTime, tomorrowMorning } from './time';
import { parseRecents, pushRecent, type RecentItem } from './recent';

describe('relative time', () => {
  const now = Date.parse('2026-11-09T12:00:00Z');
  test('compact units', () => {
    expect(shortRelativeTime('2026-11-09T11:59:30Z', now)).toBe('now');
    expect(shortRelativeTime('2026-11-09T11:55:00Z', now)).toBe('5m');
    expect(shortRelativeTime('2026-11-09T10:00:00Z', now)).toBe('2h');
    expect(shortRelativeTime('2026-11-07T12:00:00Z', now)).toBe('2d');
    expect(relativeTime('2026-11-09T10:00:00Z', now)).toBe('2h ago');
    expect(relativeTime('2026-11-09T11:59:59Z', now)).toBe('just now');
  });
});

test('tomorrowMorning is 09:00 local on the next day', () => {
  const at = tomorrowMorning(new Date(2026, 10, 9, 23, 30));
  expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 10, 10, 9, 0]);
});

describe('recents', () => {
  const a: RecentItem = { kind: 'task', id: '1', key: 'TF-1', title: 'One' };
  const b: RecentItem = { kind: 'project', id: '2', key: 'TF', title: 'Web' };
  test('push de-duplicates and puts the item first', () => {
    expect(pushRecent([a, b], a)).toEqual([a, b]);
    expect(pushRecent([a], b)).toEqual([b, a]);
  });
  test('parse drops malformed data', () => {
    expect(parseRecents('not json')).toEqual([]);
    expect(parseRecents('{"a":1}')).toEqual([]);
    expect(parseRecents(JSON.stringify([a, { kind: 'x' }, 3]))).toEqual([a]);
  });
});
