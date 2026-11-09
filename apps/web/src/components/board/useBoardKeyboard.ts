/**
 * Board/list selection and board-scoped shortcuts.
 *
 *   ⌘/Ctrl-click toggles a card, Shift-click selects a range, X toggles the
 *   focused card, Escape clears. J/K move through cards in reading order,
 *   arrows move within (↑↓) and across (←→) columns. S/A/L/P open the status,
 *   assignee, label and priority pickers for the selection (or the focused
 *   card), ⌫/Delete deletes, E opens.
 *
 * Navigation reads the DOM (`[data-column]` / `[data-task-id]` inside the
 * container), so it follows exactly what is rendered in board and list views.
 * C and ⌘K are global shortcuts owned elsewhere and are never handled here.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import type { TaskOpenEvent } from '../task-display/TaskCard';

export type BulkPicker = 'status' | 'assign' | 'label' | 'priority' | 'delete';

const PICKER_KEYS: Record<string, BulkPicker> = { s: 'status', a: 'assign', l: 'label', p: 'priority' };

function isElement(target: EventTarget | null): target is Element {
  return target instanceof Element;
}

function isHTMLElement(node: Element | null | undefined): node is HTMLElement {
  return node instanceof HTMLElement;
}

export function isTypingTarget(target: Element): boolean {
  if (target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  return false;
}

function cardsIn(root: Element): HTMLElement[] {
  return Array.from(root.querySelectorAll('[data-task-id]')).filter(isHTMLElement);
}

function focusCard(card: HTMLElement | undefined) {
  if (!card) return;
  card.focus();
  card.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

/** The card `step` away from `current` (reading order, or within/across columns). */
export function findNeighbourCard(
  container: Element,
  current: HTMLElement | null,
  direction: 'next' | 'prev' | 'up' | 'down' | 'left' | 'right'
): HTMLElement | undefined {
  const all = cardsIn(container);
  if (!current) return all[0];
  if (direction === 'next' || direction === 'prev') {
    const index = all.indexOf(current);
    return all[direction === 'next' ? Math.min(all.length - 1, index + 1) : Math.max(0, index - 1)];
  }
  const column = current.closest('[data-column]');
  if (!column) return undefined;
  const inColumn = cardsIn(column);
  const index = inColumn.indexOf(current);
  if (direction === 'up') return inColumn[Math.max(0, index - 1)];
  if (direction === 'down') return inColumn[Math.min(inColumn.length - 1, index + 1)];
  const columns = Array.from(container.querySelectorAll('[data-column]'));
  const step = direction === 'right' ? 1 : -1;
  for (let i = columns.indexOf(column) + step; i >= 0 && i < columns.length; i += step) {
    const cards = cardsIn(columns[i]!);
    if (cards.length > 0) return cards[Math.min(index, cards.length - 1)];
  }
  return undefined;
}

export interface BoardKeyboardOptions {
  containerRef: RefObject<HTMLElement>;
  /** Ids of the tasks currently shown (stale selections are dropped). */
  visibleIds: readonly string[];
  onOpen: (taskId: string) => void;
  /** Delete one task (with undo). Several go through the confirm picker. */
  onDeleteOne: (taskId: string) => void;
  /** False while a dialog/sheet owns the keyboard. */
  enabled?: boolean;
}

