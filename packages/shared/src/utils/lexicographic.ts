/**
 * Fractional ("lexicographic") ordering keys for drag-and-drop positions.
 *
 * Keys come from the `fractional-indexing` package (base-62 digits, A-Z/a-z
 * integer heads, e.g. "a0", "a1", "a0V", "Zz"). They must be compared by
 * plain code-unit order: in JS use `comparePositions` (never `localeCompare`),
 * and in Postgres the `tasks.position` column uses `COLLATE "C"`.
 *
 * Keys written by the pre-v2 generator may be invalid ("b0", "000", "a0V0",
 * keys containing ':' or '@', duplicates). `positionAfter`/`positionBefore`
 * step over an invalid neighbour when they can. `positionBetween` throws
 * `InvalidPositionError` when a neighbour is invalid or the pair is not
 * strictly ascending; a caller holding the whole column should then re-key it
 * with `generatePositions` (TaskService does this inside the move transaction).
 */
import { generateKeyBetween, generateNKeysBetween } from 'fractional-indexing';

const BASE62 = /^[0-9A-Za-z]+$/;
const HEADS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const INITIAL_POSITION = 'a0';

export class InvalidPositionError extends Error {
  readonly positions: readonly (string | null)[];

  constructor(message: string, positions: readonly (string | null)[]) {
    super(message);
    this.name = 'InvalidPositionError';
    this.positions = positions;
  }
}

/** Integer-part length implied by a head character (see fractional-indexing). */
function integerLength(headIndex: number): number {
  const half = HEADS.length / 2;
  return headIndex < half ? half - headIndex + 1 : headIndex - half + 2;
}

/** The smallest valid key whose integer part starts with HEADS[i]. */
function smallestKeyForHead(i: number): string {
  const key = HEADS[i]! + '0'.repeat(integerLength(i) - 1);
  // "A000…0" (the smallest integer) is reserved by fractional-indexing.
  return i === 0 ? `${key}1` : key;
}

/** The largest integer key whose integer part starts with HEADS[i]. */
function largestIntegerForHead(i: number): string {
  return HEADS[i]! + 'z'.repeat(integerLength(i) - 1);
}

/**
 * Validate a position string: a well-formed fractional-indexing key made only
 * of base-62 characters.
 */
export function isValidPosition(pos: string | null | undefined): pos is string {
  if (!pos || !BASE62.test(pos)) return false;
  try {
    generateKeyBetween(pos, null);
    return true;
  } catch {
    return false;
  }
}

/** Compare two positions by code unit (the same order as `COLLATE "C"`). */
export function comparePositions(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** The position for the first item of an empty list. */
export function initialPosition(): string {
  return INITIAL_POSITION;
}

/** Smallest "head" key that sorts strictly after `pos` (used to step over invalid keys). */
function validKeyAbove(pos: string): string | null {
  for (let i = 0; i < HEADS.length; i++) {
    const candidate = smallestKeyForHead(i);
    if (candidate > pos) return candidate;
  }
  const largest = largestIntegerForHead(HEADS.length - 1);
  return largest > pos ? largest : null;
}

/** Largest integer key that sorts strictly before `pos`. */
function validKeyBelow(pos: string): string | null {
  for (let i = HEADS.length - 1; i >= 0; i--) {
    const candidate = largestIntegerForHead(i);
    if (candidate < pos) return candidate;
  }
  return null;
}

/**
 * A position after `lastPosition` (or the initial position when there is none).
 * An invalid `lastPosition` is stepped over: the result is a valid key that
 * still sorts after it.
 */
export function positionAfter(lastPosition?: string | null): string {
  if (!lastPosition) return INITIAL_POSITION;
  if (isValidPosition(lastPosition)) return generateKeyBetween(lastPosition, null);
  const above = validKeyAbove(lastPosition);
  if (!above) {
    throw new InvalidPositionError(
      `No valid position sorts after ${JSON.stringify(lastPosition)}`,
      [lastPosition, null]
    );
  }
  return above;
}

/**
 * A position before `firstPosition` (or the initial position when there is none).
 * An invalid `firstPosition` is stepped over when a valid key below it exists.
 */
export function positionBefore(firstPosition?: string | null): string {
  if (!firstPosition) return INITIAL_POSITION;
  if (isValidPosition(firstPosition)) return generateKeyBetween(null, firstPosition);
  const below = validKeyBelow(firstPosition);
  if (!below) {
    throw new InvalidPositionError(
      `No valid position sorts before ${JSON.stringify(firstPosition)}`,
      [null, firstPosition]
    );
  }
  return below;
}

/**
 * A position strictly between `before` and `after`.
 *
 * @throws InvalidPositionError when either key is invalid or `before >= after`.
 */
export function positionBetween(before: string, after: string): string {
  if (!isValidPosition(before) || !isValidPosition(after)) {
    throw new InvalidPositionError(`Invalid neighbour position ("${before}", "${after}")`, [
      before,
      after,
    ]);
  }
  if (comparePositions(before, after) >= 0) {
    throw new InvalidPositionError(`Positions are not ascending ("${before}" >= "${after}")`, [
      before,
      after,
    ]);
  }
  return generateKeyBetween(before, after);
}

/**
 * Generate a position between two optional neighbours. Kept for callers that
 * predate positionBetween/After/Before; same semantics and errors.
 */
export function generatePosition(before?: string | null, after?: string | null): string {
  if (!before && !after) return INITIAL_POSITION;
  if (!before) return positionBefore(after);
  if (!after) return positionAfter(before);
  return positionBetween(before, after);
}

/**
 * `n` ascending valid keys strictly between two optional valid neighbours.
 * With no neighbours this returns ["a0", "a1", ...], which is what a re-key of
 * a whole column uses.
 *
 * @throws InvalidPositionError when a neighbour is invalid or they are not ascending.
 */
export function generatePositions(
  n: number,
  before?: string | null,
  after?: string | null
): string[] {
  if (n <= 0) return [];
  if ((before && !isValidPosition(before)) || (after && !isValidPosition(after))) {
    throw new InvalidPositionError(`Invalid neighbour position ("${before}", "${after}")`, [
      before ?? null,
      after ?? null,
    ]);
  }
  if (before && after && comparePositions(before, after) >= 0) {
    throw new InvalidPositionError(`Positions are not ascending ("${before}" >= "${after}")`, [
      before,
      after,
    ]);
  }
  return generateNKeysBetween(before ?? null, after ?? null, n);
}

/**
 * True when the keys are all valid and strictly ascending in code-unit order,
 * i.e. a new key can be generated between any adjacent pair without a re-key.
 */
export function arePositionsHealthy(positions: readonly string[]): boolean {
  for (let i = 0; i < positions.length; i++) {
    if (!isValidPosition(positions[i])) return false;
    if (i > 0 && comparePositions(positions[i - 1]!, positions[i]!) >= 0) return false;
  }
  return true;
}
