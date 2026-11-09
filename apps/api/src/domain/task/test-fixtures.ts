/**
 * Integration-test fixtures (used only by *.integration.test.ts files that run
 * when TEST_DATABASE_URL is set). Every fixture uses random names so suites
 * can share one database and run concurrently.
 */
import { randomUUID } from 'node:crypto';
import {
  createDatabase,
  labels,
  projectMembers,
  projects,
  taskStates,
  users,
  workspaceMembers,
  workspaces,
  type Database,
} from '../../db/index.js';

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

let shared: Database | null = null;
export function testDb(): Database {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is not set');
  shared ??= createDatabase(TEST_DATABASE_URL);
  return shared;
}

function suffix(): string {
  return randomUUID().slice(0, 8);
}

export async function createUser(db: Database, name = `User ${suffix()}`) {
  const [user] = await db
    .insert(users)
    .values({ email: `${suffix()}-${Date.now()}@test.flowtask.dev`, name })
    .returning();
  return user!;
}

export interface WorkspaceFixture {
  workspaceId: string;
  owner: Awaited<ReturnType<typeof createUser>>;
  member: Awaited<ReturnType<typeof createUser>>;
  outsider: Awaited<ReturnType<typeof createUser>>;
}

export async function createWorkspace(db: Database): Promise<WorkspaceFixture> {
  const [workspace] = await db
    .insert(workspaces)
    .values({ name: `WS ${suffix()}`, slug: `ws-${suffix()}-${Date.now()}` })
    .returning();
  const owner = await createUser(db, 'Owner');
  const member = await createUser(db, 'Member');
  const outsider = await createUser(db, 'Outsider');
  await db.insert(workspaceMembers).values([
    { workspaceId: workspace!.id, userId: owner.id, role: 'owner' },
    { workspaceId: workspace!.id, userId: member.id, role: 'member' },
  ]);
  return { workspaceId: workspace!.id, owner, member, outsider };
}

export interface ProjectFixture {
  projectId: string;
  identifier: string;
  states: { backlog: string; progress: string; done: string };
  labelId: string;
}

export async function createProject(
  db: Database,
  workspaceId: string,
  opts: { access?: 'all' | 'admin' | 'members'; memberIds?: string[] } = {}
): Promise<ProjectFixture> {
  const identifier = `T${suffix()
    .replace(/[^0-9a-f]/g, '')
    .slice(0, 5)
    .toUpperCase()}`;
  const [project] = await db
    .insert(projects)
    .values({
      workspaceId,
      name: `Project ${identifier}`,
      identifier,
      access: opts.access ?? 'all',
    })
    .returning();
  const [backlog, progress, done] = await db
    .insert(taskStates)
    .values([
      { projectId: project!.id, name: 'Todo', category: 'backlog', position: 'a0' },
      { projectId: project!.id, name: 'In progress', category: 'in_progress', position: 'a1' },
      { projectId: project!.id, name: 'Done', category: 'done', position: 'a2' },
    ])
    .returning();
  const [label] = await db
    .insert(labels)
    .values({ projectId: project!.id, name: 'bug', color: '#f00' })
    .returning();
  if (opts.memberIds?.length) {
    await db
      .insert(projectMembers)
      .values(opts.memberIds.map((userId) => ({ projectId: project!.id, userId })));
  }
  return {
    projectId: project!.id,
    identifier,
    states: { backlog: backlog!.id, progress: progress!.id, done: done!.id },
    labelId: label!.id,
  };
}

/** Unwrap a Result in tests. */
export function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: Error }): T {
  if (!result.ok) throw result.error;
  return result.value;
}
