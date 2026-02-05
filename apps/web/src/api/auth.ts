import { createAuthClient } from 'better-auth/react';
import { api } from './client';

// Create Better Auth client
const API_BASE_URL = import.meta.env.VITE_API_URL || '';

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

export const authApi = {
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
    console.log('[authApi.linkSocial] Starting with input:', input);
    try {
      // Use fetchOptions to disable auto-redirect and get the URL manually
      const result = await authClient.linkSocial(
        {
          provider: input.provider,
          callbackURL: input.callbackURL,
          scopes: input.scopes,
        },
        {
          onSuccess: (ctx) => {
            console.log('[authApi.linkSocial] onSuccess ctx:', ctx);
          },
          onError: (ctx) => {
            console.error('[authApi.linkSocial] onError ctx:', ctx);
          },
        }
      );
      console.log('[authApi.linkSocial] Result:', result);
      if (result.error) {
        console.error('[authApi.linkSocial] Error:', result.error);
        throw new Error(result.error.message || 'Failed to link social account');
      }
      return {
        url: result.data?.url || '',
        redirect: result.data?.redirect || false,
      };
    } catch (err) {
      console.error('[authApi.linkSocial] Exception:', err);
      throw err;
    }
  },

  unlinkAccount: async (input: UnlinkAccountInput): Promise<{ status: boolean }> => {
    const result = await authClient.unlinkAccount({
      providerId: input.providerId,
      accountId: input.accountId,
    });
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
