/** Every keyboard shortcut, for the "?" cheat sheet and the palette hints. */

export interface ShortcutItem {
  /** Keys pressed together; `then` separates a sequence ("g then i"). */
  keys: string[];
  label: string;
  /** Alternative bindings shown after "or". */
  alt?: string[][];
}

export interface ShortcutGroup {
  title: string;
  items: ShortcutItem[];
}

/** Global navigation sequences (also used by the palette for hints). */
export const NAV_SHORTCUTS = [
  { combo: 'g then i', keys: ['G', 'I'], href: '/inbox', label: 'Inbox' },
  { combo: 'g then m', keys: ['G', 'M'], href: '/my-tasks', label: 'My tasks' },
  { combo: 'g then v', keys: ['G', 'V'], href: '/views', label: 'Views' },
  { combo: 'g then p', keys: ['G', 'P'], href: '/projects', label: 'Projects' },
  { combo: 'g then s', keys: ['G', 'S'], href: '/settings', label: 'Settings' },
] as const;

export function shortcutGroups(mod: string): ShortcutGroup[] {
  return [
    {
      title: 'General',
      items: [
        { keys: [mod, 'K'], label: 'Open the command palette' },
        { keys: ['C'], label: 'Create a task (in the current project)' },
        { keys: ['?'], label: 'Show keyboard shortcuts' },
        { keys: ['Esc'], label: 'Close a dialog or menu' },
      ],
    },
    {
      title: 'Go to',
      items: NAV_SHORTCUTS.map((s) => ({ keys: ['G', 'then', s.keys[1]], label: s.label })),
    },
    {
      title: 'Board and list',
      items: [
        { keys: ['J'], label: 'Next task', alt: [['↓']] },
        { keys: ['K'], label: 'Previous task', alt: [['↑']] },
        { keys: ['X'], label: 'Select the focused task' },
        { keys: ['S'], label: 'Change status' },
        { keys: ['A'], label: 'Assign' },
        { keys: ['L'], label: 'Change labels' },
        { keys: ['P'], label: 'Change priority' },
        { keys: ['E'], label: 'Open the task', alt: [['Enter']] },
        { keys: ['⌫'], label: 'Delete (with undo)' },
        { keys: ['Esc'], label: 'Clear the selection' },
      ],
    },
    {
      title: 'Inbox',
      items: [
        { keys: ['J'], label: 'Next notification' },
        { keys: ['K'], label: 'Previous notification' },
        { keys: ['Enter'], label: 'Open the task' },
        { keys: ['E'], label: 'Mark done (archive)' },
        { keys: ['H'], label: 'Snooze until tomorrow 9:00' },
        { keys: ['U'], label: 'Toggle read / unread' },
        { keys: ['Shift', 'I'], label: 'Mark all as read' },
      ],
    },
    {
      title: 'Task detail',
      items: [
        { keys: [mod, 'Enter'], label: 'Post the comment' },
        { keys: ['@'], label: 'Mention a teammate in a comment' },
      ],
    },
  ];
}
