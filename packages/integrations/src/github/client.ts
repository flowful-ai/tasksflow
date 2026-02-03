import { Octokit } from '@octokit/rest';
import type { GitHubConfig } from '../types.js';

/**
 * GitHub API client wrapper.
 * Uses GitHub Apps authentication for accessing repository data.
 */
export class GitHubClient {
  private octokit: Octokit;
  private config: GitHubConfig;

  constructor(octokit: Octokit, config: GitHubConfig) {
    this.octokit = octokit;
    this.config = config;
  }

  /**
   * Get repository information.
   */
  async getRepository() {
    const { data } = await this.octokit.repos.get({
      owner: this.config.owner,
      repo: this.config.repo,
    });
    return data;
  }

  /**
   * List issues in the repository.
   */
  async listIssues(options?: { state?: 'open' | 'closed' | 'all'; per_page?: number; page?: number }) {
    const { data } = await this.octokit.issues.listForRepo({
      owner: this.config.owner,
      repo: this.config.repo,
      state: options?.state || 'open',
      per_page: options?.per_page || 30,
      page: options?.page || 1,
    });
    return data;
  }

  /**
   * Get a specific issue.
   */
  async getIssue(issueNumber: number) {
    const { data } = await this.octokit.issues.get({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
    });
    return data;
  }

  /**
   * List pull requests in the repository.
   */
  async listPullRequests(options?: { state?: 'open' | 'closed' | 'all'; per_page?: number; page?: number }) {
    const { data } = await this.octokit.pulls.list({
      owner: this.config.owner,
      repo: this.config.repo,
      state: options?.state || 'open',
      per_page: options?.per_page || 30,
      page: options?.page || 1,
    });
    return data;
  }

  /**
   * Get a specific pull request.
   */
  async getPullRequest(prNumber: number) {
    const { data } = await this.octokit.pulls.get({
      owner: this.config.owner,
      repo: this.config.repo,
      pull_number: prNumber,
    });
    return data;
  }

  /**
   * List comments on an issue.
   */
  async listIssueComments(issueNumber: number) {
    const { data } = await this.octokit.issues.listComments({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
    });
    return data;
  }

  /**
   * Add a comment to an issue.
   */
  async addIssueComment(issueNumber: number, body: string) {
    const { data } = await this.octokit.issues.createComment({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      body,
    });
    return data;
  }

  /**
   * Get labels for the repository.
   */
  async listLabels() {
    const { data } = await this.octokit.issues.listLabelsForRepo({
      owner: this.config.owner,
      repo: this.config.repo,
    });
    return data;
  }

  /**
   * Get commits that reference a task ID (e.g., FLOW-123).
   */
  async findCommitsByTaskId(taskIdentifier: string) {
    const { data } = await this.octokit.search.commits({
      q: `repo:${this.config.owner}/${this.config.repo} ${taskIdentifier}`,
    });
    return data.items;
  }

  /**
   * Get the Octokit instance for advanced operations.
   */
  getOctokit(): Octokit {
    return this.octokit;
  }
}

/**
 * Create a GitHub client with app authentication.
 */
export async function createGitHubClient(config: GitHubConfig): Promise<GitHubClient> {
  // In production, this would use GitHub App authentication
  // For now, we'll use a personal access token from environment
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN;

  if (!token) {
    throw new Error('GitHub token not configured');
  }

  const octokit = new Octokit({
    auth: token,
  });

  return new GitHubClient(octokit, config);
}

/**
 * Create a GitHub client with installation authentication.
 * This is used for GitHub App installations.
 */
export async function createGitHubClientForInstallation(
  installationId: number,
  config: Omit<GitHubConfig, 'installationId'>
): Promise<GitHubClient> {
  // In production, this would use GitHub App installation authentication
  // using the app's private key to generate an installation access token

  const appId = process.env.GITHUB_APP_ID;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKey) {
    throw new Error('GitHub App credentials not configured');
  }

  // For now, fall back to token auth
  // In production: use createAppAuth from @octokit/auth-app
  const token = process.env.GITHUB_TOKEN || process.env.GITHUB_ACCESS_TOKEN;

  if (!token) {
    throw new Error('GitHub token not configured');
  }

  const octokit = new Octokit({
    auth: token,
  });

  return new GitHubClient(octokit, { ...config, installationId });
}
