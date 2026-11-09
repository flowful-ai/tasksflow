/**
 * Colour helpers for user-chosen colours (labels, states, projects).
 *
 * Rule from the UI audit: never render text in a raw user hex. Show the
 * colour as a dot (`colorDot`) next to neutral text, or, when text must sit on
 * a coloured fill, pick its colour with `readableTextColor`.
 */
import type { CSSProperties } from 'react';

export const NEUTRAL_DOT = '#a3a3a3';
/** Ink used for dark text (tailwind neutral-900). */
export const INK = '#171717';
export const WHITE = '#ffffff';

/** "#abc" / "abc" / "#aabbcc" → "#aabbcc" (lowercase), or null when invalid. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  const raw = input.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(raw)) {
    return `#${raw
      .split('')
      .map((c) => c + c)
      .join('')
      .toLowerCase()}`;
  }
  if (/^[0-9a-f]{6}$/i.test(raw)) return `#${raw.toLowerCase()}`;
  return null;
}

function channel(hex: string, offset: number): number {
  return parseInt(hex.slice(offset, offset + 2), 16) / 255;
}

function linearize(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** WCAG 2.x relative luminance (0 = black, 1 = white). Invalid input → null. */
export function relativeLuminance(color: string): number | null {
  const hex = normalizeHex(color);
  if (!hex) return null;
  const r = linearize(channel(hex, 1));
  const g = linearize(channel(hex, 3));
  const b = linearize(channel(hex, 5));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio between two colours (1–21). Invalid input → null. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Text colour (ink or white) with the higher WCAG contrast on `background`.
 * Invalid input falls back to ink.
 */
export function readableTextColor(
  background: string | null | undefined,
  dark: string = INK,
  light: string = WHITE
): string {
  const hex = normalizeHex(background);
  if (!hex) return dark;
  const onDark = contrastRatio(hex, light) ?? 0;
  const onLight = contrastRatio(hex, dark) ?? 0;
  return onDark > onLight ? light : dark;
}

/** True when `fg` on `bg` meets WCAG AA (4.5:1 normal text, 3:1 large text). */
export function meetsContrast(fg: string, bg: string, level: 'AA' | 'AA-large' = 'AA'): boolean {
  const ratio = contrastRatio(fg, bg);
  return ratio !== null && ratio >= (level === 'AA' ? 4.5 : 3);
}

/** The colour to paint a dot with: the user's colour when valid, a neutral grey otherwise. */
export function dotColor(color: string | null | undefined): string {
  return normalizeHex(color) ?? NEUTRAL_DOT;
}

/**
 * Inline style for a colour dot. Pair with neutral text:
 *   <span className="h-2 w-2 rounded-full" style={colorDot(label.color)} />
 * (or use the <ColorDot> component).
 */
export function colorDot(color: string | null | undefined): CSSProperties {
  return { backgroundColor: dotColor(color) };
}

const PROJECT_COLORS = [
  '#ef4444',
  '#2563eb',
  '#16a34a',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

/** Stable colour per project (projects have no colour of their own). */
export function projectColor(projectId: string): string {
  // FNV-1a: spreads similar uuids across the palette.
  let hash = 0x811c9dc5;
  for (let i = 0; i < projectId.length; i++) {
    hash ^= projectId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return PROJECT_COLORS[hash % PROJECT_COLORS.length] ?? PROJECT_COLORS[0];
}

// Dark enough for white initials at 9–10px (≥ 4.5:1).
const AVATAR_COLORS = [
  '#6d28d9',
  '#0e7490',
  '#c2410c',
  '#15803d',
  '#1d4ed8',
  '#be185d',
  '#4338ca',
  '#0f766e',
];

/** Stable initials-avatar background for a user id. */
export function avatarColor(id: string): string {
  // FNV-1a: spreads similar ids (sequential uuids) across the palette.
  let hash = 2166136261;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return AVATAR_COLORS[(hash >>> 0) % AVATAR_COLORS.length] ?? AVATAR_COLORS[0];
}
