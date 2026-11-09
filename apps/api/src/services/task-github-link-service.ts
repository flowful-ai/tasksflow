import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db/index.js';
import { externalLinks, tasks } from '../db/index.js';
import { formatGitHubExternalId } from '@flowtask/shared';
import { TaskService, isTaskError } from '../domain/index.js';
import {
  NonRetryableError,
  computeIssueSyncHash,
  createGitHubClientForInstallation,
  getGitHubTargetForProjectRepo,
  issueContentFrom,
  registerBackgroundJob,
  scheduleBackgroundJob,
  type GitHubClient,
  type GitHubRepoTarget,
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
  /** User recorded in the task history (null for background work). */
  actorId?: string | null;
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

interface NewLink {
  target: GitHubRepoTarget;
  taskId: string;
  externalType: 'github_issue' | 'github_pr';
  number: number;
  url: string;
  syncHash?: string;
  actorId: string | null;
}

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

/** The GitHub calls linking makes (GitHubClient implements it; tests pass a fake). */
export type TaskGitHubLinkClient = Pick<
  GitHubClient,
  'getIssue' | 'createIssue' | 'getPullRequest'
>;

export type TaskGitHubLinkClientFactory = (
  installationId: number,
  repo: { owner: string; repo: string }
) => Promise<TaskGitHubLinkClient>;

export class TaskGitHubLinkService {
  private readonly tasks: TaskService;
  private readonly createClient: TaskGitHubLinkClientFactory;

  constructor(
    private readonly db: Database,
    options: { createClient?: TaskGitHubLinkClientFactory } = {}
  ) {
    this.tasks = new TaskService(db);
    this.createClient = options.createClient ?? createGitHubClientForInstallation;
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

  /** The live (not trashed) task in this project; checked before any GitHub call. */
  private async assertTaskInProject(
    taskId: string,
    projectId: string
  ): Promise<{ title: string; description: string | null }> {
    const [task] = await this.db
      .select({ title: tasks.title, description: tasks.description, projectId: tasks.projectId })
      .from(tasks)
      .where(and(eq(tasks.id, taskId), isNull(tasks.deletedAt)));
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
      const client = await this.createClient(target.repo.installationId, target.repo);
      return client.getIssue(input.issueNumber);
    });
    if (issue.pull_request) {
      throw new TaskGitHubLinkError(
        'GITHUB_ERROR',
        'That number is a pull request, not an issue',
        400
      );
    }

    await this.insertLink({
      target,
      taskId: input.taskId,
      actorId: input.actorId ?? null,
      externalType: 'github_issue',
      number: issue.number,
      url: issue.html_url,
      syncHash: computeIssueSyncHash(issueContentFrom(issue)),
    });
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
      const client = await this.createClient(target.repo.installationId, target.repo);
      return client.createIssue({ title: task.title, body: task.description ?? '' });
    });

    // The `opened` webhook for this issue is skipped (created by our app), so
    // this insert is the only writer; the hash makes later echoes no-ops.
    try {
      await this.insertLink({
        target,
        taskId: input.taskId,
        actorId: input.actorId ?? null,
        externalType: 'github_issue',
        number: issue.number,
        url: issue.html_url,
        syncHash: computeIssueSyncHash(issueContentFrom(issue)),
      });
    } catch (error) {
      // The task was trashed between the check above and the link: the issue
      // stays on GitHub unlinked. Say so, since a retry cannot fix it.
      if (error instanceof TaskGitHubLinkError && error.code === 'TASK_NOT_FOUND') {
        console.warn(
          JSON.stringify({
            level: 'warn',
            msg: 'github_issue_created_for_missing_task',
            taskId: input.taskId,
            issueUrl: issue.html_url,
          })
        );
      }
      throw error;
    }
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

  /**
   * A missing or trashed task (TASK_NOT_FOUND, checked before GitHub is
   * called) and other 4xx outcomes are not retried: a retry would open
   * another issue that cannot be linked.
   */
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
      const client = await this.createClient(target.repo.installationId, target.repo);
      return client.getPullRequest(input.prNumber);
    });

    await this.insertLink({
      target,
      taskId: input.taskId,
      actorId: input.actorId ?? null,
      externalType: 'github_pr',
      number: input.prNumber,
      url: pullRequest.html_url,
    });
    return { url: pullRequest.html_url, number: pullRequest.number };
  }

  /**
   * Insert the task ↔ issue/PR link and publish the task update. A link that
   * already exists for another task is a 409.
   */
  private async insertLink(link: NewLink): Promise<void> {
    const result = await this.tasks.linkExternal({
      taskId: link.taskId,
      integrationId: link.target.integrationId,
      externalType: link.externalType,
      externalId: formatGitHubExternalId(
        link.target.repo.owner,
        link.target.repo.repo,
        link.number
      ),
      externalUrl: link.url,
      syncHash: link.syncHash ?? null,
      actorId: link.actorId,
    });
    if (!result.ok) {
      // linkExternal locks the live task: a trashed or deleted one is TASK_NOT_FOUND.
      if (isTaskError(result.error) && result.error.code === 'TASK_NOT_FOUND') {
        throw new TaskGitHubLinkError('TASK_NOT_FOUND', 'Task not found in this project', 404);
      }
      throw result.error;
    }
    if (!result.value.linked) {
      throw link.externalType === 'github_pr'
        ? new TaskGitHubLinkError(
            'PR_ALREADY_LINKED',
            'This pull request is already linked to another task',
            409
          )
        : new TaskGitHubLinkError(
            'ISSUE_ALREADY_LINKED',
            'This issue is already linked to another task',
            409
          );
    }
  }
}
