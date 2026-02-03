/**
 * Lexicographic ordering utilities for maintaining item positions.
 * Uses fractional indexing to allow insertions between items without reordering.
 */

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const BASE = ALPHABET.length;

/**
 * Generate a position string between two existing positions.
 * If both are undefined, returns a middle position.
 * If only before is provided, returns a position after it.
 * If only after is provided, returns a position before it.
 */
export function generatePosition(before?: string | null, after?: string | null): string {
  if (!before && !after) {
    return 'a0'; // Start with a middle-ish value
  }

  if (!before) {
    // Generate position before 'after'
    return decrementPosition(after!);
  }

  if (!after) {
    // Generate position after 'before'
    return incrementPosition(before);
  }

  // Generate position between 'before' and 'after'
  return midpoint(before, after);
}

/**
 * Generate an initial position for the first item.
 */
export function initialPosition(): string {
  return 'a0';
}

/**
 * Generate a position after all existing positions.
 */
export function positionAfter(lastPosition?: string | null): string {
  return generatePosition(lastPosition, null);
}

/**
 * Generate a position before all existing positions.
 */
export function positionBefore(firstPosition?: string | null): string {
  return generatePosition(null, firstPosition);
}

/**
 * Generate a position between two items.
 */
export function positionBetween(before: string, after: string): string {
  return generatePosition(before, after);
}

function incrementPosition(pos: string): string {
  const chars = pos.split('');
  let i = chars.length - 1;

  while (i >= 0) {
    const idx = ALPHABET.indexOf(chars[i]!);
    if (idx < BASE - 1) {
      chars[i] = ALPHABET[idx + 1]!;
      return chars.join('');
    }
    chars[i] = ALPHABET[0]!;
    i--;
  }

  // All chars were at max, prepend a character
  return ALPHABET[0] + chars.join('');
}

function decrementPosition(pos: string): string {
  const chars = pos.split('');
  let i = chars.length - 1;

  while (i >= 0) {
    const idx = ALPHABET.indexOf(chars[i]!);
    if (idx > 0) {
      chars[i] = ALPHABET[idx - 1]!;
      return chars.join('');
    }
    chars[i] = ALPHABET[BASE - 1]!;
    i--;
  }

  // All chars were at min, this shouldn't happen with valid positions
  return ALPHABET[0]!;
}

function midpoint(before: string, after: string): string {
  // Ensure both strings are the same length
  const maxLen = Math.max(before.length, after.length);
  const a = before.padEnd(maxLen, ALPHABET[0]!);
  const b = after.padEnd(maxLen, ALPHABET[0]!);

  const result: string[] = [];
  let carry = 0;

  for (let i = maxLen - 1; i >= 0; i--) {
    const aIdx = ALPHABET.indexOf(a[i]!);
    const bIdx = ALPHABET.indexOf(b[i]!);
    const sum = aIdx + bIdx + carry;
    const mid = Math.floor(sum / 2);
    carry = sum % 2;
    result.unshift(ALPHABET[mid]!);
  }

  let pos = result.join('');

  // If the result equals 'before', we need to add more precision
  if (pos <= before) {
    pos = before + ALPHABET[Math.floor(BASE / 2)]!;
  }

  return pos;
}

/**
 * Validate a position string.
 */
export function isValidPosition(pos: string): boolean {
  if (!pos || pos.length === 0) return false;
  return pos.split('').every((char) => ALPHABET.includes(char));
}

/**
 * Compare two positions for sorting.
 */
export function comparePositions(a: string, b: string): number {
  return a.localeCompare(b);
}
