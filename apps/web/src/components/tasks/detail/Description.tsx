import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { Markdown } from './Markdown';

interface TitleProps {
  title: string;
  readOnly?: boolean;
  onSave: (title: string) => Promise<void> | void;
}

/** Inline-editable title: click (or Enter on focus) to edit, Enter saves, Escape cancels. */
export function TaskTitle({ title, readOnly = false, onSave }: TitleProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(title);
  }, [title, editing]);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const save = async () => {
    const next = draft.trim();
    setEditing(false);
    if (next && next !== title) await onSave(next);
    else setDraft(title);
  };

  if (readOnly) {
    return <h2 className="text-xl font-semibold leading-snug text-neutral-900 sm:text-2xl">{title}</h2>;
  }

  if (editing) {
    return (
      <textarea
        ref={inputRef}
        aria-label="Task title"
        data-escape-cancels
        value={draft}
        rows={Math.min(4, Math.max(1, Math.ceil(draft.length / 60)))}
        onChange={(e) => setDraft(e.target.value.replace(/\n/g, ' '))}
        onBlur={() => void save()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            setDraft(title);
            setEditing(false);
          }
        }}
        className="-mx-2 w-[calc(100%+1rem)] resize-none rounded-lg border border-primary-300 px-2 py-1 text-xl font-semibold leading-snug text-neutral-900 focus:border-primary-500 focus:ring-2 focus:ring-primary-500 sm:text-2xl"
      />
    );
  }

  return (
    <h2 className="text-xl font-semibold leading-snug text-neutral-900 sm:text-2xl">
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="-mx-2 w-[calc(100%+1rem)] rounded-lg px-2 py-1 text-left transition-colors hover:bg-neutral-50"
        aria-label={`Title: ${title}. Click to edit`}
      >
        {title}
      </button>
    </h2>
  );
}

interface DescriptionProps {
  description: string | null;
  readOnly?: boolean;
  onSave: (description: string) => Promise<void> | void;
}

/** Markdown description: rendered (sanitized) until clicked, then a textarea. ⌘↵ saves, Escape cancels. */
export function TaskDescription({ description, readOnly = false, onSave }: DescriptionProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(description ?? '');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(description ?? '');
  }, [description, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    setEditing(false);
    const next = draft.trim();
    if (next !== (description ?? '')) await onSave(next);
  };
  const cancel = () => {
    setDraft(description ?? '');
    setEditing(false);
  };

  if (editing && !readOnly) {
    return (
      <div className="space-y-2">
        <textarea
          ref={inputRef}
          aria-label="Description (markdown)"
          data-escape-cancels
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void save();
            }
          }}
          placeholder="Add a description… (markdown supported)"
          className="min-h-[140px] w-full resize-y rounded-lg border border-primary-300 px-3 py-2 text-base focus:border-primary-500 focus:ring-2 focus:ring-primary-500 md:text-sm"
        />
        <div className="flex justify-end gap-2">
          <button type="button" className="btn btn-ghost px-3 py-1.5 text-sm" onClick={cancel}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary px-3 py-1.5 text-sm" onClick={() => void save()}>
            Save
          </button>
        </div>
      </div>
    );
  }

  if (readOnly) {
    return description ? <Markdown>{description}</Markdown> : <p className="text-sm italic text-neutral-400">No description</p>;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Edit description"
      onClick={(e) => {
        // Let links inside the rendered markdown work.
        if (e.target instanceof HTMLElement && e.target.closest('a')) return;
        setEditing(true);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault();
          setEditing(true);
        }
      }}
      className={clsx('-mx-2 min-h-[48px] cursor-text rounded-lg px-2 py-1.5 transition-colors hover:bg-neutral-50')}
    >
      {description ? (
        <Markdown>{description}</Markdown>
      ) : (
        <span className="text-sm text-neutral-400">Add a description…</span>
      )}
    </div>
  );
}
