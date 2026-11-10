import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import { useAuthStore } from '../../stores/auth';
import { OAuthButtons } from '../../components/auth/OAuthButtons';
import { Button, Field, Input } from '../../components/ui';

export function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const redirectTo = searchParams.get('redirect') || '/dashboard';
  const { login, error, clearError, isAuthenticated } = useAuthStore(
    useShallow((s) => ({
      login: s.login,
      error: s.error,
      clearError: s.clearError,
      isAuthenticated: s.isAuthenticated,
    }))
  );
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
    void navigate(target, { replace });
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
    <main className="min-h-screen flex items-center justify-center bg-neutral-50 py-12 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <div className="mx-auto w-12 h-12 bg-primary-600 rounded-xl flex items-center justify-center">
            <svg
              aria-hidden
              className="w-7 h-7 text-white"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
            >
              <path d="M5 12l5 5L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <h1 className="mt-6 text-3xl font-bold text-neutral-900">Welcome back</h1>
          <p className="mt-2 text-sm text-neutral-600">
            Sign in or create your account with GitHub or Google
          </p>
        </div>

        <div className="mt-8">
          <OAuthButtons callbackURL={redirectTo} />

          {error && (
            <div role="alert" className="p-3 text-sm text-red-600 bg-red-50 rounded-lg mb-4">
              {error}
              <button type="button" onClick={clearError} className="ml-2 underline">
                Dismiss
              </button>
            </div>
          )}

          {!showEmailForm ? (
            <p className="text-center text-sm text-neutral-500 mt-6">
              <button
                type="button"
                onClick={() => setShowEmailForm(true)}
                className="underline hover:text-neutral-700"
              >
                Sign in with email and password
              </button>{' '}
              (existing accounts only)
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-6 mt-6">
              <div className="space-y-4">
                <Field label="Email address" id="email">
                  <Input
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                  />
                </Field>

                <Field label="Password" id="password">
                  <Input
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                  />
                </Field>
              </div>

              <Button type="submit" disabled={isSubmitting} block className="py-3">
                {isSubmitting ? 'Signing in...' : 'Sign in'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}
