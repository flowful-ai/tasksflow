/**
 * Page title block.
 *
 *   <PageHeader title="Views" description="Saved filters across projects."
 *     actions={<Button leadingIcon={<Plus />}>New view</Button>} />
 *   <PageHeader back={{ to: `/project/${id}`, label: 'Back to project' }} title="Settings" />
 *   <PageHeader breadcrumbs={[{ label: 'Projects', to: '/projects' }]} title={project.name} />
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import clsx from 'clsx';

export interface Breadcrumb {
  label: ReactNode;
  to?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** Icon before the title. */
  icon?: ReactNode;
  breadcrumbs?: Breadcrumb[];
  /** A "← Back to …" link above the title. */
  back?: { to: string; label: string };
  className?: string;
}

export function PageHeader({
  title,
  description,
  actions,
  icon,
  breadcrumbs,
  back,
  className,
}: PageHeaderProps) {
  return (
    <header className={clsx('mb-6', className)}>
      {back && (
        <Link
          to={back.to}
          className="mb-2 inline-flex items-center text-sm text-neutral-600 hover:text-neutral-900"
        >
          <ArrowLeft aria-hidden className="mr-1 h-4 w-4" />
          {back.label}
        </Link>
      )}
      {breadcrumbs && breadcrumbs.length > 0 && (
        <nav aria-label="Breadcrumb" className="mb-1">
          <ol className="flex items-center gap-1 text-sm text-neutral-400">
            {breadcrumbs.map((crumb, index) => (
              <li key={index} className="flex items-center gap-1">
                {crumb.to ? (
                  <Link to={crumb.to} className="font-medium hover:text-neutral-600">
                    {crumb.label}
                  </Link>
                ) : (
                  <span className="font-medium">{crumb.label}</span>
                )}
                <span aria-hidden className="text-neutral-300">
                  /
                </span>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-2xl font-bold text-neutral-900">
            {icon && (
              <span aria-hidden className="inline-flex shrink-0 [&>svg]:h-6 [&>svg]:w-6">
                {icon}
              </span>
            )}
            {title}
          </h1>
          {description && <p className="mt-1 text-sm text-neutral-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
