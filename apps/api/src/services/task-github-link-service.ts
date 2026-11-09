import { and, eq } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { externalLinks, projects, tasks } from '../db/index.js';
import { REALTIME_EVENTS, formatGitHubExternalId } from '@flowtask/shared';
import {
  NonRetryableError,
  computeIssueSyncHash,
  createGitHubClientForInstallation,
  getGitHubTargetForProjectRepo,
  issueContentFrom,
  registerBackgroundJob,
  scheduleBackgroundJob,
  type GitHubRepoTarget,
  type PublishRealtimeEvent,
} from '../integrations/index.js';

export type TaskGitHubLinkErrorCode =
  | 'NO_INTEGRATION'
  | 'REPO_NOT_LINKED'
  | 'NO_INSTALLATION'
  | 'TASK_NOT_FOUND'
  | 'ALREADY_LINKED'
  | 'ISSUE_ALREADY_LINKED'
  | 'PR_ALREADY_LINKED'
  | 'GITHUB_ERROR';

export class TaskGitHubLinkError extends Error {
  constructor(
    public readonly code: TaskGitHubLinkErrorCode,
    message: string,
    public readonly status: 400 | 404 | 409 | 500 = 400
  ) {
    super(message);
    this.name = 'TaskGitHubLinkError';
  }
}

export interface TaskRepoInput {
  taskId: string;
  projectId: string;
  owner: string;
  repo: string;
}

export interface LinkTaskPullRequestInput extends TaskRepoInput {
  prNumber: number;
}

export interface LinkTaskIssueInput extends TaskRepoInput {
  issueNumber: number;
}

export interface TaskGitHubLinkResult {
  url: string;
  number: number;
}

/** @deprecated use TaskGitHubLinkResult */
export type LinkTaskPullRequestResult = TaskGitHubLinkResult;

function githubStatus(error: unknown): number | null {
  return error instanceof Error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : null;
}

/** Run a GitHub API call, mapping failures to TaskGitHubLinkError (4xx → 400, otherwise 500). */
async function callGitHub<T>(fallbackMessage: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    const status = githubStatus(error);
    throw new TaskGitHubLinkError(
      'GITHUB_ERROR',
      error instanceof Error ? error.message : fallbackMessage,
      status !== null && status >= 400 && status < 500 ? 400 : 500
    );
  }
}

/**
 * Task ↔ GitHub linking: link an existing issue, create an issue from a task,
 * link a pull request. Repo → installation resolution is exact (a repository
 * must be linked to the task's project; no fallback installation).
 */
const CREATE_ISSUE_JOB = 'github.create_issue_for_task';

export class TaskGitHubLinkService {
  constructor(
    private readonly db: Database,
    private readonly publish: PublishRealtimeEvent = () => {}
  ) {
    registerBackgroundJob(CREATE_ISSUE_JOB, async (payload) => {
      const { taskId, projectId, owner, repo } = payload;
      if (
        typeof taskId !== 'string' ||
        typeof projectId !== 'string' ||
        typeof owner !== 'string' ||
        typeof repo !== 'string'
      ) {
        throw new NonRetryableError('Job payload is missing the task or repository');
      }
      await this.runIssueCreation({ taskId, projectId, owner, repo });
    });
  }

  private async resolveTarget(input: TaskRepoInput): Promise<GitHubRepoTarget> {
    const target = await getGitHubTargetForProjectRepo(
      this.db,
      input.projectId,
      input.owner,
      input.repo
    );
    if (!target) {
      throw new TaskGitHubLinkError(
        'REPO_NOT_LINKED',
        'Repository is not linked to this project',
        400
      );
    }
    return target;
  }

  private async assertTaskInProject(
    taskId: string,
    projectId: string
  ): Promise<{ title: string; description: string | null }> {
    const [task] = await this.db
      .select({ title: tasks.title, description: tasks.description, projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.id, taskId));
    if (!task || task.projectId !== projectId) {
      throw new TaskGitHubLinkError('TASK_NOT_FOUND', 'Task not found in this project', 404);
    }
    return task;
  }

  private async taskIssueLinkExists(taskId: string): Promise<boolean> {
    const [existing] = await this.db
      .select({ id: externalLinks.id })
      .from(externalLinks)
      .where(and(eq(externalLinks.taskId, taskId), eq(externalLinks.externalType, 'github_issue')));
    return Boolean(existing);
  }

  private async publishTaskUpdated(taskId: string): Promise<void> {
    const [row] = await this.db
      .select({ workspaceId: projects.workspaceId, projectId: tasks.projectId })
      .from(tasks)
      .innerJoin(projects, eq(tasks.projectId, projects.id))
      .where(eq(tasks.id, taskId));
    if (row) {
      this.publish(row.workspaceId, REALTIME_EVENTS.TASK_UPDATED, {
        id: taskId,
        projectId: row.projectId,
      });
    }
  }

