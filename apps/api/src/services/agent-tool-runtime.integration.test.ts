/**
 * Agent tools (MCP and in-app chat) against a real database: sub-tasks, task
 * relations and labels go through the same domain services as the REST API.
 * Skipped unless TEST_DATABASE_URL is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq, or } from 'drizzle-orm';
import { AgentToolSchema, type WorkspaceRole } from '@flowtask/shared';
import { taskRelations, tasks } from '../db/index.js';
import { domainEvents } from '../domain/events/bus.js';
import { TaskService } from '../domain/task/service.js';
import {
  TEST_DATABASE_URL,
  createProject,
  createWorkspace,
  testDb,
  unwrap,
  type ProjectFixture,
  type WorkspaceFixture,
} from '../domain/task/test-fixtures.js';
import { ToolExecutionError, type ToolErrorCode } from '../lib/mcp/errors.js';
import { buildToolContext, type ToolContext } from '../lib/mcp/tool-context.js';
import { executeAgentTool } from './agent-tool-runtime.js';

async function expectToolError(
  promise: Promise<unknown>,
  code: ToolErrorCode,
  message?: RegExp
): Promise<void> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(ToolExecutionError);
  if (error instanceof ToolExecutionError) {
    expect(error.code).toBe(code);
    if (message) expect(error.message).toMatch(message);
  }
}

type OutputRecord = Record<string, unknown>;

function isOutputRecord(value: unknown): value is OutputRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads one key of a nested tool output value. */
function field(value: unknown, key: string): unknown {
  return isOutputRecord(value) ? value[key] : undefined;
}

function idsOf(list: unknown): unknown[] {
  return Array.isArray(list) ? list.map((entry) => field(entry, 'id')) : [];
}

