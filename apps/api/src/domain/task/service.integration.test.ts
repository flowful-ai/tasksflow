/**
 * TaskService integration tests. Skipped unless TEST_DATABASE_URL points at a
 * database migrated through drizzle/0016_v2.sql (the test preload does this).
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { and, asc, eq, sql } from 'drizzle-orm';
import { createDatabase, taskEvents, taskStates, tasks } from '../../db/index.js';
import {
  arePositionsHealthy,
  comparePositions,
  generatePosition,
  generatePositions,
  isValidPosition,
} from '@flowtask/shared';
import { domainEvents } from '../events/bus.js';
import type { DomainEventMap } from '../events/types.js';
import { TaskBulkService } from './bulk.js';
import { isTaskError } from './errors.js';
import { TaskHistoryService } from './history.js';
import { TaskRelationService } from './relations.js';
import { TaskService } from './service.js';
import { placeTask, type PlacementRequest } from './positions.js';
import { purgeTrash } from './trash.js';
import { rekeyTaskPositions } from './rekey.js';
import { ProjectService } from '../project/service.js';
import { SearchService } from '../search/service.js';
import {
  TEST_DATABASE_URL,
  createProject,
  createUser,
  createWorkspace,
  testDb,
  unwrap,
  type ProjectFixture,
  type WorkspaceFixture,
} from './test-fixtures.js';

function expectCode(result: { ok: boolean; error?: Error }, code: string) {
  expect(result.ok).toBe(false);
  const error = result.error;
  expect(error && isTaskError(error) ? error.code : error?.message).toBe(code);
}

describe.skipIf(!TEST_DATABASE_URL)('TaskService (integration)', () => {
  let ws: WorkspaceFixture;
  let project: ProjectFixture;
  let other: ProjectFixture;
  let service: TaskService;

  beforeAll(async () => {
    const db = testDb();
    service = new TaskService(db);
    ws = await createWorkspace(db);
    project = await createProject(db, ws.workspaceId);
    const otherWs = await createWorkspace(db);
    other = await createProject(db, otherWs.workspaceId);
  });

  afterAll(async () => {
    await domainEvents.idle();
  });

  it('allocates unique sequence numbers for 50 concurrent creates without errors', async () => {
    const p = await createProject(testDb(), ws.workspaceId);
    const results = await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        service.create({ projectId: p.projectId, title: `Concurrent ${i}`, createdBy: ws.owner.id })
      )
    );
    const failures = results.filter((r) => !r.ok);
    expect(failures).toEqual([]);
    const created = results.map(unwrap);
    const seqs = created.map((t) => t.sequenceNumber).sort((a, b) => a - b);
    expect(seqs).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    const positions = created.map((t) => t.position);
    expect(new Set(positions).size).toBe(50);
    expect(positions.every(isValidPosition)).toBe(true);
    // Every create wrote exactly one 'created' event.
    const [count] = await testDb()
      .select({ n: sql<number>`count(*)::int` })
      .from(taskEvents)
      .innerJoin(tasks, eq(taskEvents.taskId, tasks.id))
      .where(and(eq(tasks.projectId, p.projectId), eq(taskEvents.eventType, 'created')));
    expect(Number(count!.n)).toBe(50);
  });

  it('defaults to the first backlog state, sets key, assignees and labels', async () => {
    const task = unwrap(
      await service.create({
        projectId: project.projectId,
        title: 'With relations',
        createdBy: ws.owner.id,
        assigneeIds: [ws.member.id],
        labelIds: [project.labelId],
      })
    );
    expect(task.stateId).toBe(project.states.backlog);
    expect(task.key).toBe(`${project.identifier}-${task.sequenceNumber}`);
    expect(task.assignees.map((a) => a.id)).toEqual([ws.member.id]);
    expect(task.labels.map((l) => l.id)).toEqual([project.labelId]);
    expect(task.project.workspaceId).toBe(ws.workspaceId);
    expect('searchVector' in task).toBe(false);
  });

  describe('foreign-id validation', () => {
    it('rejects a state, label or assignee from elsewhere on create', async () => {
      const base = { projectId: project.projectId, title: 'x', createdBy: ws.owner.id };
      expectCode(await service.create({ ...base, stateId: other.states.backlog }), 'INVALID_STATE');
      expectCode(await service.create({ ...base, labelIds: [other.labelId] }), 'INVALID_LABEL');
      expectCode(
        await service.create({ ...base, assigneeIds: [ws.outsider.id] }),
        'INVALID_ASSIGNEE'
      );
    });

    it('rejects foreign ids on update, move, addLabel and addAssignee', async () => {
      const task = unwrap(
        await service.create({ projectId: project.projectId, title: 'v', createdBy: ws.owner.id })
      );
      expectCode(
        await service.update(task.id, { stateId: other.states.done, updatedBy: ws.owner.id }),
        'INVALID_STATE'
      );
      expectCode(
        await service.update(task.id, { labelIds: [other.labelId], updatedBy: ws.owner.id }),
        'INVALID_LABEL'
      );
      expectCode(
        await service.move(task.id, { stateId: other.states.done, movedBy: ws.owner.id }),
        'INVALID_STATE'
      );
      expectCode(await service.addLabel(task.id, other.labelId, ws.owner.id), 'INVALID_LABEL');
      expectCode(
        await service.addAssignee(task.id, ws.outsider.id, ws.owner.id),
        'INVALID_ASSIGNEE'
      );
    });

    it('requires project membership for assignees of a restricted project', async () => {
      const db = testDb();
      const restricted = await createProject(db, ws.workspaceId, { access: 'members' });
      const base = { projectId: restricted.projectId, title: 'r', createdBy: ws.owner.id };
      expectCode(
        await service.create({ ...base, assigneeIds: [ws.member.id] }),
        'INVALID_ASSIGNEE'
      );
      // Owners/admins always have access.
      expect((await service.create({ ...base, assigneeIds: [ws.owner.id] })).ok).toBe(true);
      const allowed = await createProject(db, ws.workspaceId, {
        access: 'members',
        memberIds: [ws.member.id],
      });
      expect(
        (
          await service.create({
            ...base,
            projectId: allowed.projectId,
            assigneeIds: [ws.member.id],
          })
        ).ok
      ).toBe(true);
      const adminOnly = await createProject(db, ws.workspaceId, { access: 'admin' });
      expectCode(
        await service.create({
          ...base,
          projectId: adminOnly.projectId,
          assigneeIds: [ws.member.id],
        }),
        'INVALID_ASSIGNEE'
      );
    });
  });

  describe('list scope', () => {
    it('returns an error without projectId/projectIds/workspaceId', async () => {
      expectCode(await service.list({}), 'MISSING_SCOPE');
      expectCode(await service.list({ filters: { search: 'x' } }), 'MISSING_SCOPE');
    });

    it('filters by workspaceId and treats an empty projectIds as nothing', async () => {
      const inWs = unwrap(
        await service.list({ filters: { workspaceId: ws.workspaceId }, limit: 100 })
      );
      expect(inWs.total).toBeGreaterThan(0);
      expect(inWs.tasks.every((t) => t.project.workspaceId === ws.workspaceId)).toBe(true);
      expect(unwrap(await service.list({ filters: { projectIds: [] } })).total).toBe(0);
    });

    it('filters by assignee without duplicating rows', async () => {
      const t = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'two assignees',
          createdBy: ws.owner.id,
          assigneeIds: [ws.owner.id, ws.member.id],
        })
      );
      const listed = unwrap(
        await service.list({
          filters: { projectId: project.projectId, assigneeIds: [ws.owner.id, ws.member.id] },
        })
      );
      expect(listed.tasks.filter((x) => x.id === t.id)).toHaveLength(1);
    });
  });

  describe('soft delete, restore, trash', () => {
    it('getById hides deleted tasks unless includeDeleted, restore brings them back', async () => {
      const task = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'to trash',
          createdBy: ws.owner.id,
        })
      );
      unwrap(await service.delete(task.id, ws.owner.id));
      expectCode(await service.getById(task.id), 'TASK_NOT_FOUND');
      expect(
        unwrap(await service.getById(task.id, { includeDeleted: true })).deletedAt
      ).not.toBeNull();

      const trash = unwrap(await service.listTrash(project.projectId));
      expect(trash.tasks[0]?.id).toBe(task.id);

      const restored = unwrap(await service.restore(task.id, ws.owner.id));
      expect(restored.deletedAt).toBeNull();
      expect(unwrap(await service.getById(task.id)).id).toBe(task.id);
      // Restoring a live task is a no-op.
      expect((await service.restore(task.id, ws.owner.id)).ok).toBe(true);
    });

    it('purges tasks deleted more than 30 days ago', async () => {
      const task = unwrap(
        await service.create({ projectId: project.projectId, title: 'old', createdBy: ws.owner.id })
      );
      await testDb()
        .update(tasks)
        .set({ deletedAt: new Date(Date.now() - 31 * 86_400_000) })
        .where(eq(tasks.id, task.id));
      expect(await purgeTrash(testDb())).toBeGreaterThanOrEqual(1);
      expectCode(await service.getById(task.id, { includeDeleted: true }), 'TASK_NOT_FOUND');
    });
  });

  describe('sub-tasks', () => {
    it('counts sub-tasks, filters by parentId, rejects cycles and cross-project parents', async () => {
      const parent = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'parent',
          createdBy: ws.owner.id,
        })
      );
      const a = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'child a',
          parentId: parent.id,
          createdBy: ws.owner.id,
        })
      );
      const b = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'child b',
          parentId: parent.id,
          createdBy: ws.owner.id,
        })
      );
      unwrap(await service.move(b.id, { stateId: project.states.done, movedBy: ws.owner.id }));

      const detail = unwrap(await service.getById(parent.id));
      expect(detail.subtaskCount).toBe(2);
      expect(detail.subtaskDoneCount).toBe(1);
      expect(detail.subtasks?.map((s) => s.id).sort()).toEqual([a.id, b.id].sort());
      expect(unwrap(await service.getById(a.id)).parent?.id).toBe(parent.id);

      const children = unwrap(
        await service.list({ filters: { projectId: project.projectId, parentId: parent.id } })
      );
      expect(children.tasks.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
      const listedParent = unwrap(
        await service.list({ filters: { projectId: project.projectId, ids: [parent.id] } })
      );
      expect(listedParent.tasks[0]?.subtaskCount).toBe(2);

      expectCode(
        await service.update(parent.id, { parentId: a.id, updatedBy: ws.owner.id }),
        'PARENT_CYCLE'
      );
      expectCode(
        await service.update(parent.id, { parentId: parent.id, updatedBy: ws.owner.id }),
        'PARENT_CYCLE'
      );
      const foreign = unwrap(
        await service.create({ projectId: other.projectId, title: 'foreign', createdBy: null })
      );
      expectCode(
        await service.update(a.id, { parentId: foreign.id, updatedBy: ws.owner.id }),
        'INVALID_PARENT'
      );
      unwrap(await service.update(a.id, { parentId: null, updatedBy: ws.owner.id }));
      expect(unwrap(await service.getById(parent.id)).subtaskCount).toBe(1);
    });
  });

  describe('positions', () => {
    it('places a task between neighbours with afterTaskId/beforeTaskId', async () => {
      const p = await createProject(testDb(), ws.workspaceId);
      const make = async (title: string) =>
        unwrap(await service.create({ projectId: p.projectId, title, createdBy: ws.owner.id }));
      const one = await make('1');
      const two = await make('2');
      const three = await make('3');
      unwrap(
        await service.move(three.id, {
          stateId: p.states.backlog,
          afterTaskId: one.id,
          movedBy: ws.owner.id,
        })
      );
      const ordered = unwrap(
        await service.list({
          filters: { projectId: p.projectId, stateId: p.states.backlog },
          sortBy: 'position',
        })
      );
      expect(ordered.tasks.map((t) => t.title)).toEqual(['1', '3', '2']);
      unwrap(
        await service.move(one.id, {
          stateId: p.states.backlog,
          beforeTaskId: null,
          movedBy: ws.owner.id,
        })
      );
      const after = unwrap(
        await service.list({ filters: { projectId: p.projectId, stateId: p.states.backlog } })
      );
      expect(after.tasks.map((t) => t.title)).toEqual(['3', '2', '1']);
      void two;
    });

    it('re-keys a column holding legacy invalid keys, preserving order', async () => {
      const p = await createProject(testDb(), ws.workspaceId);
      const created = [];
      for (const title of ['A', 'B', 'C', 'D']) {
        created.push(
          unwrap(await service.create({ projectId: p.projectId, title, createdBy: ws.owner.id }))
        );
      }
      // Simulate the pre-v2 generator: invalid and colliding keys.
      const legacy = ['az', 'b0', 'b0', 'bU'];
      for (const [i, task] of created.entries()) {
        await testDb().update(tasks).set({ position: legacy[i]! }).where(eq(tasks.id, task.id));
      }
      const rekeyed: DomainEventMap['tasks.rekeyed'][] = [];
      const off = domainEvents.on('tasks.rekeyed', (e) => {
        if (e.projectId === p.projectId) rekeyed.push(e);
      });
      // Drop D between B and C (two equal invalid keys).
      unwrap(
        await service.move(created[3]!.id, {
          stateId: p.states.backlog,
          afterTaskId: created[1]!.id,
          movedBy: ws.owner.id,
        })
      );
      await domainEvents.idle();
      off();
      const rows = await testDb()
        .select({ title: tasks.title, position: tasks.position })
        .from(tasks)
        .where(eq(tasks.projectId, p.projectId))
        .orderBy(sql`${tasks.position} COLLATE "C"`, asc(tasks.id));
      // B and C had the same key; the tiebreak is the id, so only check the moved task's slot.
      const titles = rows.map((r) => r.title);
      expect(titles[0]).toBe('A');
      expect(titles.indexOf('D')).toBe(titles.indexOf('B') + 1);
      expect(arePositionsHealthy(rows.map((r) => r.position))).toBe(true);
      expect(rekeyed).toHaveLength(1);
    });

    it('emits tasks.rekeyed when a bulk state change re-keys the target column', async () => {
      const p = await createProject(testDb(), ws.workspaceId);
      const inProgress = [];
      for (const title of ['P1', 'P2']) {
        inProgress.push(
          unwrap(
            await service.create({
              projectId: p.projectId,
              title,
              stateId: p.states.progress,
              createdBy: ws.owner.id,
            })
          )
        );
      }
      // Legacy (invalid) keys in the target column force a re-key on placement.
      const legacyKeys = ['b0', 'bU'];
      for (const [i, task] of inProgress.entries()) {
        await testDb()
          .update(tasks)
          .set({ position: legacyKeys[i] ?? 'bU' })
          .where(eq(tasks.id, task.id));
      }
      const mover = unwrap(
        await service.create({ projectId: p.projectId, title: 'mover', createdBy: ws.owner.id })
      );
      const rekeyed: DomainEventMap['tasks.rekeyed'][] = [];
      const off = domainEvents.on('tasks.rekeyed', (e) => {
        if (e.projectId === p.projectId) rekeyed.push(e);
      });
      unwrap(
        await new TaskBulkService(testDb()).apply({
          taskIds: [mover.id],
          op: { stateId: p.states.progress },
          actorId: ws.owner.id,
          allowedProjectIds: new Set([p.projectId]),
        })
      );
      await domainEvents.idle();
      off();
      expect(rekeyed).toEqual([
        { workspaceId: ws.workspaceId, projectId: p.projectId, stateId: p.states.progress },
      ]);
    });

    it('places by neighbour keys only, without reading a 2k-row column', async () => {
      const p = await createProject(testDb(), ws.workspaceId);
      const keys = generatePositions(2000);
      await testDb().execute(sql`
        INSERT INTO tasks (project_id, state_id, sequence_number, title, position)
        SELECT ${p.projectId}, ${p.states.backlog}, n, 'bulk ' || n, k
        FROM unnest(${sql.raw(`ARRAY[${keys.map((k) => `'${k}'`).join(',')}]`)}::text[])
          WITH ORDINALITY AS u(k, n)`);
      // A trashed task at the tail still bounds an append (it keeps its key).
      const [trashed] = await testDb()
        .insert(tasks)
        .values({
          projectId: p.projectId,
          stateId: p.states.backlog,
          sequenceNumber: 2001,
          title: 'trashed tail',
          position: generatePosition(keys[keys.length - 1], null),
          deletedAt: new Date(),
        })
        .returning({ id: tasks.id, position: tasks.position });
      const rows = await testDb()
        .select({ id: tasks.id, position: tasks.position })
        .from(tasks)
        .where(eq(tasks.projectId, p.projectId))
        .orderBy(sql`${tasks.position} COLLATE "C"`, asc(tasks.id));

      // Every statement placeTask sends goes through this logger.
      const queries: string[] = [];
      const logged = createDatabase(TEST_DATABASE_URL, {
        logger: { logQuery: (query) => queries.push(query) },
      });
      /** Statements that read tasks without a LIMIT (i.e. a column scan). */
      const columnScans = () =>
        queries.filter((q) => /from "?tasks"?/i.test(q) && !/\blimit\b/i.test(q)).length;
      const place = (request: Omit<PlacementRequest, 'projectId' | 'stateId'>) =>
        logged.transaction(async (tx) => {
          queries.length = 0;
          return placeTask(tx, { projectId: p.projectId, stateId: p.states.backlog, ...request });
        });

      const appended = await place({});
      expect(appended.rekeyed).toBe(false);
      expect(comparePositions(appended.position, trashed!.position)).toBe(1);
      expect(columnScans()).toBe(0);

      const after = await place({ afterTaskId: rows[999]!.id, taskId: rows[5]!.id });
      expect(comparePositions(after.position, rows[999]!.position)).toBe(1);
      expect(comparePositions(after.position, rows[1000]!.position)).toBe(-1);
      expect(columnScans()).toBe(0);

      const before = await place({ beforeTaskId: rows[0]!.id });
      expect(comparePositions(before.position, rows[0]!.position)).toBe(-1);
      expect(columnScans()).toBe(0);

      // The excluded task is never its own anchor.
      await expect(place({ afterTaskId: rows[3]!.id, taskId: rows[3]!.id })).rejects.toThrow(
        'afterTaskId is not in the target column'
      );

      const byKey = await place({ position: rows[10]!.position, taskId: rows[42]!.id });
      expect(comparePositions(byKey.position, rows[10]!.position)).toBe(1);
      expect(comparePositions(byKey.position, rows[11]!.position)).toBe(-1);
      expect(columnScans()).toBe(0);

      // An invalid neighbour falls back to the full column and re-keys it.
      await testDb()
        .update(tasks)
        .set({ position: `${rows[0]!.position}:` })
        .where(eq(tasks.id, rows[1]!.id));
      const repaired = await place({ afterTaskId: rows[0]!.id });
      expect(repaired.rekeyed).toBe(true);
      expect(columnScans()).toBe(1);
    });

    it('rekeyTaskPositions repairs an invalid column in one pass, keeping order', async () => {
      const p = await createProject(testDb(), ws.workspaceId);
      const created = [];
      for (const title of ['R1', 'R2', 'R3']) {
        created.push(
          unwrap(await service.create({ projectId: p.projectId, title, createdBy: ws.owner.id }))
        );
      }
      const legacyKeys = ['az', 'b0', 'bU'];
      for (const [i, task] of created.entries()) {
        await testDb()
          .update(tasks)
          .set({ position: legacyKeys[i] ?? 'bU' })
          .where(eq(tasks.id, task.id));
      }
      const report = await rekeyTaskPositions(testDb(), { onlyInvalid: true });
      expect(report.columnsRekeyed).toBeGreaterThanOrEqual(1);
      const rows = await testDb()
        .select({ title: tasks.title, position: tasks.position })
        .from(tasks)
        .where(eq(tasks.projectId, p.projectId))
        .orderBy(sql`${tasks.position} COLLATE "C"`, asc(tasks.id));
      expect(rows.map((r) => r.title)).toEqual(['R1', 'R2', 'R3']);
      expect(arePositionsHealthy(rows.map((r) => r.position))).toBe(true);
    });

    it('orders positions in Postgres exactly like JS code-unit order', async () => {
      const keys = [
        'a0',
        'Zz',
        'a0V',
        'aZ',
        'a_',
        'b00',
        'A00000000000000000000000001',
        'az',
        'a',
        'B',
        'a0a',
        'a0A',
        'Z',
        'zz',
      ];
      const rows = await testDb().execute<{ k: string }>(
        sql`SELECT k FROM unnest(${sql.raw(`ARRAY[${keys.map((k) => `'${k}'`).join(',')}]`)}::text[]) AS k ORDER BY k COLLATE "C"`
      );
      expect(rows.map((r) => r.k)).toEqual([...keys].sort(comparePositions));
      // And the column itself sorts byte-wise without an explicit COLLATE.
      const [collation] = await testDb().execute<{ collation: string | null }>(sql`
        SELECT collation_name AS collation FROM information_schema.columns
        WHERE table_name = 'tasks' AND column_name = 'position'`);
      expect(collation?.collation).toBe('C');
    });
  });

  describe('events and history', () => {
    it('records detailed events and renders history with names', async () => {
      const db = testDb();
      const task = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'History',
          createdBy: ws.owner.id,
        })
      );
      unwrap(
        await service.update(task.id, {
          priority: 'high',
          title: 'History 2',
          updatedBy: ws.owner.id,
        })
      );
      unwrap(
        await service.move(task.id, { stateId: project.states.progress, movedBy: ws.member.id })
      );
      unwrap(await service.addAssignee(task.id, ws.member.id, ws.owner.id));
      unwrap(await service.addLabel(task.id, project.labelId, ws.owner.id));
      unwrap(
        await service.update(task.id, {
          dueDate: new Date('2030-01-01T00:00:00Z'),
          updatedBy: ws.owner.id,
        })
      );
      // Same due date again: no new event.
      unwrap(
        await service.update(task.id, {
          dueDate: new Date('2030-01-01T00:00:00Z'),
          updatedBy: ws.owner.id,
        })
      );

      const history = new TaskHistoryService(db);
      const page = unwrap(await history.list(task.id, { limit: 3 }));
      expect(page.items).toHaveLength(3);
      expect(page.nextCursor).not.toBeNull();
      const rest = unwrap(await history.list(task.id, { cursor: page.nextCursor!, limit: 50 }));
      const all = [...page.items, ...rest.items];
      expect(all.map((i) => i.type)).toEqual([
        'updated',
        'labeled',
        'assigned',
        'moved',
        'updated',
        'updated',
        'created',
      ]);

      const moved = all.find((i) => i.type === 'moved')!;
      expect(moved.actor?.name).toBe('Member');
      expect(moved.from).toMatchObject({ kind: 'state', name: 'Todo' });
      expect(moved.to).toMatchObject({ kind: 'state', name: 'In progress' });
      expect(all.find((i) => i.type === 'assigned')!.to).toMatchObject({
        kind: 'user',
        name: 'Member',
      });
      expect(all.find((i) => i.type === 'labeled')!.to).toMatchObject({
        kind: 'label',
        name: 'bug',
      });

      // The snapshot keeps names after the state is gone.
      await db
        .update(taskStates)
        .set({ name: 'Renamed' })
        .where(eq(taskStates.id, project.states.progress));
      const again = unwrap(await history.list(task.id, { limit: 50 }));
      expect(again.items.find((i) => i.type === 'moved')!.to).toMatchObject({ name: 'Renamed' });
      await db
        .update(taskStates)
        .set({ name: 'In progress' })
        .where(eq(taskStates.id, project.states.progress));
    });

    it('emits domain events after commit', async () => {
      const seen: string[] = [];
      const offs = (
        ['task.created', 'task.updated', 'task.moved', 'task.deleted', 'task.restored'] as const
      ).map((name) =>
        domainEvents.on(name, (e) => {
          if (e.projectId === project.projectId) seen.push(name);
        })
      );
      const task = unwrap(
        await service.create({ projectId: project.projectId, title: 'evt', createdBy: ws.owner.id })
      );
      unwrap(await service.update(task.id, { title: 'evt2', updatedBy: ws.owner.id }));
      unwrap(await service.move(task.id, { stateId: project.states.done, movedBy: ws.owner.id }));
      unwrap(await service.delete(task.id, ws.owner.id));
      unwrap(await service.restore(task.id, ws.owner.id));
      // A failed update emits nothing.
      await service.update(task.id, { stateId: other.states.done, updatedBy: ws.owner.id });
      await domainEvents.idle();
      offs.forEach((off) => off());
      expect(seen).toEqual([
        'task.created',
        'task.updated',
        'task.moved',
        'task.deleted',
        'task.restored',
      ]);
    });
  });

  describe('relations', () => {
    it('adds, lists and removes relations, exposing blocks/blockedBy on the detail', async () => {
      const relations = new TaskRelationService(testDb());
      const a = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'blocker',
          createdBy: ws.owner.id,
        })
      );
      const b = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'blocked',
          createdBy: ws.owner.id,
        })
      );
      const rel = unwrap(
        await relations.add({
          taskId: a.id,
          relatedTaskId: b.id,
          type: 'blocks',
          createdBy: ws.owner.id,
        })
      );
      expect(rel.direction).toBe('outgoing');
      expectCode(
        await relations.add({ taskId: a.id, relatedTaskId: b.id, type: 'blocks', createdBy: null }),
        'RELATION_EXISTS'
      );
      expectCode(
        await relations.add({ taskId: b.id, relatedTaskId: a.id, type: 'blocks', createdBy: null }),
        'INVALID_RELATION'
      );
      expectCode(
        await relations.add({
          taskId: a.id,
          relatedTaskId: a.id,
          type: 'relates',
          createdBy: null,
        }),
        'INVALID_RELATION'
      );
      unwrap(
        await relations.add({ taskId: b.id, relatedTaskId: a.id, type: 'relates', createdBy: null })
      );
      expectCode(
        await relations.add({
          taskId: a.id,
          relatedTaskId: b.id,
          type: 'relates',
          createdBy: null,
        }),
        'RELATION_EXISTS'
      );
      const foreign = unwrap(
        await service.create({ projectId: other.projectId, title: 'f', createdBy: null })
      );
      expectCode(
        await relations.add({
          taskId: a.id,
          relatedTaskId: foreign.id,
          type: 'relates',
          createdBy: null,
        }),
        'INVALID_RELATION'
      );

      expect(unwrap(await service.getById(a.id)).blocks?.map((t) => t.id)).toEqual([b.id]);
      expect(unwrap(await service.getById(b.id)).blockedBy?.map((t) => t.id)).toEqual([a.id]);
      const fromB = unwrap(await relations.list(b.id));
      expect(fromB.find((r) => r.type === 'blocks')?.direction).toBe('incoming');

      unwrap(await relations.remove(b.id, rel.id, ws.owner.id));
      expect(unwrap(await service.getById(b.id)).blockedBy).toEqual([]);
      expectCode(await relations.remove(b.id, rel.id, ws.owner.id), 'RELATION_NOT_FOUND');
    });
  });

  describe('search', () => {
    it('matches full text, prefixes and task keys', async () => {
      const p = await createProject(testDb(), ws.workspaceId);
      const t1 = unwrap(
        await service.create({
          projectId: p.projectId,
          title: 'Replace lexicographic midpoint',
          description: 'Use fractional-indexing',
          createdBy: ws.owner.id,
        })
      );
      unwrap(
        await service.create({ projectId: p.projectId, title: 'Dark mode', createdBy: ws.owner.id })
      );
      const byPrefix = unwrap(
        await service.list({ filters: { projectId: p.projectId, search: 'lexico' } })
      );
      expect(byPrefix.tasks.map((t) => t.id)).toEqual([t1.id]);
      const byDescription = unwrap(
        await service.list({ filters: { projectId: p.projectId, search: 'fractional' } })
      );
      expect(byDescription.tasks.map((t) => t.id)).toEqual([t1.id]);
      const byKey = unwrap(
        await service.list({ filters: { projectId: p.projectId, search: t1.key!.toLowerCase() } })
      );
      expect(byKey.tasks.map((t) => t.id)).toEqual([t1.id]);
      const short = unwrap(
        await service.list({ filters: { projectId: p.projectId, search: 'Da' } })
      );
      expect(short.tasks.map((t) => t.title)).toEqual(['Dark mode']);

      const search = new SearchService(testDb());
      const hits = unwrap(await search.search({ projectIds: [p.projectId], q: t1.key! }));
      expect(hits.tasks[0]).toMatchObject({ id: t1.id, exactKeyMatch: true });
      const projectsHit = unwrap(
        await search.search({ projectIds: [p.projectId], q: p.identifier })
      );
      expect(projectsHit.projects.map((x) => x.id)).toEqual([p.projectId]);
      expect(unwrap(await search.search({ projectIds: [], q: 'lexico' })).tasks).toEqual([]);
    });

    it('scopes the task-key match to the caller and ORs it with the text search', async () => {
      const p = await createProject(testDb(), ws.workspaceId);
      // A task whose key exists only in another workspace.
      const foreign = unwrap(
        await service.create({ projectId: other.projectId, title: 'foreign', createdBy: null })
      );
      const local = unwrap(
        await service.create({
          projectId: p.projectId,
          title: `${foreign.key} regression`,
          createdBy: ws.owner.id,
        })
      );
      const hits = unwrap(
        await service.list({ filters: { workspaceId: ws.workspaceId, search: foreign.key ?? '' } })
      );
      // The foreign key neither leaks the foreign task nor hides the local text match.
      expect(hits.tasks.map((t) => t.id)).toEqual([local.id]);

      const own = unwrap(
        await service.create({ projectId: p.projectId, title: 'by key', createdBy: ws.owner.id })
      );
      const byKey = unwrap(
        await service.list({ filters: { projectId: p.projectId, search: own.key ?? '' } })
      );
      expect(byKey.tasks.map((t) => t.id)).toContain(own.id);
    });
  });

  describe('completedAt', () => {
    const completedAtOf = async (id: string) => {
      const [row] = await testDb()
        .select({ completedAt: tasks.completedAt })
        .from(tasks)
        .where(eq(tasks.id, id));
      return row!.completedAt;
    };

    it('stamps on entering done, keeps it done → done, clears on leaving (move, update, bulk, create)', async () => {
      const db = testDb();
      const [archived] = await db
        .insert(taskStates)
        .values({
          projectId: project.projectId,
          name: 'Archived',
          category: 'done',
          position: 'a3',
        })
        .returning();
      const task = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'completes',
          createdBy: ws.owner.id,
        })
      );
      expect(await completedAtOf(task.id)).toBeNull();

      unwrap(await service.move(task.id, { stateId: project.states.done, movedBy: ws.owner.id }));
      const stamped = await completedAtOf(task.id);
      expect(stamped).toBeInstanceOf(Date);

      unwrap(await service.update(task.id, { stateId: archived!.id, updatedBy: ws.owner.id }));
      expect((await completedAtOf(task.id))?.getTime()).toBe(stamped!.getTime());

      unwrap(
        await service.update(task.id, { stateId: project.states.progress, updatedBy: ws.owner.id })
      );
      expect(await completedAtOf(task.id)).toBeNull();

      const bulk = new TaskBulkService(db);
      unwrap(
        await bulk.apply({
          taskIds: [task.id],
          op: { stateId: project.states.done },
          actorId: ws.owner.id,
          allowedProjectIds: new Set([project.projectId]),
        })
      );
      expect(await completedAtOf(task.id)).toBeInstanceOf(Date);

      const createdDone = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'born done',
          stateId: project.states.done,
          createdBy: ws.owner.id,
        })
      );
      expect(await completedAtOf(createdDone.id)).toBeInstanceOf(Date);
    });

    it('deleting a state clears completedAt of its tasks', async () => {
      const db = testDb();
      const p = await createProject(db, ws.workspaceId);
      const task = unwrap(
        await service.create({
          projectId: p.projectId,
          title: 'done then state deleted',
          stateId: p.states.done,
          createdBy: ws.owner.id,
        })
      );
      expect(await completedAtOf(task.id)).toBeInstanceOf(Date);
      unwrap(await new ProjectService(db).deleteTaskState(p.projectId, p.states.done));
      const [row] = await db
        .select({ stateId: tasks.stateId, completedAt: tasks.completedAt })
        .from(tasks)
        .where(eq(tasks.id, task.id));
      expect(row).toEqual({ stateId: null, completedAt: null });
      // A state of another project is not found (and nothing is touched).
      const result = await new ProjectService(db).deleteTaskState(p.projectId, other.states.done);
      expect(result.ok).toBe(false);
    });
  });

  describe('bulk', () => {
    it('applies an op per task with per-task results in one transaction', async () => {
      const db = testDb();
      const bulk = new TaskBulkService(db);
      const t1 = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'bulk 1',
          createdBy: ws.owner.id,
        })
      );
      const t2 = unwrap(
        await service.create({
          projectId: project.projectId,
          title: 'bulk 2',
          createdBy: ws.owner.id,
        })
      );
      const foreign = unwrap(
        await service.create({ projectId: other.projectId, title: 'bulk f', createdBy: null })
      );
      const missing = '00000000-0000-4000-8000-000000000000';

      const result = unwrap(
        await bulk.apply({
          taskIds: [t1.id, t2.id, foreign.id, missing],
          op: {
            stateId: project.states.progress,
            priority: 'urgent',
            addAssigneeIds: [ws.member.id],
            addLabelIds: [project.labelId],
          },
          actorId: ws.owner.id,
          allowedProjectIds: new Set([project.projectId]),
        })
      );
      expect(result.results.map((r) => r.status)).toEqual([
        'updated',
        'updated',
        'forbidden',
        'not_found',
      ]);
      expect(result.tasks).toHaveLength(2);
      for (const task of result.tasks) {
        expect(task.stateId).toBe(project.states.progress);
        expect(task.priority).toBe('urgent');
        expect(task.assignees.map((a) => a.id)).toEqual([ws.member.id]);
      }

      // A label from another project makes that task invalid; others still apply.
      const mixed = unwrap(
        await bulk.apply({
          taskIds: [t1.id],
          op: { addLabelIds: [other.labelId] },
          actorId: ws.owner.id,
          allowedProjectIds: new Set([project.projectId]),
        })
      );
      expect(mixed.results[0]).toMatchObject({ status: 'invalid', code: 'INVALID_LABEL' });

      const del = unwrap(
        await bulk.apply({
          taskIds: [t1.id, t2.id],
          op: { delete: true },
          actorId: ws.owner.id,
          allowedProjectIds: new Set([project.projectId]),
        })
      );
      expect(del.results.every((r) => r.status === 'updated')).toBe(true);
      const restore = unwrap(
        await bulk.apply({
          taskIds: [t1.id],
          op: { restore: true },
          actorId: ws.owner.id,
          allowedProjectIds: new Set([project.projectId]),
        })
      );
      expect(restore.results[0]?.status).toBe('updated');
      expect(unwrap(await service.getById(t1.id)).id).toBe(t1.id);
      void createUser;
    });
  });
});