  /** Link an existing GitHub issue to a task. */
  async linkIssue(input: LinkTaskIssueInput): Promise<TaskGitHubLinkResult> {
    const target = await this.resolveTarget(input);
    await this.assertTaskInProject(input.taskId, input.projectId);
    if (await this.taskIssueLinkExists(input.taskId)) {
      throw new TaskGitHubLinkError(
        'ALREADY_LINKED',
        'Task already has a linked GitHub issue',
        400
      );
    }

    const issue = await callGitHub('Failed to fetch GitHub issue', async () => {
      const client = await createGitHubClientForInstallation(
        target.repo.installationId,
        target.repo
      );
      return client.getIssue(input.issueNumber);
    });
    if (issue.pull_request) {
      throw new TaskGitHubLinkError(
        'GITHUB_ERROR',
        'That number is a pull request, not an issue',
        400
      );
    }

    const [inserted] = await this.db
      .insert(externalLinks)
      .values({
        integrationId: target.integrationId,
        taskId: input.taskId,
        externalType: 'github_issue',
        externalId: formatGitHubExternalId(target.repo.owner, target.repo.repo, issue.number),
        externalUrl: issue.html_url,
        syncHash: computeIssueSyncHash(issueContentFrom(issue)),
        lastSyncedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [externalLinks.integrationId, externalLinks.externalType, externalLinks.externalId],
      })
      .returning({ id: externalLinks.id });
    if (!inserted) {
      throw new TaskGitHubLinkError(
        'ISSUE_ALREADY_LINKED',
        'This issue is already linked to another task',
        409
      );
    }

    await this.publishTaskUpdated(input.taskId);
    return { url: issue.html_url, number: issue.number };
  }

  /** Create a GitHub issue from a task and link it. */
  async createIssueForTask(input: TaskRepoInput): Promise<TaskGitHubLinkResult> {
    const target = await this.resolveTarget(input);
    const task = await this.assertTaskInProject(input.taskId, input.projectId);
    if (await this.taskIssueLinkExists(input.taskId)) {
      throw new TaskGitHubLinkError(
        'ALREADY_LINKED',
        'Task already has a linked GitHub issue',
        400
      );
    }

    const issue = await callGitHub('Failed to create GitHub issue', async () => {
      const client = await createGitHubClientForInstallation(
        target.repo.installationId,
        target.repo
      );
      return client.createIssue({ title: task.title, body: task.description ?? '' });
    });

    // The `opened` webhook for this issue is skipped (created by our app), so
    // this insert is the only writer; the hash makes later echoes no-ops.
    await this.db.insert(externalLinks).values({
      integrationId: target.integrationId,
      taskId: input.taskId,
      externalType: 'github_issue',
      externalId: formatGitHubExternalId(target.repo.owner, target.repo.repo, issue.number),
      externalUrl: issue.html_url,
      syncHash: computeIssueSyncHash(issueContentFrom(issue)),
      lastSyncedAt: new Date(),
    });

    await this.publishTaskUpdated(input.taskId);
    return { url: issue.html_url, number: issue.number };
  }

  /**
   * Background variant used right after task creation. Retries transient
   * failures; an already-linked task counts as done.
   */
  scheduleIssueCreation(input: TaskRepoInput): void {
    scheduleBackgroundJob(
      CREATE_ISSUE_JOB,
      { taskId: input.taskId, projectId: input.projectId, owner: input.owner, repo: input.repo },
      { context: { taskId: input.taskId, repo: `${input.owner}/${input.repo}` } }
    );
  }

  private async runIssueCreation(input: TaskRepoInput): Promise<void> {
    try {
      await this.createIssueForTask(input);
    } catch (error) {
      if (error instanceof TaskGitHubLinkError) {
        if (error.code === 'ALREADY_LINKED') return;
        if (error.status !== 500) throw new NonRetryableError(error.message, { cause: error });
      }
      throw error;
    }
  }

  /** Link an existing pull request to a task. */
  async linkPr(input: LinkTaskPullRequestInput): Promise<TaskGitHubLinkResult> {
    const target = await this.resolveTarget(input);
    await this.assertTaskInProject(input.taskId, input.projectId);
    const externalId = formatGitHubExternalId(target.repo.owner, target.repo.repo, input.prNumber);

    const [existingLink] = await this.db
      .select({ taskId: externalLinks.taskId })
      .from(externalLinks)
      .where(
        and(
          eq(externalLinks.integrationId, target.integrationId),
          eq(externalLinks.externalType, 'github_pr'),
          eq(externalLinks.externalId, externalId)
        )
      );
    if (existingLink) {
      if (existingLink.taskId === input.taskId) {
        throw new TaskGitHubLinkError(
          'ALREADY_LINKED',
          'Task already has this linked pull request',
          400
        );
      }
      throw new TaskGitHubLinkError(
        'PR_ALREADY_LINKED',
        'This pull request is already linked to another task',
        409
      );
    }

    const pullRequest = await callGitHub('Failed to fetch GitHub pull request', async () => {
      const client = await createGitHubClientForInstallation(
        target.repo.installationId,
        target.repo
      );
      return client.getPullRequest(input.prNumber);
    });

    const [inserted] = await this.db
      .insert(externalLinks)
      .values({
        integrationId: target.integrationId,
        taskId: input.taskId,
        externalType: 'github_pr',
        externalId,
        externalUrl: pullRequest.html_url,
        lastSyncedAt: new Date(),
      })
      .onConflictDoNothing({
        target: [externalLinks.integrationId, externalLinks.externalType, externalLinks.externalId],
      })
      .returning({ id: externalLinks.id });
    if (!inserted) {
      throw new TaskGitHubLinkError(
        'PR_ALREADY_LINKED',
        'This pull request is already linked to another task',
        409
      );
    }

    await this.publishTaskUpdated(input.taskId);
    return { url: pullRequest.html_url, number: pullRequest.number };
  }

  /** @deprecated alias of linkPr, kept for the agent tool runtime. */
  async linkPullRequestToTask(input: LinkTaskPullRequestInput): Promise<TaskGitHubLinkResult> {
    return this.linkPr(input);
  }
}
