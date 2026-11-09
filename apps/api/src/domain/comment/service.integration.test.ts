/**
 * CommentService against a real database. Skipped unless TEST_DATABASE_URL is set.
 */
import { afterAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { err, type Result } from '@flowtask/shared';
import { comments } from '../../db/index.js';
import { domainEvents } from '../events/bus.js';
import type { DomainEventMap } from '../events/types.js';
import { TaskService } from '../task/service.js';
import {
  TEST_DATABASE_URL,
  createProject,
  createWorkspace,
  testDb,
  unwrap,
} from '../task/test-fixtures.js';
import { CommentService } from './service.js';
import type { CommentWithUser } from './types.js';

/** A service whose post-commit lookups fail, as they would on a dropped connection. */
class FlakyLookupCommentService extends CommentService {
  override async getById(): Promise<Result<CommentWithUser, Error>> {
    return err(new Error('connection lost'));
  }
}

describe.skipIf(!TEST_DATABASE_URL)('CommentService (integration)', () => {
  afterAll(async () => {
    await domainEvents.idle();
  });

  it('returns the committed comment and emits comment.created without post-commit lookups', async () => {
    const db = testDb();
    const ws = await createWorkspace(db);
    const project = await createProject(db, ws.workspaceId);
    const task = unwrap(
      await new TaskService(db).create({
        projectId: project.projectId,
        title: 'Commented',
        createdBy: ws.owner.id,
      })
    );

    const seen: DomainEventMap['comment.created'][] = [];
    const off = domainEvents.on('comment.created', (event) => {
      if (event.taskId === task.id) seen.push(event);
    });
    const result = await new FlakyLookupCommentService(db).create({
      taskId: task.id,
      userId: ws.owner.id,
      content: 'hello',
    });
    await domainEvents.idle();
    off();

    const created = unwrap(result);
    expect(created.content).toBe('hello');
    expect(created.user?.id).toBe(ws.owner.id);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.projectId).toBe(project.projectId);
    expect(seen[0]?.workspaceId).toBe(ws.workspaceId);
    expect(seen[0]?.comment.id).toBe(created.id);
    const rows = await db
      .select({ id: comments.id })
      .from(comments)
      .where(eq(comments.taskId, task.id));
    expect(rows).toHaveLength(1);
  });
});
