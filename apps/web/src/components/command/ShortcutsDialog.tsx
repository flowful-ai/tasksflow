import { Fragment } from 'react';
import { Dialog, Kbd } from '../ui';
import { modKeyLabel } from '../../lib/hotkeys';
import { useUiStore } from '../../stores/ui';
import { shortcutGroups, type ShortcutItem } from './shortcuts';

function Keys({ keys }: { keys: string[] }) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, index) =>
        key === 'then' ? (
          <span key={index} className="text-xs text-neutral-400">
            then
          </span>
        ) : (
          <Kbd key={index}>{key}</Kbd>
        )
      )}
    </span>
  );
}

function ShortcutRow({ item }: { item: ShortcutItem }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <dt className="text-sm text-neutral-700">{item.label}</dt>
      <dd className="flex shrink-0 items-center gap-1.5">
        <Keys keys={item.keys} />
        {item.alt?.map((alt, index) => (
          <Fragment key={index}>
            <span className="text-xs text-neutral-400">or</span>
            <Keys keys={alt} />
          </Fragment>
        ))}
      </dd>
    </div>
  );
}

/** The "?" cheat sheet: every shortcut, grouped. */
export function ShortcutsDialog() {
  const open = useUiStore((s) => s.shortcutsOpen);
  const setOpen = useUiStore((s) => s.setShortcutsOpen);
  const groups = shortcutGroups(modKeyLabel());

  return (
    <Dialog open={open} onOpenChange={setOpen} title="Keyboard shortcuts" size="xl">
      <div className="grid gap-x-8 gap-y-5 sm:grid-cols-2">
        {groups.map((group) => (
          <section key={group.title} aria-labelledby={`shortcuts-${group.title}`}>
            <h3
              id={`shortcuts-${group.title}`}
              className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-neutral-500"
            >
              {group.title}
            </h3>
            <dl className="divide-y divide-neutral-100">
              {group.items.map((item) => (
                <ShortcutRow key={item.label} item={item} />
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
