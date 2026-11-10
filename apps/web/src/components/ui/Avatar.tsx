/**
 * User avatar: the provider image, else initials on a colour.
 *
 *   <Avatar src={user.avatarUrl} name={user.name} email={user.email} size="md" />
 *   <Avatar name={m.name} seed={m.id} />                 // stable colour per user
 *   <Avatar tone="brand" name={user.name} size="lg" />    // sidebar
 *   <Avatar color="#ef4444"><Clock /></Avatar>             // custom content
 *   <AvatarStack users={task.assignees} max={3} />
 *
 * Decorative (aria-hidden): put the person's name in visible text or an
 * sr-only label next to it.
 */
import type { ReactNode } from 'react';
import clsx from 'clsx';
import { initials } from '../../lib/account';
import { avatarColor } from '../../lib/color';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
/** Fallback colouring when there is no image. */
export type AvatarTone = 'seeded' | 'primary' | 'neutral' | 'brand';

export interface AvatarProps {
  src?: string | null;
  name?: string | null;
  email?: string | null;
  /** Id that picks a stable colour (tone 'seeded'). */
  seed?: string;
  size?: AvatarSize;
  tone?: AvatarTone;
  /** Explicit background colour (overrides tone). */
  color?: string;
  /** White ring, for overlapping stacks. */
  ring?: boolean;
  /** Replaces the initials (an icon or short text). */
  children?: ReactNode;
  className?: string;
}

const SIZES: Record<AvatarSize, string> = {
  xs: 'h-5 w-5 text-[9px] font-bold',
  sm: 'h-6 w-6 text-xs font-medium',
  md: 'h-7 w-7 text-[11px] font-bold',
  lg: 'h-8 w-8 text-sm font-semibold',
  xl: 'h-10 w-10 font-medium',
  '2xl': 'h-16 w-16 text-xl font-semibold',
};

const TONES: Record<AvatarTone, string> = {
  seeded: 'text-white',
  primary: 'bg-primary-100 text-primary-700',
  neutral: 'bg-neutral-200 text-neutral-600',
  brand: 'bg-linear-to-br from-primary-500 to-primary-600 text-white',
};

export function Avatar({
  src,
  name,
  email,
  seed,
  size = 'md',
  tone,
  color,
  ring = false,
  children,
  className,
}: AvatarProps) {
  const classes = clsx(
    'shrink-0 rounded-full',
    SIZES[size],
    ring && 'border-2 border-white',
    className
  );
  if (src) return <img src={src} alt="" aria-hidden className={clsx(classes, 'object-cover')} />;
  const resolvedTone = tone ?? (seed ? 'seeded' : 'primary');
  const background = color ?? (resolvedTone === 'seeded' && seed ? avatarColor(seed) : undefined);
  return (
    <span
      aria-hidden
      className={clsx(
        classes,
        'grid place-items-center [&>svg]:h-3.5 [&>svg]:w-3.5',
        color ? 'text-white' : TONES[resolvedTone]
      )}
      style={background ? { backgroundColor: background } : undefined}
    >
      {children ?? initials(name, email)}
    </span>
  );
}

export interface AvatarStackUser {
  id: string;
  name?: string | null;
  email?: string | null;
  avatarUrl?: string | null;
}

export interface AvatarStackProps {
  users: readonly AvatarStackUser[];
  max?: number;
  size?: AvatarSize;
  className?: string;
}

/** Overlapping avatars with a "+N" overflow; announces the names to screen readers. */
export function AvatarStack({ users, max = 3, size = 'xs', className }: AvatarStackProps) {
  if (users.length === 0) return null;
  const names = users.map((u) => u.name || u.email).join(', ');
  return (
    <span className={clsx('flex shrink-0 items-center -space-x-1.5', className)} title={names}>
      <span className="sr-only">Assigned to {names}</span>
      {users.slice(0, max).map((user) => (
        <Avatar
          key={user.id}
          src={user.avatarUrl}
          name={user.name}
          email={user.email}
          seed={user.id}
          size={size}
          ring
        />
      ))}
      {users.length > max && (
        <Avatar size={size} tone="neutral" ring className="text-neutral-700!">
          +{users.length - max}
        </Avatar>
      )}
    </span>
  );
}