describe.skipIf(!TEST_DATABASE_URL)('agent tools (integration)', () => {
  let ws: WorkspaceFixture;
  let projectA: ProjectFixture;
  let projectB: ProjectFixture;
  let adminOnly: ProjectFixture;
  let owner: ToolContext;
  let member: ToolContext;

  const run = (name: string, args: object, ctx: ToolContext = owner) =>
    executeAgentTool(name, args, ctx);

  async function createTask(ctx: ToolContext, projectId: string, title: string): Promise<string> {
    const result = await run('create_task', { projectId, title }, ctx);
    const id = result.id;
    if (typeof id !== 'string') throw new Error('create_task returned no id');
    return id;
  }

  beforeAll(async () => {
    // The tool runtime uses the app's database singleton (getDatabase()).
    process.env.DATABASE_URL = TEST_DATABASE_URL;
    const db = testDb();
    ws = await createWorkspace(db);
    projectA = await createProject(db, ws.workspaceId);
    projectB = await createProject(db, ws.workspaceId);
    adminOnly = await createProject(db, ws.workspaceId, { access: 'admin' });
    const context = (userId: string, role: WorkspaceRole) =>
      buildToolContext({
        workspaceId: ws.workspaceId,
        userId,
        role,
        grantedTools: AgentToolSchema.options,
      });
    owner = context(ws.owner.id, 'owner');
    member = context(ws.member.id, 'member');
  });

  afterAll(async () => {
    await domainEvents.idle();
  });

  it('sets, lists and clears a parent; get_task shows parent and sub-tasks', async () => {
    const parentId = await createTask(owner, projectA.projectId, 'Epic');
    const parent = unwrap(await new TaskService(testDb()).getById(parentId));
    const parentKey = `${projectA.identifier}-${parent.sequenceNumber}`;

    const created = await run('create_task', {
      projectId: projectA.projectId,
      title: 'Child',
      parentId: parentKey,
      return: 'compact',
    });
    const childId = field(created.task, 'id');
    expect(field(created.task, 'parentId')).toBe(parentId);
    if (typeof childId !== 'string') throw new Error('no child id');

    const bulk = await run('bulk_create_tasks', {
      projectId: projectA.projectId,
      tasks: [{ title: 'Child 2', parentId }],
    });
    expect(bulk.failed).toEqual([]);

    const children = await run('query_tasks', { parentId: parentKey });
    expect(children.total).toBe(2);

    const detail = await run('get_task', { taskId: parentId, view: 'full' });
    expect(idsOf(field(detail.task, 'subtasks'))).toContain(childId);
    const childDetail = await run('get_task', { taskId: childId, view: 'full' });
    expect(field(field(childDetail.task, 'parent'), 'id')).toBe(parentId);
    expect(field(field(childDetail.task, 'parent'), 'title')).toEqual({ untrusted_text: 'Epic' });

    await run('update_task', { taskId: childId, parentId: null });
    const [detached] = await testDb()
      .select({ parentId: tasks.parentId })
      .from(tasks)
      .where(eq(tasks.id, childId));
    expect(detached?.parentId).toBeNull();

    const bulkUpdate = await run('bulk_update_tasks', { updates: [{ taskId: childId, parentId }] });
    expect(bulkUpdate.ok).toBe(true);
    const topLevel = await run('query_tasks', { projectId: projectA.projectId, parentId: 'none' });
    expect(idsOf(topLevel.tasks)).not.toContain(childId);
    expect(idsOf(topLevel.tasks)).toContain(parentId);

    // A task cannot become the child of its own sub-task (TaskService rule).
    await expectToolError(
      run('update_task', { taskId: parentId, parentId: childId }),
      'DOMAIN_ERROR',
      /cycle/
    );
  });

  it('rejects a parent from another project and hides one the caller cannot see', async () => {
    const child = await createTask(owner, projectA.projectId, 'Child');
    const foreign = await createTask(owner, projectB.projectId, 'Foreign parent');
    const secret = await createTask(owner, adminOnly.projectId, 'Secret parent');

    await expectToolError(
      run('update_task', { taskId: child, parentId: foreign }),
      'DOMAIN_ERROR',
      /same project/
    );
    await expectToolError(
      run('create_task', { projectId: projectA.projectId, title: 'x', parentId: foreign }),
      'DOMAIN_ERROR',
      /same project/
    );
    await expectToolError(
      run('update_task', { taskId: child, parentId: secret }, member),
      'NOT_FOUND'
    );
  });

  it('links and unlinks tasks across projects (round trip)', async () => {
    const a = await createTask(owner, projectA.projectId, 'Blocker');
    const b = await createTask(owner, projectB.projectId, 'Blocked');

    const linked = await run('link_tasks', { taskId: a, relatedTaskId: b, type: 'blocks' });
    expect(linked.relation).toMatchObject({
      type: 'blocks',
      direction: 'outgoing',
      task: { id: b },
    });
    await expectToolError(
      run('link_tasks', { taskId: a, relatedTaskId: b, type: 'blocks' }),
      'DOMAIN_ERROR',
      /already exists/
    );

    const detail = await run('get_task', { taskId: b, view: 'full' });
    expect(field(detail.task, 'relations')).toMatchObject([
      { type: 'blocks', direction: 'incoming', task: { id: a } },
    ]);

    await run('unlink_tasks', { taskId: b, relatedTaskId: a, type: 'blocks' });
    const rows = await testDb()
      .select({ id: taskRelations.id })
      .from(taskRelations)
      .where(or(eq(taskRelations.taskId, a), eq(taskRelations.relatedTaskId, a)));
    expect(rows).toEqual([]);

    // By relation id, as returned by link_tasks.
    const again = await run('link_tasks', { taskId: a, relatedTaskId: b, type: 'relates' });
    const relationId = field(again.relation, 'id');
    const removed = await run('unlink_tasks', { taskId: a, relationId });
    expect(removed.relationId).toBe(relationId);
    await expectToolError(run('unlink_tasks', { taskId: a, relationId }), 'NOT_FOUND');
  });

  it('treats a related task in an inaccessible project as not found', async () => {
    const visible = await createTask(owner, projectA.projectId, 'Visible');
    const secret = await createTask(owner, adminOnly.projectId, 'Secret');

    await expectToolError(
      run('link_tasks', { taskId: visible, relatedTaskId: secret, type: 'relates' }, member),
      'NOT_FOUND'
    );

    const linked = await run('link_tasks', {
      taskId: visible,
      relatedTaskId: secret,
      type: 'relates',
    });
    const detail = await run('get_task', { taskId: visible, view: 'full' }, member);
    expect(field(detail.task, 'relations')).toEqual([]);
    await expectToolError(
      run('unlink_tasks', { taskId: visible, relationId: field(linked.relation, 'id') }, member),
      'NOT_FOUND'
    );
  });

  it('creates a label and uses it in create_task; members may not create labels', async () => {
    const created = await run('create_label', {
      projectId: projectA.projectId,
      name: 'infra',
      color: '#0af',
    });
    const labelId = field(created.label, 'id');
    expect(created.label).toMatchObject({ name: 'infra', color: '#0af' });

    const task = await run('create_task', {
      projectId: projectA.projectId,
      title: 'Labelled',
      labelIds: [labelId],
      return: 'full',
    });
    expect(idsOf(field(task.task, 'labels'))).toEqual([labelId]);

    const listed = await run('list_labels', { projectId: projectA.projectId });
    expect(idsOf(listed.labels)).toContain(labelId);

    await expectToolError(
      run('create_label', { projectId: projectA.projectId, name: 'nope' }, member),
      'FORBIDDEN'
    );
  });
});
