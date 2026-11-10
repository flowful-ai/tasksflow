/**
 * Entry of a vertical in-page navigation (settings and project settings tabs).
 *
 *   <NavItem asChild active={isActive} icon={<User />}><Link to="/settings/user/profile">Profile</Link></NavItem>
 *   <NavItem active={section === 'danger'} tone="danger" icon={<AlertTriangle />} onClick={…}>Danger Zone</NavItem>
 *
 * Sets aria-current="page" when active.
 */
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Slot, Slottable } from '@radix-ui/react-slot';
import clsx from 'clsx';

export interface NavItemProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean;
  icon?: ReactNode;
  tone?: 'default' | 'danger';
  /** Render the child element (a router Link) instead of a <button>. */
  asChild?: boolean;
}

export const NavItem = forwardRef<HTMLButtonElement, NavItemProps>(function NavItem(
  { active = false, icon, tone = 'default', asChild = false, className, children, ...props },
  ref
) {
  const Comp = asChild ? Slot : 'button';
  const danger = tone === 'danger';
  return (
    <Comp
      ref={ref}
      {...(asChild ? {} : { type: 'button' as const })}
      aria-current={active ? 'page' : undefined}
      className={clsx(
        'flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors',
        active
          ? danger
            ? 'bg-red-50 text-red-600'
            : 'bg-primary-50 text-primary-700'
          : danger
            ? 'text-neutral-700 hover:bg-red-50 hover:text-red-600'
            : 'text-neutral-700 hover:bg-neutral-100',
        className
      )}
      {...props}
    >
      {icon && (
        <span
          aria-hidden
          className={clsx(
            'mr-3 inline-flex shrink-0 [&>svg]:h-5 [&>svg]:w-5',
            danger && !active && 'text-neutral-400'
          )}
        >
          {icon}
        </span>
      )}
      <Slottable>{children}</Slottable>
    </Comp>
  );
});
