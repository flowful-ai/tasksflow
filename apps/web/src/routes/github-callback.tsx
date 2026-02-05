import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';

/**
 * GitHub App installation callback handler.
 * GitHub redirects here after a user installs the app.
 * We retrieve the stored return URL and redirect there with the installation_id.
 */
export function GitHubCallbackPage() {
  const navigate = useNavigate();
  const hasProcessed = useRef(false);

  useEffect(() => {
    // Prevent double processing (React Strict Mode runs effects twice)
    if (hasProcessed.current) {
      return;
    }
    hasProcessed.current = true;

    const params = new URLSearchParams(window.location.search);
    const installationId = params.get('installation_id');
    const setupAction = params.get('setup_action');
    const stateParam = params.get('state');

    // Get the stored return URL from localStorage, or fall back to state parameter
    let returnUrl = localStorage.getItem('github_install_return_url');

    // If no localStorage entry, try the state parameter (used when OAuth during installation is enabled)
    if (!returnUrl && stateParam) {
      returnUrl = stateParam;
    }

    // Only remove localStorage after we've captured the value
    localStorage.removeItem('github_install_return_url');

    if (installationId && setupAction === 'install' && returnUrl) {
      // Redirect to the project settings page with installation_id
      const separator = returnUrl.includes('?') ? '&' : '?';
      navigate(`${returnUrl}${separator}installation_id=${installationId}&setup_action=${setupAction}`, { replace: true });
    } else if (returnUrl) {
      // No installation_id, just go back to the return URL
      navigate(returnUrl, { replace: true });
    } else {
      // Fallback to home
      navigate('/', { replace: true });
    }
  }, [navigate]);

  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600 mx-auto mb-4" />
        <p className="text-gray-600">Completing GitHub setup...</p>
      </div>
    </div>
  );
}
