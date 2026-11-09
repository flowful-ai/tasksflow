/**
 * TaskGitHubLinkService against a real database with a fake GitHub client.
 * Skipped unless TEST_DATABASE_URL is set.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { eq } from 'drizzle-orm';
import { externalLinks, projectIntegrations, tasks } from '../db/index.js';
import { domainEvents, TaskService } from '../domain/index.js';
import {
  TEST_DATABASE_URL,
  createProject,
  createWorkspace,
  testDb,
  unwrap,
  type ProjectFixture,
  type WorkspaceFixture,
} from '../domain/task/test-fixtures.js';
import { NonRetryableError, getBackgroundJobRunners } from '../integrations/index.js';
import {
  TaskGitHubLinkError,
  TaskGitHubLinkService,
  type TaskGitHubLinkClient,
} from './task-github-link-service.js';

describe.skipIf(!TEST_DATABASE_URL)('TaskGitHubLinkService (integration)', () => {
  const owner = `link-${crypto.randomUUID().slice(0, 8)}`;
  let ws: WorkspaceFixture;
  let project: ProjectFixture;
  let service: TaskGitHubLinkService;
  let tasksService: TaskService;
  let githubCalls = 0;

  const fakeClient: TaskGitHubLinkClient = {
    createIssue: async () => {
      githubCalls += 1;
      throw new Error('GitHub must not be called for this task');
    },
    getIssue: async () => {
      githubCalls += 1;
      throw new Error('GitHub must not be called for this task');
    },
    getPullRequest: async () => {
      githubCalls += 1;
      throw new Error('GitHub must not be called for this task');
    },
  };

  beforeAll(async () => {
    const db = testDb();
    ws = await createWorkspace(db);
    project = await createProject(db, ws.workspaceId);
    await db.insert(projectIntegrations).values({
      projectId: project.projectId,
      integrationType: 'github',
      config: { repositories: [{ owner, repo: 'api', installationId: 7 }] },
    });
    service = new TaskGitHubLinkService(db, { createClient: async () => fakeClient });
    tasksService = new TaskService(db);
  });

  afterAll(async () => {
    await domainEvents.idle();
  });

  async function trashedTask(): Promise<string> {
    const task = unwrap(
      await tasksService.create({
        projectId: project.projectId,
        title: 'Trashed',
        createdBy: ws.owner.id,
      })
    );
    unwrap(await tasksService.delete(task.id, ws.owner.id));
    return task.id;
  }

  it('does not create a GitHub issue for a trashed task', async () => {
    const taskId = await trashedTask();
    githubCalls = 0;
    const error = await service
      .createIssueForTask({ taskId, projectId: project.projectId, owner, repo: 'api' })
      .then(
        () => null,
        (e: Error) => e
      );
    expect(error).toBeInstanceOf(TaskGitHubLinkError);
    expect(error instanceof TaskGitHubLinkError ? error.code : null).toBe('TASK_NOT_FOUND');
    expect(githubCalls).toBe(0);
  });

  it('fails the background issue creation for a trashed task without retrying', async () => {
    const taskId = await trashedTask();
    githubCalls = 0;
    const run = getBackgroundJobRunners().get('github.create_issue_for_task');
    expect(run).toBeDefined();
    const error = await run?.({ taskId, projectId: project.projectId, owner, repo: 'api' }).then(
      () => null,
      (e: Error) => e
    );
    expect(error).toBeInstanceOf(NonRetryableError);
    expect(githubCalls).toBe(0);
  });

  it('does not link a pull request to a trashed task', async () => {
    const taskId = await trashedTask();
    githubCalls = 0;
    const error = await service
      .linkPr({ taskId, projectId: project.projectId, owner, repo: 'api', prNumber: 3 })
      .then(
        () => null,
        (e: Error) => e
      );
    expect(error instanceof TaskGitHubLinkError ? error.code : null).toBe('TASK_NOT_FOUND');
    expect(githubCalls).toBe(0);
    const links = await testDb()
      .select({ id: externalLinks.id })
      .from(externalLinks)
      .where(eq(externalLinks.taskId, taskId));
    expect(links).toEqual([]);
    const [row] = await testDb()
      .select({ deletedAt: tasks.deletedAt })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    expect(row?.deletedAt).not.toBeNull();
  });
});
