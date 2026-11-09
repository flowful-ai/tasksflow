/**
 * Comment textarea with an @-mention picker. Mentions display as "@Name" in
 * the textarea and are encoded to `@[Name](user:<uuid>)` on submit, which
 * makes the backend notify the mentioned users. ⌘/Ctrl+Enter submits.
 */
import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Send } from 'lucide-react';
import clsx from 'clsx';
import { Avatar, Button, IconButton, Kbd, Textarea } from '../../ui';
import type { PickerMember } from '../AssigneePicker';
import { modKeyLabel } from '../../../lib/hotkeys';
import {
  activeMentionQuery,
  decodeMentions,
  encodeMentions,
  type DraftMention,
} from './mentionText';

interface CommentComposerProps {
  members: PickerMember[];
  /** Resolves when saved; reject to keep the draft. */
  onSubmit: (content: string) => Promise<void>;
  isSubmitting?: boolean;
  /** Existing content (stored form) when editing a comment. */
  initialContent?: string;
  placeholder?: string;
  submitLabel?: string;
  onCancel?: () => void;
  autoFocus?: boolean;
}

const MAX_SUGGESTIONS = 6;

export function CommentComposer({
  members,
  onSubmit,
  isSubmitting = false,
  initialContent,
  placeholder = 'Leave a comment… use @ to mention',
  submitLabel = 'Comment',
  onCancel,
  autoFocus = false,
}: CommentComposerProps) {
  const initial = useMemo(() => decodeMentions(initialContent ?? ''), [initialContent]);
  const [text, setText] = useState(initial.text);
  const [mentions, setMentions] = useState<DraftMention[]>(initial.mentions);
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  /** Caret position to restore right after a mention is inserted (before the next keystroke). */
  const pendingCaret = useRef<number | null>(null);
  const listId = useId();

  useLayoutEffect(() => {
    const caret = pendingCaret.current;
    if (caret === null || !textareaRef.current) return;
    pendingCaret.current = null;
    textareaRef.current.focus();
    textareaRef.current.setSelectionRange(caret, caret);
  }, [text]);

  const suggestions = useMemo(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    return members
      .filter(
        (m) =>
          (m.user.name ?? '').toLowerCase().includes(q) || m.user.email.toLowerCase().includes(q)
      )
      .slice(0, MAX_SUGGESTIONS);
  }, [members, mention]);
  const menuOpen = mention !== null && suggestions.length > 0;

  const syncMention = (value: string, caret: number) => {
    const next = activeMentionQuery(value, caret);
    setMention(next);
    if (next?.query !== mention?.query) setActiveIndex(0);
  };

  const insertMention = (member: PickerMember) => {
    if (!mention) return;
    const name = (member.user.name || member.user.email.split('@')[0] || 'user')
      .replace(/[\]\n]/g, '')
      .trim();
    const caret = textareaRef.current?.selectionStart ?? text.length;
    const before = text.slice(0, mention.start);
    const after = text.slice(caret);
    const inserted = `@${name} `;
    const value = before + inserted + after;
    setText(value);
    setMentions((list) => [
      ...list.filter((m) => m.userId !== member.user.id),
      { userId: member.user.id, name },
    ]);
    setMention(null);
    pendingCaret.current = before.length + inserted.length;
  };

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || isSubmitting) return;
    try {
      await onSubmit(encodeMentions(trimmed, mentions));
      setText('');
      setMentions([]);
      setMention(null);
    } catch {
      // toasted globally; keep the draft
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (menuOpen) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const delta = e.key === 'ArrowDown' ? 1 : -1;
        setActiveIndex((i) => (i + delta + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        const member = suggestions[activeIndex];
        if (member) {
          e.preventDefault();
          insertMention(member);
          return;
        }
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setMention(null);
        return;
      }
    }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && onCancel) {
      e.preventDefault();
      onCancel();
    }
  };

  const activeId = menuOpen ? `${listId}-${activeIndex}` : undefined;

  return (
    <div className="relative">
      <div className="rounded-xl border border-neutral-200 bg-white focus-within:border-primary-400 focus-within:ring-2 focus-within:ring-primary-100">
        <Textarea
          bare
          ref={textareaRef}
          role="combobox"
          aria-label={onCancel ? 'Edit comment' : 'New comment'}
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls={menuOpen ? listId : undefined}
          aria-activedescendant={activeId}
          data-escape-cancels={menuOpen || onCancel ? true : undefined}
          value={text}
          autoFocus={autoFocus}
          onChange={(e) => {
            setText(e.target.value);
            syncMention(e.target.value, e.target.selectionStart);
          }}
          onSelect={(e) => syncMention(e.currentTarget.value, e.currentTarget.selectionStart)}
          onBlur={() => window.setTimeout(() => setMention(null), 150)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          rows={onCancel ? 3 : 2}
          disabled={isSubmitting}
          className="block w-full resize-y rounded-t-xl border-0 bg-transparent px-3 py-2.5 text-base placeholder:text-neutral-400 focus:ring-0 md:text-sm"
        />
        <div className="flex items-center justify-end gap-2 px-2 pb-2">
          <span
            className="mr-auto hidden items-center gap-1 pl-1 text-xs text-neutral-400 sm:flex"
            aria-hidden
          >
            <Kbd>{modKeyLabel()}</Kbd>
            <Kbd>↵</Kbd>
            to send
          </span>
          {onCancel && (
            <Button variant="ghost" size="xs" onClick={onCancel}>
              Cancel
            </Button>
          )}
          {onCancel ? (
            <Button size="xs" onClick={() => void submit()} disabled={!text.trim() || isSubmitting}>
              {submitLabel}
            </Button>
          ) : (
            <IconButton
              label={submitLabel}
              shortcut={`${modKeyLabel()}↵`}
              variant="solid"
              icon={<Send />}
              onClick={() => void submit()}
              disabled={!text.trim() || isSubmitting}
            />
          )}
        </div>
      </div>

      {menuOpen && (
        <ul
          id={listId}
          role="listbox"
          aria-label="Mention a member"
          className="absolute left-2 top-full z-20 mt-1 w-64 overflow-hidden rounded-xl border border-neutral-200 bg-white p-1 shadow-lg"
        >
          {suggestions.map((member, index) => (
            <li
              key={member.userId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                insertMention(member);
              }}
              onMouseEnter={() => setActiveIndex(index)}
              className={clsx(
                'flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm',
                index === activeIndex ? 'bg-neutral-100 text-neutral-900' : 'text-neutral-700'
              )}
            >
              <Avatar
                src={member.user.avatarUrl}
                name={member.user.name}
                email={member.user.email}
                size="xs"
              />
              <span className="truncate">{member.user.name || member.user.email}</span>
              {member.user.name && (
                <span className="ml-auto truncate text-xs text-neutral-400">
                  {member.user.email}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
