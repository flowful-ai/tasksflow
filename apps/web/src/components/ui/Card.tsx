/**
 * Surfaces.
 *
 * Card: the white settings/content card (`.card`), with an optional header.
 *
 *   <Card title="Workspace" description="General details." actions={<Button…/>}>
 *     …form…
 *   </Card>
 *   <Card tone="danger" title="Danger Zone" icon={<AlertTriangle />}>…</Card>
 *
 * Panel: a plain bordered box inside a card or list (rows, sub-sections).
 *
 *   <Panel className="flex items-center justify-between">…</Panel>
 *   <Panel tone="danger">…</Panel>
 */
import { useId, type HTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';

export interface CardProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  description?: ReactNode;
  /** Shown at the right of the header. */
  actions?: ReactNode;
  /** Icon before the title. */
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  /** 'md' = p-6 (default), 'sm' = p-4, 'none' = no padding (lists, tables). */
  padding?: 'none' | 'sm' | 'md';
  /** Render as a <section> labelled by the title (default when a title is set). */
  as?: 'section' | 'div';
}

const PADDING = { none: '', sm: 'p-4', md: 'p-6' } as const;

export function Card({
  title,
  description,
  actions,
  icon,
  tone = 'default',
  padding = 'md',
  as,
  className,
  children,
  ...props
}: CardProps) {
  const titleId = useId();
  const Tag = as ?? (title ? 'section' : 'div');
  return (
    <Tag
      aria-labelledby={title && Tag === 'section' ? titleId : undefined}
      className={clsx(
        'card',
        tone === 'danger' && 'border border-red-100',
        PADDING[padding],
        className
      )}
      {...props}
    >
      {(title || actions) && (
        <div
          className={clsx(
            'mb-4 flex items-start justify-between gap-4',
            padding === 'none' && 'px-6 pt-6'
          )}
        >
          <div className="min-w-0">
            {title && (
              <h2
                id={titleId}
                className="flex items-center gap-2 text-lg font-semibold text-neutral-900"
              >
                {icon && (
                  <span
                    aria-hidden
                    className={clsx(
                      'inline-flex shrink-0 [&>svg]:h-5 [&>svg]:w-5',
                      tone === 'danger' && 'text-red-600'
                    )}
                  >
                    {icon}
                  </span>
                )}
                {title}
              </h2>
            )}
            {description && <p className="text-sm text-neutral-500">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {children}
    </Tag>
  );
}

export interface PanelProps extends HTMLAttributes<HTMLElement> {
  tone?: 'default' | 'danger' | 'muted';
  padding?: 'none' | 'sm' | 'md';
  /** Element to render (a list row, a section). */
  as?: 'div' | 'li' | 'section';
}

const PANEL_TONES = {
  default: 'border-neutral-200',
  danger: 'border-red-200 bg-red-50/40',
  muted: 'border-neutral-200 bg-neutral-50',
} as const;

const PANEL_PADDING = { none: '', sm: 'p-3', md: 'p-4' } as const;

export function Panel({
  tone = 'default',
  padding = 'md',
  as: Tag = 'div',
  className,
  children,
  ...props
}: PanelProps) {
  return (
    <Tag
      className={clsx('rounded-lg border', PANEL_TONES[tone], PANEL_PADDING[padding], className)}
      {...props}
    >
      {children}
    </Tag>
  );
}
