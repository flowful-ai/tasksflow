import { createAuthClient } from 'better-auth/react';
import { api } from './client';
import { API_BASE_URL } from './http';

// Create Better Auth client

export const authClient = createAuthClient({
  baseURL: API_BASE_URL,
  fetchOptions: {
    credentials: 'include',
  },
});

export interface LinkedAccount {
  id: string;
  providerId: string;
  createdAt: string;
  updatedAt: string;
  accountId: string;
  userId: string;
  scopes: string[];
}

export interface LinkSocialInput {
  provider: 'github' | 'google';
  callbackURL?: string;
  scopes?: string[];
  disableRedirect?: boolean;
  requestSignUp?: boolean;
  errorCallbackURL?: string;
}

export interface LinkSocialResponse {
  url: string;
  redirect: boolean;
  status?: boolean;
}

export interface UnlinkAccountInput {
  providerId: string;
  accountId?: string;
}

export interface AccountInfoResponse {
  user: {
    id: string;
    name?: string;
    email?: string;
    image?: string;
    emailVerified: boolean;
  };
  data: Record<string, unknown>;
}

/** A Better Auth session row as returned by GET /api/auth/list-sessions. */
export interface AuthSession {
  id: string;
  token: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export const authApi = {
  /** Change the display name (Better Auth update-user; the email cannot change). */
  updateName: (name: string): Promise<{ status: boolean }> =>
    api.post('/api/auth/update-user', { name }),

  /** The caller's current session id (to tell "this device" apart in the list). */
  currentSessionId: async (): Promise<string | null> => {
    const result = await api.get<{ session?: { id: string } } | null>('/api/auth/get-session');
    return result?.session?.id ?? null;
  },

  /**
   * Active sessions, newest activity first. Better Auth answers 403
   * SESSION_NOT_FRESH when the current session is more than a day old.
   */
  listSessions: async (): Promise<AuthSession[]> => {
    const sessions = await api.get<AuthSession[]>('/api/auth/list-sessions');
    return [...sessions].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  revokeSession: (token: string): Promise<{ status: boolean }> =>
    api.post('/api/auth/revoke-session', { token }),

  revokeOtherSessions: (): Promise<{ status: boolean }> =>
    api.post('/api/auth/revoke-other-sessions', {}),

  listAccounts: async (): Promise<LinkedAccount[]> => {
    const result = await authClient.listAccounts();
    if (result.error) {
      throw new Error(result.error.message || 'Failed to list accounts');
    }
    // Map Better Auth account format to our LinkedAccount interface
    return (result.data || []).map((account) => ({
      id: account.id,
      providerId: account.providerId,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
      accountId: account.accountId,
      userId: account.userId,
      scopes: account.scopes || [],
    }));
  },

  linkSocial: async (input: LinkSocialInput): Promise<LinkSocialResponse> => {
    // Use fetchOptions to disable auto-redirect and get the URL manually
    const result = await authClient.linkSocial({
      provider: input.provider,
      callbackURL: input.callbackURL,
      scopes: input.scopes,
    });
    if (result.error) {
      throw new Error(result.error.message || 'Failed to link social account');
    }
    return {
      url: result.data?.url || '',
      redirect: result.data?.redirect || false,
    };
  },

  unlinkAccount: async (input: UnlinkAccountInput): Promise<{ status: boolean }> => {
    // Better Auth 1.7 unlinks by its own account row id, not the provider's account id.
    const accounts = await authApi.listAccounts();
    const account = accounts.find(
      (a) =>
        a.providerId === input.providerId &&
        (input.accountId === undefined || a.accountId === input.accountId)
    );
    if (!account) {
      throw new Error('Linked account not found');
    }
    const result = await authClient.unlinkAccount({ accountId: account.id });
    if (result.error) {
      throw new Error(result.error.message || 'Failed to unlink account');
    }
    return { status: result.data?.status ?? true };
  },

  getAccountInfo: (accountId?: string) => {
    const query = accountId ? `?accountId=${encodeURIComponent(accountId)}` : '';
    return api.get<AccountInfoResponse>(`/api/auth/account-info${query}`);
  },
};
