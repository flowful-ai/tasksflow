import { Hono } from 'hono';
import { getAuth } from '@flowtask/auth';

const auth = new Hono();

// Better Auth handles all auth routes
// This wraps the Better Auth handler for Hono
auth.all('/*', async (c) => {
  const betterAuth = getAuth();
  return betterAuth.handler(c.req.raw);
});

export { auth as authRoutes };
