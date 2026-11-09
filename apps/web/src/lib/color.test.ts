import { describe, expect, test } from 'bun:test';
import {
  colorDot,
  contrastRatio,
  dotColor,
  meetsContrast,
  normalizeHex,
  readableTextColor,
  relativeLuminance,
  INK,
  WHITE,
} from './color';

describe('normalizeHex', () => {
  test('expands and lowercases', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('EF4444')).toBe('#ef4444');
    expect(normalizeHex(' #ef4444 ')).toBe('#ef4444');
  });
  test('rejects invalid input', () => {
    expect(normalizeHex('red')).toBeNull();
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex(null)).toBeNull();
  });
});

describe('WCAG contrast', () => {
  test('luminance of black and white', () => {
    expect(relativeLuminance('#000')).toBe(0);
    expect(relativeLuminance('#fff')).toBeCloseTo(1, 5);
  });
  test('black on white is 21:1', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#777', '#777')).toBeCloseTo(1, 5);
  });
  test('meetsContrast', () => {
    expect(meetsContrast('#767676', '#ffffff')).toBe(true); // 4.54:1
    expect(meetsContrast('#777777', '#ffffff')).toBe(false); // 4.48:1
    expect(meetsContrast('#777777', '#ffffff', 'AA-large')).toBe(true);
  });
});

describe('readableTextColor', () => {
  test('dark text on light fills, white on dark fills', () => {
    expect(readableTextColor('#fef08a')).toBe(INK); // yellow-200
    expect(readableTextColor('#ffffff')).toBe(INK);
    expect(readableTextColor('#1e3a8a')).toBe(WHITE); // blue-900
    expect(readableTextColor('#000')).toBe(WHITE);
  });
  test('picks the higher-contrast option for mid tones', () => {
    for (const bg of ['#ef4444', '#16a34a', '#2563eb', '#7c3aed', '#d97706', '#a3a3a3']) {
      const fg = readableTextColor(bg);
      const other = fg === INK ? WHITE : INK;
      expect(contrastRatio(fg, bg)!).toBeGreaterThanOrEqual(contrastRatio(other, bg)!);
    }
  });
  test('invalid colours fall back to ink', () => {
    expect(readableTextColor('nope')).toBe(INK);
    expect(readableTextColor(undefined)).toBe(INK);
  });
});

describe('colorDot', () => {
  test('uses the colour when valid, a neutral grey otherwise', () => {
    expect(colorDot('#ABC')).toEqual({ backgroundColor: '#aabbcc' });
    expect(dotColor('javascript:alert(1)')).toBe('#a3a3a3');
  });
});
