import { describe, expect, test } from 'bun:test';
import { isEditableTarget, matchesStroke, parseCombo, type KeyLike } from './hotkeys';

const key = (k: string, mods: Partial<Omit<KeyLike, 'key'>> = {}): KeyLike => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe('parseCombo', () => {
  test('single key, modifiers and sequences', () => {
    expect(parseCombo('c')).toEqual([{ key: 'c', mod: false, ctrl: false, meta: false, alt: false, shift: undefined }]);
    expect(parseCombo('mod+k')[0]).toMatchObject({ key: 'k', mod: true });
    expect(parseCombo('g then i').map((s) => s.key)).toEqual(['g', 'i']);
    expect(parseCombo('Shift+I')[0]).toMatchObject({ key: 'i', shift: true });
    expect(parseCombo('esc')[0]!.key).toBe('escape');
  });
  test('rejects a combo without a key', () => {
    expect(() => parseCombo('mod+')).toThrow();
  });
});

describe('matchesStroke', () => {
  const [modK] = parseCombo('mod+k');
  const [c] = parseCombo('c');
  const [shiftI] = parseCombo('shift+i');
  const [question] = parseCombo('?');

  test('mod accepts ⌘ or Ctrl', () => {
    expect(matchesStroke(modK!, key('k', { metaKey: true }))).toBe(true);
    expect(matchesStroke(modK!, key('k', { ctrlKey: true }))).toBe(true);
    expect(matchesStroke(modK!, key('k'))).toBe(false);
  });
  test('plain letters ignore modified presses', () => {
    expect(matchesStroke(c!, key('c'))).toBe(true);
    expect(matchesStroke(c!, key('C', { shiftKey: true }))).toBe(false);
    expect(matchesStroke(c!, key('c', { metaKey: true }))).toBe(false);
  });
  test('shift is explicit for letters and implicit for symbols', () => {
    expect(matchesStroke(shiftI!, key('I', { shiftKey: true }))).toBe(true);
    expect(matchesStroke(shiftI!, key('i'))).toBe(false);
    expect(matchesStroke(question!, key('?', { shiftKey: true }))).toBe(true);
  });
});

test('isEditableTarget is false without a DOM element', () => {
  expect(isEditableTarget(null)).toBe(false);
});
