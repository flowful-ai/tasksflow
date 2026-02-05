import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
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

  // ============ Write Methods (for two-way sync) ============

  /**
   * Update an issue's title, body, and/or state.
   */
  async updateIssue(issueNumber: number, updates: {
    title?: string;
    body?: string;
    state?: 'open' | 'closed';
  }) {
    const { data } = await this.octokit.issues.update({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      ...updates,
    });
    return data;
  }

  /**
   * Set labels on an issue, replacing existing labels.
   */
  async setIssueLabels(issueNumber: number, labels: string[]) {
    const { data } = await this.octokit.issues.setLabels({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      labels,
    });
    return data;
  }

  /**
   * Add labels to an issue without removing existing ones.
   */
  async addIssueLabels(issueNumber: number, labels: string[]) {
    const { data } = await this.octokit.issues.addLabels({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      labels,
    });
    return data;
  }

  /**
   * Remove a label from an issue.
   */
  async removeIssueLabel(issueNumber: number, label: string) {
    const { data } = await this.octokit.issues.removeLabel({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      name: label,
    });
    return data;
  }

  /**
   * Set assignees on an issue, replacing existing assignees.
   */
  async setIssueAssignees(issueNumber: number, assignees: string[]) {
    const { data } = await this.octokit.issues.update({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      assignees,
    });
    return data;
  }

  /**
   * Add assignees to an issue.
   */
  async addIssueAssignees(issueNumber: number, assignees: string[]) {
    const { data } = await this.octokit.issues.addAssignees({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      assignees,
    });
    return data;
  }

  /**
   * Remove assignees from an issue.
   */
  async removeIssueAssignees(issueNumber: number, assignees: string[]) {
    const { data } = await this.octokit.issues.removeAssignees({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      assignees,
    });
    return data;
  }

  /**
   * Create a new issue.
   */
  async createIssue(options: {
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
  }) {
    const { data } = await this.octokit.issues.create({
      owner: this.config.owner,
      repo: this.config.repo,
      ...options,
    });
    return data;
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
    console.error('[GitHub Client] Missing GitHub token. Set GITHUB_TOKEN or GITHUB_ACCESS_TOKEN environment variable.');
    throw new Error('GitHub token not configured');
  }

  const octokit = new Octokit({
    auth: token,
  });

  return new GitHubClient(octokit, config);
}

/**
 * Decode a private key that may be base64-encoded.
 * Supports both raw PEM format and base64-encoded keys.
 * Base64 encoding is useful for deployments where .env parsers
 * don't handle multi-line values well (e.g., Dokploy).
 */
function decodePrivateKey(key: string): string {
  // If it starts with '-----BEGIN', it's already in PEM format
  if (key.startsWith('-----BEGIN')) {
    return key;
  }

  // Try to decode as base64
  try {
    const decoded = Buffer.from(key, 'base64').toString('utf-8');
    if (decoded.startsWith('-----BEGIN')) {
      return decoded;
    }
  } catch {
    // Not valid base64, return as-is
  }

  // Return as-is if neither format matches
  return key;
}

/**
 * Create a GitHub client with installation authentication.
 * This is used for GitHub App installations.
 */
export async function createGitHubClientForInstallation(
  installationId: number,
  config: Omit<GitHubConfig, 'installationId'>
): Promise<GitHubClient> {
  const appId = process.env.GITHUB_APP_ID;
  const privateKeyRaw = process.env.GITHUB_APP_PRIVATE_KEY;

  if (!appId || !privateKeyRaw) {
    console.error('[GitHub Client] Missing GitHub App credentials. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY environment variables.');
    throw new Error('GitHub App credentials not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY env vars.');
  }

  // Decode the private key (supports both raw PEM and base64-encoded)
  const privateKey = decodePrivateKey(privateKeyRaw);

  // Use GitHub App installation authentication
  const octokit = new Octokit({
    authStrategy: createAppAuth,
    auth: {
      appId: parseInt(appId, 10),
      privateKey,
      installationId,
    },
  });

  return new GitHubClient(octokit, { ...config, installationId });
}
