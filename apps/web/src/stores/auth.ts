/**
 * Session state. Read with selectors: `useAuthStore((s) => s.user)`.
 *
 * Logout and any 401 response clear the whole TanStack Query cache, so the
 * next user in the tab never sees the previous user's data.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@flowtask/shared';
import { api, ApiError, setUnauthorizedHandler } from '../api/http';
import { queryClient } from '../lib/queryClient';
import { useWorkspaceStore } from './workspace';

// Map Better Auth error codes to user-friendly messages
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: 'Invalid email or password',
  INVALID_EMAIL: 'Please enter a valid email address',
  INVALID_PASSWORD: 'Password must be at least 8 characters',
  PASSWORD_TOO_SHORT: 'Password must be at least 8 characters',
  PASSWORD_TOO_LONG: 'Password must be less than 128 characters',
  EMAIL_NOT_VERIFIED: 'Please verify your email before signing in',
  USER_NOT_FOUND: 'No account found with this email',
  INVALID_TOKEN: 'Invalid or expired token',
  SESSION_EXPIRED: 'Your session has expired, please sign in again',
};

function getAuthErrorMessage(error: Error): string {
  if (error instanceof ApiError) return AUTH_ERROR_MESSAGES[error.code] || error.message;
  return error.message || 'An unexpected error occurred';
}

/** Session user as serialised by Better Auth (dates are strings over the wire). */
export type SessionUser = Omit<User, 'createdAt' | 'updatedAt'> & {
  createdAt?: string;
  updatedAt?: string;
  /** Provider avatar: Better Auth's name for users.avatar_url (read it with avatarUrlOf). */
  image?: string | null;
};

interface AuthState {
  user: SessionUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  hasCheckedAuth: boolean;
  error: string | null;

  /** Email/password sign-in (accounts created before v2; sign-up is social only). */
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

/** Drop every trace of the previous session from memory and storage. */
function clearClientState(): void {
  queryClient.clear();
  useWorkspaceStore.getState().reset();
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      hasCheckedAuth: false,
      error: null,

      login: async (email, password) => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.post<{ user?: SessionUser }>('/api/auth/sign-in/email', {
            email,
            password,
          });
          if (!response.user) throw new Error('Login failed');
          // A different user may have used this tab before.
          clearClientState();
          set({ user: response.user, isAuthenticated: true, isLoading: false });
        } catch (error) {
          const err = error instanceof Error ? error : new Error('Login failed');
          set({ error: getAuthErrorMessage(err), isLoading: false });
          throw err;
        }
      },

      logout: async () => {
        set({ isLoading: true });
        try {
          await api.post('/api/auth/sign-out');
        } finally {
          clearClientState();
          set({ user: null, isAuthenticated: false, isLoading: false });
        }
      },

      checkAuth: async () => {
        try {
          const response = await api.get<{ user?: SessionUser } | null>('/api/auth/get-session');
          if (response?.user) {
            set({ user: response.user, isAuthenticated: true });
          } else {
            set({ user: null, isAuthenticated: false });
          }
        } catch (error) {
          // Only clear auth on an explicit rejection; keep state on network errors.
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            set({ user: null, isAuthenticated: false });
          }
        } finally {
          set({ hasCheckedAuth: true });
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'flowtask-auth',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);

// Any 401 from the API means the session is gone: clear everything; the
// ProtectedRoute then redirects to /login.
setUnauthorizedHandler(() => {
  if (!useAuthStore.getState().isAuthenticated) return;
  clearClientState();
  useAuthStore.setState({ user: null, isAuthenticated: false });
});

// Validate session on app load
void useAuthStore.getState().checkAuth();
