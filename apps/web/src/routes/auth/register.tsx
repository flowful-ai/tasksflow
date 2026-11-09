import { Navigate, useSearchParams } from 'react-router-dom';

/**
 * Email/password sign-up is disabled: accounts are created by signing in with
 * GitHub or Google. Old /register links (invites, bookmarks) land on /login.
 */
export function RegisterPage() {
  const [searchParams] = useSearchParams();
  const redirect = searchParams.get('redirect');
  const target = redirect ? `/login?redirect=${encodeURIComponent(redirect)}` : '/login';
  return <Navigate to={target} replace />;
}
