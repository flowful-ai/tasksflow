/**
 * Tiny keyboard shortcut registry.
 *
 *   useHotkey('mod+k', openPalette, { allowInInputs: true, allowInDialogs: true });
 *   useHotkey('c', createTask);
 *   useHotkey('g then i', () => navigate('/inbox'));
 *   useHotkey('shift+i', markAllRead, { enabled: isInbox });
 *
 * Grammar: strokes joined by " then " (two-stroke sequences such as "g then i"),
 * each stroke is modifiers + key joined by "+": `mod` (⌘ on macOS, Ctrl
 * elsewhere), `ctrl`, `meta`, `alt`, `shift`. Keys are `KeyboardEvent.key`
 * values, case-insensitive ("k", "?", "enter", "escape", "arrowdown",
 * "backspace").
 *
 * One document listener serves every registration; the most recently
 * registered match wins and only one handler runs per key press. Events from
 * inputs, textareas, selects and contenteditable are ignored unless
 * `allowInInputs`, and shortcuts are muted while a modal dialog is open
 * unless `allowInDialogs`. Menus, listboxes and comboboxes count as inputs.
 */
import { useEffect, useRef } from 'react';

export interface KeyStroke {
  key: string;
  mod: boolean;
  ctrl: boolean;
  meta: boolean;
  alt: boolean;
  /** undefined: not specified (letters then require no Shift; symbols ignore it). */
  shift: boolean | undefined;
}

/** The parts of a KeyboardEvent the matcher reads (testable without a DOM). */
export interface KeyLike {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export interface HotkeyOptions {
  enabled?: boolean;
  /** Also fire while typing in an input, textarea or contenteditable. */
  allowInInputs?: boolean;
  /** Also fire while a modal dialog is open. */
  allowInDialogs?: boolean;
  /** Call preventDefault on the event (default true). */
  preventDefault?: boolean;
  /** Extra condition checked on each press (e.g. only when focus is on the page body). */
  when?: (event: KeyboardEvent) => boolean;
}

export type HotkeyHandler = (event: KeyboardEvent) => void;

/** Max delay between the two strokes of a sequence. */
export const SEQUENCE_TIMEOUT_MS = 1000;

const KEY_ALIASES: Record<string, string> = {
  esc: 'escape',
  return: 'enter',
  del: 'delete',
  space: ' ',
  up: 'arrowup',
  down: 'arrowdown',
  left: 'arrowleft',
  right: 'arrowright',
  plus: '+',
};

function parseStroke(stroke: string): KeyStroke {
  // "shift++" style is not supported; use "plus".
  const parts = stroke.trim().toLowerCase().split('+').filter((p) => p.length > 0);
  const result: KeyStroke = { key: '', mod: false, ctrl: false, meta: false, alt: false, shift: undefined };
  for (const part of parts) {
    if (part === 'mod') result.mod = true;
    else if (part === 'ctrl' || part === 'control') result.ctrl = true;
    else if (part === 'meta' || part === 'cmd') result.meta = true;
    else if (part === 'alt' || part === 'option') result.alt = true;
    else if (part === 'shift') result.shift = true;
    else result.key = KEY_ALIASES[part] ?? part;
  }
  if (!result.key) throw new Error(`Invalid hotkey "${stroke}"`);
  return result;
}

/** "g then i" → two strokes; "mod+k" → one. */
export function parseCombo(combo: string): KeyStroke[] {
  return combo.split(/\s+then\s+/i).map(parseStroke);
}

const isLetter = (key: string) => /^[a-z]$/.test(key);

export function matchesStroke(stroke: KeyStroke, event: KeyLike): boolean {
  const key = event.key.toLowerCase();
  if (key !== stroke.key) return false;
  const wantsMeta = stroke.meta;
  const wantsCtrl = stroke.ctrl;
  if (stroke.mod) {
    if (!event.metaKey && !event.ctrlKey) return false;
  } else {
    if (event.metaKey !== wantsMeta) return false;
    if (event.ctrlKey !== wantsCtrl) return false;
  }
  if (event.altKey !== stroke.alt) return false;
  if (stroke.shift === true && !event.shiftKey) return false;
  if (stroke.shift === undefined && isLetter(stroke.key) && event.shiftKey) return false;
  return true;
}

/** Inputs, textareas, selects and contenteditable regions own their keys. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === 'undefined' || !(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (target.getAttribute('type') ?? 'text').toLowerCase();
    return !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color'].includes(type);
  }
  return false;
}

/** Menus, listboxes and comboboxes use letters and arrows themselves (typeahead, navigation). */
function isWidgetTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[role="menu"], [role="listbox"], [role="combobox"], [cmdk-root]') !== null;
}

