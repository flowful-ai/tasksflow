/**
 * Integration test harness: a real Postgres database, the real Hono routers
 * and real Better Auth sessions.
 *
 * Enabled only when TEST_DATABASE_URL is set. The database is migrated with
 * apps/api/drizzle (the production migrations) once per process and
 * truncated + re-seeded by every `setupHarness()` call. DO NOT point
 * TEST_DATABASE_URL at a database whose data you care about.
 *
 * Sessions are rows in `sessions`; requests carry the signed
 * `better-auth.session_token` cookie (value `<token>.<HMAC-SHA256(secret, token) as base64>`,
 * URI-encoded, as produced by better-call's signCookieValue), so Better Auth's own
 * getSession() validates them exactly as in production.
 */
import type { Hono } from 'hono';
import { join } from 'path';
import { sql } from 'drizzle-orm';
import type { Database } from '../db/index.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;
export const integrationEnabled = Boolean(TEST_DATABASE_URL);

const AUTH_SECRET = 'integration-test-secret-0123456789abcdef';
const COOKIE_NAME = 'better-auth.session_token';

type SeedUserKey = 'ownerA' | 'adminA' | 'memberA' | 'insiderA' | 'ownerB' | 'memberB';

export interface Seed {
  users: Record<SeedUserKey, { id: string; email: string; sessionId: string; cookie: string }>;
  workspaceA: { id: string; slug: string };
  workspaceB: { id: string; slug: string };
  /** Workspace A projects: open to all members, members-only (insiderA), admin-only. */
  projectA: SeedProject;
  restrictedA: SeedProject;
  adminOnlyA: SeedProject;
  projectB: SeedProject;
  taskA: string;
  restrictedTaskA: string;
  adminOnlyTaskA: string;
  taskB: string;
  commentA: string;
  restrictedCommentA: string;
  teamViewA: string;
  personalViewA: string;
  viewB: string;
  publicShareA: { id: string; token: string };
}

export interface SeedProject {
  id: string;
  stateId: string;
  otherStateId: string;
  labelId: string;
}

export interface ApiResponse {
  status: number;
  body: ApiBody;
  text: string;
}

export interface ApiBody {
  success?: boolean;
  data?: unknown;
  error?: { code?: string; message?: string };
}

export interface Harness {
  app: Hono;
  db: Database;
  seed: Seed;
  request(user: SeedUserKey | null, method: string, path: string, body?: object, headers?: Record<string, string>): Promise<ApiResponse>;
  raw(user: SeedUserKey | null, method: string, path: string, headers?: Record<string, string>): Promise<Response>;
}

let schemaPushed = false;
let appPromise: Promise<Hono> | null = null;

function configureEnv(): void {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.BETTER_AUTH_SECRET = AUTH_SECRET;
  process.env.BETTER_AUTH_URL = 'http://localhost:3001';
  process.env.TRUSTED_PROXY_HOPS = '1';
}

/** Apply the real migrations (same SQL as production, incl. data steps and collations). */
async function migrateSchema(): Promise<void> {
  if (schemaPushed) return;
  const { runMigrations } = await import('../db/index.js');
  await runMigrations(join(import.meta.dir, '..', '..', 'drizzle'), TEST_DATABASE_URL);
  schemaPushed = true;
}

/** The production app (src/app.ts), so tests exercise the real mounting and middleware. */
async function buildApp(): Promise<Hono> {
  const { createApp } = await import('../app.js');
  const { getDatabase } = await import('../db/index.js');
  const { registerDomainEventBridges } = await import('../background/domain-bridges.js');
  // As in index.ts: realtime (and Slack/GitHub side effects) follow domain events.
  registerDomainEventBridges(getDatabase());
  return createApp().app;
}

async function truncateAll(db: Database): Promise<void> {
  const rows = await db.execute<{ tablename: string }>(
    sql`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename NOT LIKE '__drizzle%'`
  );
  const names = Array.from(rows, (row) => `"${row.tablename.replace(/"/g, '""')}"`);
  if (names.length > 0) {
    await db.execute(sql.raw(`TRUNCATE TABLE ${names.join(', ')} RESTART IDENTITY CASCADE`));
  }
}

async function signCookie(token: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(token)));
  const base64 = btoa(String.fromCharCode(...signature));
  return `${COOKIE_NAME}=${encodeURIComponent(`${token}.${base64}`)}`;
}

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`seed: missing ${what}`);
  return value;
}

