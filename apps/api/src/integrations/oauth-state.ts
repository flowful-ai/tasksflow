import type { Database } from '../db/index.js';
import { integrationOauthStates } from '../db/index.js';
import { and, eq, gt, lt } from 'drizzle-orm';
import { randomToken } from './crypto.js';

export type OAuthStateProvider = 'github' | 'slack';

export interface OAuthStateBinding {
  provider: OAuthStateProvider;
  userId: string;
  sessionId: string;
  projectId: string;
}

/** Install flows must complete within this window. */
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

/**
 * Create a single-use random `state` nonce bound to the user session and
 * project that started an install flow.
 */
export async function createOAuthState(db: Database, binding: OAuthStateBinding): Promise<string> {
  const now = new Date();
  await db.delete(integrationOauthStates).where(lt(integrationOauthStates.expiresAt, now));
  const state = randomToken(32);
  await db.insert(integrationOauthStates).values({
    state,
    provider: binding.provider,
    userId: binding.userId,
    sessionId: binding.sessionId,
    projectId: binding.projectId,
    expiresAt: new Date(now.getTime() + OAUTH_STATE_TTL_MS),
  });
  return state;
}

/**
 * Atomically consume a state nonce. Returns its binding only when it exists,
 * hasn't expired, and matches the provider; it can't be replayed afterwards.
 */
export async function consumeOAuthState(
  db: Database,
  state: string,
  provider: OAuthStateProvider
): Promise<OAuthStateBinding | null> {
  if (!state || state.length > 200) return null;
  const [row] = await db
    .delete(integrationOauthStates)
    .where(
      and(
        eq(integrationOauthStates.state, state),
        eq(integrationOauthStates.provider, provider),
        gt(integrationOauthStates.expiresAt, new Date())
      )
    )
    .returning();
  if (!row || (row.provider !== 'github' && row.provider !== 'slack')) return null;
  return {
    provider: row.provider,
    userId: row.userId,
    sessionId: row.sessionId,
    projectId: row.projectId,
  };
}
