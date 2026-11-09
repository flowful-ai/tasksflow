/**
 * The app's single QueryClient.
 *
 * - Mutations: any failure shows an error toast, unless the mutation opts out
 *   with `meta: { silentError: true }` (when it renders the error inline) or
 *   overrides the text with `meta: { errorMessage: 'Could not save label' }`.
 * - Queries: retried only when the error is retryable (network/5xx), never on
 *   a 4xx. Their errors are rendered by the page (ErrorState), not toasted.
 * - `queryClient.clear()` runs on logout and on any 401 (stores/auth.ts).
 */
import { MutationCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from '../api/http';
import { toast } from '../components/ui/Toast';

declare module '@tanstack/react-query' {
  interface Register {
    defaultError: Error;
    mutationMeta: {
      /** Don't toast on error (the component shows it inline). */
      silentError?: boolean;
      /** Toast text prefix instead of the bare server message. */
      errorMessage?: string;
    };
  }
}

export function mutationErrorText(error: Error, prefix?: string): string {
  if (error instanceof ApiError && error.status === 0)
    return 'Network error: the change was not saved.';
  return prefix ? `${prefix}: ${error.message}` : error.message;
}

export function shouldRetryQuery(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError) return error.isRetryable && failureCount < 2;
  return failureCount < 1;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onError: (error, _variables, _context, mutation) => {
        if (mutation.meta?.silentError) return;
        // 401s are handled globally (session cleared, redirect to login).
        if (error instanceof ApiError && error.status === 401) return;
        toast.error(mutationErrorText(error, mutation.meta?.errorMessage));
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        retry: shouldRetryQuery,
        refetchOnWindowFocus: true,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export const queryClient = createQueryClient();
