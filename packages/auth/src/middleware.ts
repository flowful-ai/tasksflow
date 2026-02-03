import type { Context, Next } from 'hono';
import { getAuth } from './config.js';

export interface AuthUser {
  id: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

export interface AuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
}

export interface AuthContext {
  user: AuthUser | null;
  session: AuthSession | null;
}

/**
 * Middleware to extract and validate the session from the request.
 * Sets ctx.set('auth', { user, session }) for use in route handlers.
 */
export async function authMiddleware(ctx: Context, next: Next) {
  const auth = getAuth();

  try {
    // Get session from cookie or Authorization header
    const session = await auth.api.getSession({
      headers: ctx.req.raw.headers,
    });

    if (session?.user && session?.session) {
      ctx.set('auth', {
        user: {
          id: session.user.id,
          email: session.user.email,
          name: session.user.name || null,
          avatarUrl: (session.user as Record<string, unknown>).avatarUrl as string | null,
        },
        session: {
          id: session.session.id,
          userId: session.session.userId,
          expiresAt: session.session.expiresAt,
        },
      } satisfies AuthContext);
    } else {
      ctx.set('auth', { user: null, session: null } satisfies AuthContext);
    }
  } catch {
    ctx.set('auth', { user: null, session: null } satisfies AuthContext);
  }

  await next();
}

/**
 * Middleware that requires authentication.
 * Returns 401 if no valid session is found.
 */
export async function requireAuth(ctx: Context, next: Next) {
  await authMiddleware(ctx, next);

  const auth = ctx.get('auth') as AuthContext;
  if (!auth.user || !auth.session) {
    return ctx.json({ error: { code: 'UNAUTHORIZED', message: 'Authentication required' } }, 401);
  }

  await next();
}

/**
 * Helper to get the current user from context.
 * Throws if not authenticated.
 */
export function getCurrentUser(ctx: Context): AuthUser {
  const auth = ctx.get('auth') as AuthContext;
  if (!auth?.user) {
    throw new Error('User not authenticated');
  }
  return auth.user;
}

/**
 * Helper to get the current session from context.
 * Throws if not authenticated.
 */
export function getCurrentSession(ctx: Context): AuthSession {
  const auth = ctx.get('auth') as AuthContext;
  if (!auth?.session) {
    throw new Error('Session not found');
  }
  return auth.session;
}

/**
 * Helper to optionally get the current user from context.
 * Returns null if not authenticated.
 */
export function getOptionalUser(ctx: Context): AuthUser | null {
  const auth = ctx.get('auth') as AuthContext | undefined;
  return auth?.user || null;
}
