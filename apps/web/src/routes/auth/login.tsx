import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { OAuthButtons } from '../../components/auth/OAuthButtons';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';
  const { login, error, clearError, isAuthenticated } = useAuthStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const socialEnabled = Boolean(
    import.meta.env.VITE_GITHUB_CLIENT_ID || import.meta.env.VITE_GOOGLE_CLIENT_ID
  );
  // Email sign-in is kept only for accounts created with a password before v2.
  const [showEmailForm, setShowEmailForm] = useState(!socialEnabled);

  const completeRedirect = (target: string, replace = false) => {
    if (/^https?:\/\//i.test(target)) {
      if (replace) {
        window.location.replace(target);
      } else {
        window.location.assign(target);
      }
      return;
    }
    navigate(target, { replace });
  };

  useEffect(() => {
    if (isAuthenticated) {
      completeRedirect(redirectTo, true);
    }
  }, [isAuthenticated, redirectTo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    try {
      await login(email, password);
      completeRedirect(redirectTo);
    } catch {
      // Error is handled by the store
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center">
            <svg
              className="w-7 h-7 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h2 className="mt-6 text-3xl font-bold text-gray-900">Welcome back</h2>
          <p className="mt-2 text-sm text-gray-600">
            Sign in or create your account with GitHub or Google
          </p>
        </div>

        <div className="mt-8">
          <OAuthButtons callbackURL={redirectTo} />

          {error && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-lg mb-4">
              {error}
              <button type="button" onClick={clearError} className="ml-2 underline">
                Dismiss
              </button>
            </div>
          )}

          {!showEmailForm ? (
            <p className="text-center text-sm text-gray-500 mt-6">
              <button
                type="button"
                onClick={() => setShowEmailForm(true)}
                className="underline hover:text-gray-700"
              >
                Sign in with email and password
              </button>{' '}
              (existing accounts only)
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 mt-6">
              <div className="space-y-4">
                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                    Email address
                  </label>
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input mt-1"
                    placeholder="you@example.com"
                  />
                </div>

                <div>
                  <label htmlFor="password" className="block text-sm font-medium text-gray-700">
                    Password
                  </label>
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="input mt-1"
                    placeholder="Enter your password"
                  />
                </div>
              </div>

              <button type="submit" disabled={isSubmitting} className="btn btn-primary w-full py-3">
                {isSubmitting ? 'Signing in...' : 'Sign in'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
