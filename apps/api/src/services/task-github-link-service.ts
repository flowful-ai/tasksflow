import { and, eq } from 'drizzle-orm';
import type { Database } from '@flowtask/database';
import { externalLinks, projectIntegrations } from '@flowtask/database';
import { createGitHubClientForInstallation } from '@flowtask/integrations';

interface GitHubLinkedRepositoryConfig {
  owner: string;
  repo: string;
  installationId?: number;
}

interface GitHubIntegrationConfig {
  owner?: string;
  repo?: string;
  installationId?: number;
  repositories?: GitHubLinkedRepositoryConfig[];
}

export interface LinkTaskPullRequestInput {
  taskId: string;
  projectId: string;
  owner: string;
  repo: string;
  prNumber: number;
}

export interface LinkTaskPullRequestResult {
  url: string;
  number: number;
}

export class TaskGitHubLinkError extends Error {
  constructor(
    public readonly code:
      | 'NO_INTEGRATION'
      | 'REPO_NOT_LINKED'
      | 'NO_INSTALLATION'
      | 'ALREADY_LINKED'
      | 'PR_ALREADY_LINKED'
      | 'GITHUB_ERROR',
    message: string,
    public readonly status: 400 | 404 | 409 | 500 = 400
  ) {
    super(message);
    this.name = 'TaskGitHubLinkError';
  }
}

function resolveLinkedRepoConfig(
  config: GitHubIntegrationConfig,
  owner: string,
  repo: string
): GitHubLinkedRepositoryConfig | null {
  const normalizedOwner = owner.toLowerCase();
  const normalizedRepo = repo.toLowerCase();

  const linkedRepo = config.repositories?.find(
    (entry) =>
      entry.owner.toLowerCase() === normalizedOwner &&
      entry.repo.toLowerCase() === normalizedRepo
  );
  if (linkedRepo) {
    return linkedRepo;
  }

  if (
    config.owner &&
    config.repo &&
    config.owner.toLowerCase() === normalizedOwner &&
    config.repo.toLowerCase() === normalizedRepo
  ) {
    return {
      owner: config.owner,
      repo: config.repo,
      installationId: config.installationId,
    };
  }

  return null;
}

export class TaskGitHubLinkService {
  constructor(private readonly db: Database) {}

  async linkPullRequestToTask(input: LinkTaskPullRequestInput): Promise<LinkTaskPullRequestResult> {
    const [integration] = await this.db
      .select()
      .from(projectIntegrations)
      .where(
        and(
          eq(projectIntegrations.projectId, input.projectId),
          eq(projectIntegrations.integrationType, 'github'),
          eq(projectIntegrations.isEnabled, true)
        )
      );

    if (!integration) {
      throw new TaskGitHubLinkError(
        'NO_INTEGRATION',
        'GitHub not configured for this project',
        400
      );
    }

    const integrationConfig = integration.config as GitHubIntegrationConfig;
    const linkedRepo = resolveLinkedRepoConfig(integrationConfig, input.owner, input.repo);
    if (!linkedRepo) {
      throw new TaskGitHubLinkError(
        'REPO_NOT_LINKED',
        'Repository is not linked to this project',
        400
      );
    }

    const installationId = linkedRepo.installationId ?? integrationConfig.installationId;
    if (!installationId) {
      throw new TaskGitHubLinkError(
        'NO_INSTALLATION',
        'GitHub App not installed for this repository',
        400
      );
    }

    const externalId = input.prNumber.toString();
    const [existingLink] = await this.db
      .select({
        id: externalLinks.id,
        taskId: externalLinks.taskId,
      })
      .from(externalLinks)
      .where(
        and(
          eq(externalLinks.integrationId, integration.id),
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

    let pullRequest: { html_url: string; number: number };
    try {
      const client = await createGitHubClientForInstallation(installationId, {
        owner: linkedRepo.owner,
        repo: linkedRepo.repo,
      });
      pullRequest = await client.getPullRequest(input.prNumber);
    } catch (error) {
      throw new TaskGitHubLinkError(
        'GITHUB_ERROR',
        error instanceof Error ? error.message : 'Failed to fetch GitHub pull request',
        500
      );
    }

    await this.db.insert(externalLinks).values({
      integrationId: integration.id,
      taskId: input.taskId,
      externalType: 'github_pr',
      externalId,
      externalUrl: pullRequest.html_url,
      lastSyncedAt: new Date(),
    });

    return {
      url: pullRequest.html_url,
      number: pullRequest.number,
    };
  }
}
