import { describe, expect, it } from 'bun:test';
import {
  InvalidPositionError,
  arePositionsHealthy,
  comparePositions,
  generatePosition,
  generatePositions,
  initialPosition,
  isValidPosition,
  positionAfter,
  positionBefore,
  positionBetween,
} from './lexicographic.js';

/** Deterministic PRNG so failures are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function insertAt(list: string[], index: number): string {
  const before = index > 0 ? list[index - 1] : null;
  const after = index < list.length ? list[index] : null;
  const key = generatePosition(before, after);
  if (before) expect(comparePositions(before, key)).toBe(-1);
  if (after) expect(comparePositions(key, after)).toBe(-1);
  expect(isValidPosition(key)).toBe(true);
  list.splice(index, 0, key);
  return key;
}

describe('lexicographic positions', () => {
  it('fixes the known midpoint bugs', () => {
    const between = positionBetween('az', 'b00');
    expect(between > 'az' && between < 'b00').toBe(true);

    const afterZz = positionAfter('zz');
    expect(afterZz > 'zz').toBe(true);
    expect(isValidPosition(afterZz)).toBe(true);

    // 'a' is not a valid key; 'a0' is the first key.
    expect(isValidPosition('a')).toBe(false);
    const beforeA0 = positionBefore('a0');
    expect(beforeA0 < 'a0').toBe(true);
  });

  it('starts at a0 and appends/prepends', () => {
    expect(initialPosition()).toBe('a0');
    expect(positionAfter(null)).toBe('a0');
    expect(positionBefore(undefined)).toBe('a0');
    expect(positionAfter('a0')).toBe('a1');
    expect(positionBefore('a0')).toBe('Zz');
    expect(generatePosition()).toBe('a0');
  });

  it('compares by code unit, not locale', () => {
    // localeCompare would put 'a' before 'B'; code-unit order puts 'B' first.
    expect(comparePositions('B', 'a')).toBe(-1);
    expect(comparePositions('a0', 'a0')).toBe(0);
    expect(comparePositions('a1', 'a0V')).toBe(1);
    const keys = ['a0', 'Zz', 'a0V', 'A00000000000000000000000001', 'b00'];
    expect([...keys].sort(comparePositions)).toEqual([...keys].sort());
  });

  it('validates keys', () => {
    for (const valid of ['a0', 'a1', 'a0V', 'Zz', 'b00', 'zzzzzzzzzzzzzzzzzzzzzzzzzzz']) {
      expect(isValidPosition(valid)).toBe(true);
    }
    for (const invalid of ['', 'a', 'b0', '000', 'a0V0', 'a0:', 'a@', 'a[', 'a`', 'bU', null, undefined]) {
      expect(isValidPosition(invalid)).toBe(false);
    }
  });

  it('steps over invalid neighbours in positionAfter/positionBefore', () => {
    for (const legacy of ['b0', 'bU', 'a0V0', 'Yz', 'a:', '000']) {
      const after = positionAfter(legacy);
      expect(isValidPosition(after)).toBe(true);
      expect(after > legacy).toBe(true);
    }
    for (const legacy of ['b0', 'bU', 'a0V0', 'a:']) {
      const before = positionBefore(legacy);
      expect(isValidPosition(before)).toBe(true);
      expect(before < legacy).toBe(true);
    }
    // Nothing valid sorts before '000' (all keys start with a letter).
    expect(() => positionBefore('000')).toThrow(InvalidPositionError);
  });

  it('throws on invalid or non-ascending neighbours in positionBetween', () => {
    expect(() => positionBetween('a1', 'a0')).toThrow(InvalidPositionError);
    expect(() => positionBetween('a0', 'a0')).toThrow(InvalidPositionError);
    expect(() => positionBetween('b0', 'b1')).toThrow(InvalidPositionError);
  });

  it('re-keys a column with generatePositions', () => {
    const keys = generatePositions(100);
    expect(keys).toHaveLength(100);
    expect(arePositionsHealthy(keys)).toBe(true);
    expect(arePositionsHealthy(['a0', 'a0'])).toBe(false);
    expect(arePositionsHealthy(['a0', 'b0'])).toBe(false);
    const inner = generatePositions(5, 'a0', 'a1');
    expect(inner.every((k) => k > 'a0' && k < 'a1')).toBe(true);
  });

  it('property: 10k random inserts stay strictly between their neighbours', () => {
    const rand = mulberry32(42);
    const list: string[] = [];
    for (let i = 0; i < 10_000; i++) {
      insertAt(list, Math.floor(rand() * (list.length + 1)));
    }
    expect(arePositionsHealthy(list)).toBe(true);
    expect([...list].sort(comparePositions)).toEqual(list);
  });

  it('property: 10k adjacent inserts (always after the same item) stay ordered', () => {
    const list: string[] = [initialPosition(), positionAfter(initialPosition())];
    for (let i = 0; i < 10_000; i++) {
      insertAt(list, 1);
    }
    expect(arePositionsHealthy(list)).toBe(true);
  });

  it('property: 10k inserts at the front and at the back stay ordered', () => {
    const list: string[] = [];
    for (let i = 0; i < 5_000; i++) {
      insertAt(list, 0);
      insertAt(list, list.length);
    }
    expect(arePositionsHealthy(list)).toBe(true);
  });
});
