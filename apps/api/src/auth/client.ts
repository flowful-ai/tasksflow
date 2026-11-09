import { createAuthClient } from 'better-auth/client';

/**
 * Create a Better Auth client for use in the frontend.
 */
export function createClient(options?: { baseURL?: string }) {
  return createAuthClient({
    baseURL: options?.baseURL || 'http://localhost:3001',
  });
}

// Type for the auth client
export type AuthClient = ReturnType<typeof createClient>;

// Default client instance
let clientInstance: AuthClient | null = null;

export function getAuthClient(baseURL?: string): AuthClient {
  if (!clientInstance) {
    clientInstance = createClient({ baseURL });
  }
  return clientInstance;
}

// Re-export common types for frontend use
export type { AuthUser, AuthSession } from './middleware.js';