async function seedFixtures(db: Database): Promise<Seed> {
  const schema = await import('../db/index.js');
  const domain = await import('../domain/index.js');
  const suffix = crypto.randomUUID().slice(0, 8);

  async function makeUser(key: SeedUserKey): Promise<Seed['users'][SeedUserKey]> {
    const email = `${key.toLowerCase()}-${suffix}@example.test`;
    const [user] = await db.insert(schema.users).values({ email, name: key, emailVerified: true }).returning();
    const token = `${key}-${crypto.randomUUID()}`;
    const [session] = await db
      .insert(schema.sessions)
      .values({ userId: must(user, key).id, token, expiresAt: new Date(Date.now() + 86_400_000) })
      .returning();
    return { id: must(user, key).id, email, sessionId: must(session, 'session').id, cookie: await signCookie(token) };
  }

  const users: Seed['users'] = {
    ownerA: await makeUser('ownerA'),
    adminA: await makeUser('adminA'),
    memberA: await makeUser('memberA'),
    insiderA: await makeUser('insiderA'),
    ownerB: await makeUser('ownerB'),
    memberB: await makeUser('memberB'),
  };

  const [wsA] = await db.insert(schema.workspaces).values({ name: 'Workspace A', slug: `ws-a-${suffix}` }).returning();
  const [wsB] = await db.insert(schema.workspaces).values({ name: 'Workspace B', slug: `ws-b-${suffix}` }).returning();
  const workspaceA = must(wsA, 'workspace A');
  const workspaceB = must(wsB, 'workspace B');

  await db.insert(schema.workspaceMembers).values([
    { workspaceId: workspaceA.id, userId: users.ownerA.id, role: 'owner' },
    { workspaceId: workspaceA.id, userId: users.adminA.id, role: 'admin' },
    { workspaceId: workspaceA.id, userId: users.memberA.id, role: 'member' },
    { workspaceId: workspaceA.id, userId: users.insiderA.id, role: 'member' },
    { workspaceId: workspaceB.id, userId: users.ownerB.id, role: 'owner' },
    { workspaceId: workspaceB.id, userId: users.memberB.id, role: 'member' },
  ]);

  const projectService = new domain.ProjectService(db);
  const taskService = new domain.TaskService(db);
  const commentService = new domain.CommentService(db);
  const smartViewService = new domain.SmartViewService(db);

  async function project(workspaceId: string, identifier: string, createdBy: string): Promise<SeedProject> {
    const created = await projectService.create({ workspaceId, name: identifier, identifier, createdBy });
    if (!created.ok) throw created.error;
    const [first, second] = created.value.taskStates;
    const [label] = await db.insert(schema.labels).values({ projectId: created.value.id, name: `${identifier}-bug` }).returning();
    return {
      id: created.value.id,
      stateId: must(first, 'state').id,
      otherStateId: must(second, 'state').id,
      labelId: must(label, 'label').id,
    };
  }

  const projectA = await project(workspaceA.id, 'OPEN', users.ownerA.id);
  const restrictedA = await project(workspaceA.id, 'SECRET', users.ownerA.id);
  const adminOnlyA = await project(workspaceA.id, 'ADMIN', users.ownerA.id);
  const projectB = await project(workspaceB.id, 'BETA', users.ownerB.id);

  const restrictedAccess = await projectService.setAccess(restrictedA.id, 'members', [users.insiderA.id]);
  if (!restrictedAccess.ok) throw restrictedAccess.error;
  const adminAccess = await projectService.setAccess(adminOnlyA.id, 'admin');
  if (!adminAccess.ok) throw adminAccess.error;

  async function task(projectId: string, title: string, createdBy: string, assigneeIds: string[] = []): Promise<string> {
    const created = await taskService.create({ projectId, title, createdBy, assigneeIds, dueDate: new Date('2030-01-01') });
    if (!created.ok) throw created.error;
    return created.value.id;
  }

  const taskA = await task(projectA.id, 'Open task A', users.ownerA.id, [users.memberA.id]);
  const restrictedTaskA = await task(restrictedA.id, 'Secret task A', users.ownerA.id, [users.insiderA.id]);
  const adminOnlyTaskA = await task(adminOnlyA.id, 'Admin-only task A', users.ownerA.id);
  const taskB = await task(projectB.id, 'Task B', users.ownerB.id);

  async function comment(taskId: string, userId: string, content: string): Promise<string> {
    const created = await commentService.create({ taskId, userId, content });
    if (!created.ok) throw created.error;
    return created.value.id;
  }

  const commentA = await comment(taskA, users.memberA.id, 'Hello from A');
  const restrictedCommentA = await comment(restrictedTaskA, users.insiderA.id, 'Secret comment');

  async function view(workspaceId: string, name: string, createdBy: string, isPersonal: boolean): Promise<string> {
    const created = await smartViewService.create({ workspaceId, name, createdBy, isPersonal });
    if (!created.ok) throw created.error;
    return created.value.id;
  }

  const teamViewA = await view(workspaceA.id, 'Team view A', users.adminA.id, false);
  const personalViewA = await view(workspaceA.id, 'Personal view A', users.adminA.id, true);
  const viewB = await view(workspaceB.id, 'View B', users.ownerB.id, false);

  const share = await smartViewService.createPublicShare({
    smartViewId: teamViewA,
    createdBy: users.adminA.id,
    hideFields: ['due_date'],
  });
  if (!share.ok) throw share.error;

  return {
    users,
    workspaceA: { id: workspaceA.id, slug: workspaceA.slug },
    workspaceB: { id: workspaceB.id, slug: workspaceB.slug },
    projectA,
    restrictedA,
    adminOnlyA,
    projectB,
    taskA,
    restrictedTaskA,
    adminOnlyTaskA,
    taskB,
    commentA,
    restrictedCommentA,
    teamViewA,
    personalViewA,
    viewB,
    publicShareA: { id: share.value.id, token: share.value.token },
  };
}

function isApiBody(value: unknown): value is ApiBody {
  return typeof value === 'object' && value !== null;
}

export async function setupHarness(): Promise<Harness> {
  configureEnv();
  await migrateSchema();

  const database = await import('../db/index.js');
  const db = database.getDatabase();
  appPromise ??= buildApp();
  const app = await appPromise;

  await truncateAll(db);
  const seed = await seedFixtures(db);

  async function raw(user: SeedUserKey | null, method: string, path: string, headers: Record<string, string> = {}) {
    const cookie: Record<string, string> = user ? { cookie: seed.users[user].cookie } : {};
    return app.request(path, { method, headers: { ...cookie, ...headers } });
  }

  async function request(
    user: SeedUserKey | null,
    method: string,
    path: string,
    body?: object,
    headers: Record<string, string> = {}
  ): Promise<ApiResponse> {
    const cookie: Record<string, string> = user ? { cookie: seed.users[user].cookie } : {};
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', ...cookie, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let parsed: unknown = {};
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = {};
    }
    return { status: res.status, body: isApiBody(parsed) ? parsed : {}, text };
  }

  return { app, db, seed, request, raw };
}
