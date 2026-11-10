import clsx from 'clsx';
import type { ReactNode } from 'react';
import { AlertTriangle, SearchX, WifiOff } from 'lucide-react';
import { Button } from './Button';
import { ApiError } from '../../api/http';

export type ErrorKind = 'network' | 'server' | 'not-found' | 'forbidden' | 'unknown';

/** Classify an error for display: a 404 is not a network failure. */
export function classifyError(error: Error | null | undefined): ErrorKind {
  if (!(error instanceof ApiError)) return 'unknown';
  if (error.status === 0) return 'network';
  if (error.status === 404) return 'not-found';
  if (error.status === 403) return 'forbidden';
  if (error.status >= 500) return 'server';
  return 'unknown';
}

export interface ErrorStateProps {
  error: Error | null | undefined;
  /** What failed to load, e.g. "project": used in the title. */
  resource?: string;
  /** Shown for retryable errors (network/5xx/unknown). */
  onRetry?: () => void;
  /** Action for a 404/403, e.g. a link back to the projects list. */
  notFoundAction?: ReactNode;
  className?: string;
}

const COPY: Record<ErrorKind, { title: (r: string) => string; body: string }> = {
  network: {
    title: (r) => `Couldn't load this ${r}`,
    body: 'Network error: check your connection, then retry.',
  },
  server: {
    title: (r) => `Couldn't load this ${r}`,
    body: 'The server had a problem. Retrying usually helps.',
  },
  'not-found': {
    title: (r) => `This ${r} doesn't exist`,
    body: 'It may have been deleted, or the link is wrong.',
  },
  forbidden: {
    title: (r) => `You don't have access to this ${r}`,
    body: 'Ask a workspace admin for access.',
  },
  unknown: { title: (r) => `Couldn't load this ${r}`, body: 'Something went wrong.' },
};

/**
 * Failed load (mockup section 6). Network and 5xx errors get a Retry button;
 * a 404/403 explains itself instead of pretending a retry would help.
 */
export function ErrorState({
  error,
  resource = 'page',
  onRetry,
  notFoundAction,
  className,
}: ErrorStateProps) {
  const kind = classifyError(error);
  const copy = COPY[kind];
  const retryable = kind === 'network' || kind === 'server' || kind === 'unknown';
  const Icon = kind === 'network' ? WifiOff : kind === 'not-found' ? SearchX : AlertTriangle;
  const detail = kind === 'unknown' && error?.message ? error.message : copy.body;

  return (
    <div
      role="alert"
      className={clsx(
        'flex flex-col items-center justify-center gap-2 py-14 text-center',
        className
      )}
    >
      <div
        aria-hidden
        className="mb-1 grid h-14 w-14 place-items-center rounded-[14px] border border-neutral-200 bg-neutral-50 text-neutral-500"
      >
        <Icon className="h-6 w-6" />
      </div>
      <p className="font-semibold text-neutral-900">{copy.title(resource)}</p>
      <p className="max-w-sm text-sm text-neutral-500">{detail}</p>
      <div className="mt-2">
        {retryable && onRetry ? (
          <Button variant="danger" onClick={onRetry}>
            Retry
          </Button>
        ) : (
          !retryable && notFoundAction
        )}
      </div>
    </div>
  );
}
