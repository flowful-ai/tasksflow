import { useEffect, useRef } from 'react';
import { PageSpinner } from '../components/ui';

/**
 * GitHub App setup URL landing page (when the app is configured to redirect
 * to the web app rather than to /api/github/callback).
 *
 * The install is only trusted with GitHub's OAuth `code` and our `state`
 * nonce, both verified server-side, so every query parameter is handed over
 * to the API callback as-is. That route verifies and stores the installation,
 * then redirects to the project's settings.
 */
export function GitHubCallbackPage() {
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Prevent double processing (React Strict Mode runs effects twice)
    if (hasProcessed.current) return;
    hasProcessed.current = true;
    window.location.replace(`/api/github/callback${window.location.search}`);
  }, []);

  return (
    <main className="flex h-screen flex-col items-center justify-center">
      <PageSpinner className="h-auto" label="Completing GitHub setup" />
      <p className="mt-4 text-neutral-600">Completing GitHub setup...</p>
    </main>
  );
}