function hasOpenModal(): boolean {
  return (
    document.querySelector('[role="dialog"][aria-modal="true"], [role="alertdialog"], [role="menu"][data-state="open"]') !== null
  );
}

interface Registration {
  strokes: KeyStroke[];
  handler: { current: HotkeyHandler };
  options: { current: HotkeyOptions };
}

const registry: Registration[] = [];
let pending: { event: KeyLike; at: number } | null = null;
let listening = false;

function snapshot(event: KeyboardEvent): KeyLike {
  return {
    key: event.key,
    ctrlKey: event.ctrlKey,
    metaKey: event.metaKey,
    altKey: event.altKey,
    shiftKey: event.shiftKey,
  };
}

function fire(registration: Registration, event: KeyboardEvent): void {
  if (registration.options.current.preventDefault ?? true) event.preventDefault();
  registration.handler.current(event);
}

function onKeyDown(event: KeyboardEvent): void {
  if (event.defaultPrevented || event.isComposing) return;
  const editable = isEditableTarget(event.target) || isWidgetTarget(event.target);
  const modalOpen = hasOpenModal();
  const eligible = (r: Registration) => {
    const o = r.options.current;
    return (
      (o.enabled ?? true) &&
      (!editable || Boolean(o.allowInInputs)) &&
      (!modalOpen || Boolean(o.allowInDialogs)) &&
      (o.when ? o.when(event) : true)
    );
  };
  // Newest registration first.
  const candidates = registry.filter(eligible).reverse();

  const previous = pending;
  pending = null;
  if (previous && Date.now() - previous.at <= SEQUENCE_TIMEOUT_MS) {
    const completed = candidates.find(
      (r) => r.strokes.length === 2 && matchesStroke(r.strokes[0], previous.event) && matchesStroke(r.strokes[1], event)
    );
    if (completed) {
      fire(completed, event);
      return;
    }
  }

  if (candidates.some((r) => r.strokes.length === 2 && matchesStroke(r.strokes[0], event))) {
    pending = { event: snapshot(event), at: Date.now() };
  }

  const single = candidates.find((r) => r.strokes.length === 1 && matchesStroke(r.strokes[0], event));
  if (single) fire(single, event);
}

function register(registration: Registration): () => void {
  registry.push(registration);
  if (!listening && typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown);
    listening = true;
  }
  return () => {
    const index = registry.indexOf(registration);
    if (index >= 0) registry.splice(index, 1);
    if (registry.length === 0 && listening) {
      document.removeEventListener('keydown', onKeyDown);
      listening = false;
      pending = null;
    }
  };
}

/** Bind `combo` while the component is mounted. The handler may change on every render. */
export function useHotkey(combo: string, handler: HotkeyHandler, options: HotkeyOptions = {}): void {
  const handlerRef = useRef(handler);
  const optionsRef = useRef(options);
  handlerRef.current = handler;
  optionsRef.current = options;

  useEffect(() => {
    return register({ strokes: parseCombo(combo), handler: handlerRef, options: optionsRef });
  }, [combo]);
}

export function isMac(): boolean {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);
}

export function modKeyLabel(): string {
  return isMac() ? '⌘' : 'Ctrl';
}