export function useBoardKeyboard({ containerRef, visibleIds, onOpen, onDeleteOne, enabled = true }: BoardKeyboardOptions) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [picker, setPicker] = useState<BulkPicker | null>(null);
  const anchorRef = useRef<string | null>(null);

  // Drop selections that are no longer visible (deleted, filtered out).
  useEffect(() => {
    setSelectedIds((previous) => {
      if (previous.size === 0) return previous;
      const visible = new Set(visibleIds);
      const next = new Set([...previous].filter((id) => visible.has(id)));
      return next.size === previous.size ? previous : next;
    });
  }, [visibleIds]);

  const clearSelection = useCallback(() => {
    setSelectedIds((previous) => (previous.size === 0 ? previous : new Set()));
    setPicker(null);
    anchorRef.current = null;
  }, []);

  const toggle = useCallback((taskId: string) => {
    anchorRef.current = taskId;
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const selectRange = useCallback(
    (taskId: string) => {
      const container = containerRef.current;
      const anchor = anchorRef.current;
      if (!container || !anchor) {
        toggle(taskId);
        return;
      }
      const order = cardsIn(container).map((card) => card.dataset.taskId ?? '');
      const from = order.indexOf(anchor);
      const to = order.indexOf(taskId);
      if (from < 0 || to < 0) {
        toggle(taskId);
        return;
      }
      const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
      setSelectedIds((previous) => new Set([...previous, ...range]));
    },
    [containerRef, toggle]
  );

  const onOpenRef = useRef(onOpen);
  onOpenRef.current = onOpen;
  const onDeleteOneRef = useRef(onDeleteOne);
  onDeleteOneRef.current = onDeleteOne;
  const selectedRef = useRef(selectedIds);
  selectedRef.current = selectedIds;

  /** Stable click handler for every card. */
  const onTaskClick = useCallback(
    (taskId: string, event: TaskOpenEvent) => {
      if (event.shiftKey) {
        selectRange(taskId);
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        toggle(taskId);
        return;
      }
      if (selectedRef.current.size > 0) clearSelection();
      onOpenRef.current(taskId);
    },
    [selectRange, toggle, clearSelection]
  );

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!enabledRef.current || event.defaultPrevented) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const container = containerRef.current;
      const target = event.target;
      if (!container || !isElement(target)) return;
      if (isTypingTarget(target)) return;
      if (target.closest('[role="dialog"], [role="menu"], [role="listbox"], [data-radix-popper-content-wrapper]')) return;
      // A keyboard drag in progress owns the arrow keys.
      if (container.querySelector('[data-dragging="true"]')) return;

      const inBoard = container.contains(target);
      const inBoardChrome = !inBoard && target.closest('[data-board-scope]') !== null;
      const hasSelection = selectedRef.current.size > 0;
      const onPage = target === document.body || target === document.documentElement || inBoardChrome;
      if (!inBoard && !(hasSelection && onPage)) return;

      const cardNode = inBoard ? target.closest('[data-task-id]') : null;
      const card = isHTMLElement(cardNode) ? cardNode : null;
      const focusedId = card?.dataset.taskId ?? null;
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

      const move = (direction: Parameters<typeof findNeighbourCard>[2]) => {
        event.preventDefault();
        focusCard(findNeighbourCard(container, card, direction));
      };

      switch (key) {
        case 'j':
          return move('next');
        case 'k':
          return move('prev');
        case 'ArrowDown':
          return move(card ? 'down' : 'next');
        case 'ArrowUp':
          return move(card ? 'up' : 'prev');
        case 'ArrowRight':
          return card ? move('right') : undefined;
        case 'ArrowLeft':
          return card ? move('left') : undefined;
        case 'x':
          if (!focusedId) return;
          event.preventDefault();
          toggle(focusedId);
          return;
        case 'Escape':
          if (!hasSelection) return;
          event.preventDefault();
          clearSelection();
          return;
        case 'e':
          if (!focusedId) return;
          event.preventDefault();
          onOpenRef.current(focusedId);
          return;
        case 'Backspace':
        case 'Delete': {
          const targets = hasSelection ? [...selectedRef.current] : focusedId ? [focusedId] : [];
          if (targets.length === 0) return;
          event.preventDefault();
          if (targets.length === 1) {
            onDeleteOneRef.current(targets[0]!);
            if (hasSelection) clearSelection();
          } else {
            setPicker('delete');
          }
          return;
        }
        default: {
          const wanted = PICKER_KEYS[key];
          if (!wanted || event.shiftKey) return;
          if (!hasSelection) {
            if (!focusedId) return;
            anchorRef.current = focusedId;
            setSelectedIds(new Set([focusedId]));
          }
          event.preventDefault();
          setPicker(wanted);
        }
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [containerRef, toggle, clearSelection]);

  return { selectedIds, picker, setPicker, onTaskClick, clearSelection, toggle };
}
