import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { User } from '@flowtask/shared';
import { api, ApiError } from '../api/client';

// Map Better Auth error codes to user-friendly messages
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  USER_ALREADY_EXISTS: 'An account with this email already exists',
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

function getAuthErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    return AUTH_ERROR_MESSAGES[error.code] || error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return 'An unexpected error occurred';
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;

  // Actions
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  clearError: () => void;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      error: null,

      login: async (email: string, password: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.post<{ user?: User }>('/api/auth/sign-in/email', {
            email,
            password,
          });

          if (response.user) {
            set({
              user: response.user,
              isAuthenticated: true,
              isLoading: false,
            });
          } else {
            throw new Error('Login failed');
          }
        } catch (error) {
          const message = getAuthErrorMessage(error);
          set({
            error: message,
            isLoading: false,
          });
          throw error;
        }
      },

      register: async (email: string, password: string, name?: string) => {
        set({ isLoading: true, error: null });
        try {
          const response = await api.post<{ user?: User }>('/api/auth/sign-up/email', {
            email,
            password,
            name,
          });

          if (response.user) {
            set({
              user: response.user,
              isAuthenticated: true,
              isLoading: false,
            });
          } else {
            throw new Error('Registration failed');
          }
        } catch (error) {
          const message = getAuthErrorMessage(error);
          set({
            error: message,
            isLoading: false,
          });
          throw error;
        }
      },

      logout: async () => {
        set({ isLoading: true });
        try {
          await api.post('/api/auth/sign-out');
        } finally {
          set({
            user: null,
            isAuthenticated: false,
            isLoading: false,
          });
        }
      },

      checkAuth: async () => {
        try {
          const response = await api.get<{ user?: User; session?: unknown } | null>('/api/auth/get-session');
          if (response?.user) {
            set({
              user: response.user,
              isAuthenticated: true,
            });
          } else {
            // No valid session
            set({
              user: null,
              isAuthenticated: false,
            });
          }
        } catch (error) {
          // Only clear auth on explicit rejection
          if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
            set({
              user: null,
              isAuthenticated: false,
            });
          }
          // On network errors, keep existing state
        }
      },

      clearError: () => set({ error: null }),
    }),
    {
      name: 'flowtask-auth',
      partialize: (state) => ({
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
);

// Validate session on app load
useAuthStore.getState().checkAuth();
