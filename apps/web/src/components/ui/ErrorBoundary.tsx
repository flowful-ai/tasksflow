/**
 * Render-error boundaries.
 *
 * - <ErrorBoundary> wraps the whole app (main.tsx): a full-page fallback.
 * - <RouteErrorBoundary> wraps each route's element (App.tsx): the sidebar
 *   stays usable and the boundary resets when the location changes.
 *
 * Both offer "Try again" (re-render) and "Reload page".
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** 'page' fills the viewport; 'section' fits its container. */
  variant?: 'page' | 'section';
  /** Changing this value resets the boundary (e.g. the route path). */
  resetKey?: string;
  fallback?: (props: { error: Error; reset: () => void }) => ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null });
    }
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (this.props.fallback) return this.props.fallback({ error, reset: this.reset });
    return <ErrorFallback error={error} onReset={this.reset} variant={this.props.variant ?? 'page'} />;
  }
}

export function ErrorFallback({
  error,
  onReset,
  variant = 'page',
}: {
  error: Error;
  onReset?: () => void;
  variant?: 'page' | 'section';
}) {
  /** Stale chunks after a deploy: a reload fetches the new build. */
  const isChunkError = /dynamically imported module|Loading chunk|Importing a module script failed/i.test(error.message);
  return (
    <div
      role="alert"
      className={
        variant === 'page'
          ? 'flex min-h-screen flex-col items-center justify-center gap-3 bg-white p-6 text-center'
          : 'flex flex-col items-center justify-center gap-3 py-20 text-center'
      }
    >
      <div aria-hidden className="grid h-14 w-14 place-items-center rounded-[14px] border border-neutral-200 bg-neutral-50">
        <AlertTriangle className="h-6 w-6 text-primary-600" />
      </div>
      <h1 className="text-lg font-semibold text-neutral-900">
        {isChunkError ? 'A new version is available' : 'Something went wrong'}
      </h1>
      <p className="max-w-md text-sm text-neutral-500">
        {isChunkError
          ? 'Reload the page to get the latest version.'
          : 'This part of the page crashed. Your data is safe; try again or reload the page.'}
      </p>
      {import.meta.env.DEV && !isChunkError && (
        <pre className="max-w-xl overflow-auto rounded-lg bg-neutral-50 p-3 text-left text-xs text-neutral-600">{error.message}</pre>
      )}
      <div className="mt-1 flex gap-2">
        {onReset && !isChunkError && (
          <button type="button" className="btn btn-secondary" onClick={onReset}>
            Try again
          </button>
        )}
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
    </div>
  );
}

/** Per-route boundary: resets on navigation so one broken page doesn't stick. */
export function RouteErrorBoundary({ children }: { children: ReactNode }) {
  const location = useLocation();
  return (
    <ErrorBoundary variant="section" resetKey={location.pathname}>
      {children}
    </ErrorBoundary>
  );
}
