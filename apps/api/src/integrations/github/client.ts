import { Octokit } from '@octokit/rest';
import { createAppAuth } from '@octokit/auth-app';
import type { GitHubRepoRef } from '../types.js';
import { readSecretEnv } from '../env.js';

/**
 * GitHub API client scoped to one repository.
 * Uses GitHub App installation authentication.
 */
export class GitHubClient {
  constructor(
    private readonly octokit: Octokit,
    private readonly repoRef: GitHubRepoRef
  ) {}

  private get base(): { owner: string; repo: string } {
    return { owner: this.repoRef.owner, repo: this.repoRef.repo };
  }

  async getRepository() {
    const { data } = await this.octokit.repos.get(this.base);
    return data;
  }

  async listIssues(options?: {
    state?: 'open' | 'closed' | 'all';
    per_page?: number;
    page?: number;
  }) {
    const { data } = await this.octokit.issues.listForRepo({
      ...this.base,
      state: options?.state ?? 'open',
      per_page: options?.per_page ?? 30,
      page: options?.page ?? 1,
    });
    return data;
  }

  async getIssue(issueNumber: number) {
    const { data } = await this.octokit.issues.get({ ...this.base, issue_number: issueNumber });
    return data;
  }

  async listPullRequests(options?: {
    state?: 'open' | 'closed' | 'all';
    per_page?: number;
    page?: number;
  }) {
    const { data } = await this.octokit.pulls.list({
      ...this.base,
      state: options?.state ?? 'open',
      per_page: options?.per_page ?? 30,
      page: options?.page ?? 1,
    });
    return data;
  }

  async getPullRequest(prNumber: number) {
    const { data } = await this.octokit.pulls.get({ ...this.base, pull_number: prNumber });
    return data;
  }

  async listIssueComments(issueNumber: number) {
    const { data } = await this.octokit.issues.listComments({
      ...this.base,
      issue_number: issueNumber,
    });
    return data;
  }

  async addIssueComment(issueNumber: number, body: string) {
    const { data } = await this.octokit.issues.createComment({
      ...this.base,
      issue_number: issueNumber,
      body,
    });
    return data;
  }

  async listLabels() {
    const { data } = await this.octokit.issues.listLabelsForRepo(this.base);
    return data;
  }

  getOctokit(): Octokit {
    return this.octokit;
  }

  // ============ Write Methods (two-way sync) ============

  async updateIssue(
    issueNumber: number,
    updates: { title?: string; body?: string; state?: 'open' | 'closed' }
  ) {
    const { data } = await this.octokit.issues.update({
      ...this.base,
      issue_number: issueNumber,
      ...updates,
    });
    return data;
  }

  async setIssueLabels(issueNumber: number, labels: string[]) {
    const { data } = await this.octokit.issues.setLabels({
      ...this.base,
      issue_number: issueNumber,
      labels,
    });
    return data;
  }

  async createIssue(options: {
    title: string;
    body?: string;
    labels?: string[];
    assignees?: string[];
  }) {
    const { data } = await this.octokit.issues.create({ ...this.base, ...options });
    return data;
  }
}

/**
 * Decode a private key that may be base64-encoded.
 * Supports raw PEM and base64-encoded PEM (for .env parsers that mangle newlines).
 */
function decodePrivateKey(key: string): string {
  if (key.startsWith('-----BEGIN')) {
    return key.replace(/\\n/g, '\n');
  }
  const decoded = Buffer.from(key, 'base64').toString('utf-8');
  return decoded.startsWith('-----BEGIN') ? decoded : key;
}

export interface GitHubAppCredentials {
  appId: number;
  privateKey: string;
}

export function getGitHubAppCredentials(): GitHubAppCredentials {
  const appId = Number(readSecretEnv('GITHUB_APP_ID'));
  const privateKeyRaw = readSecretEnv('GITHUB_APP_PRIVATE_KEY');
  if (!Number.isSafeInteger(appId) || appId <= 0 || !privateKeyRaw) {
    throw new Error(
      'GitHub App credentials not configured. Set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY.'
    );
  }
  return { appId, privateKey: decodePrivateKey(privateKeyRaw) };
}

/** The configured GitHub App id, or null when GitHub isn't configured. */
export function getGitHubAppId(): number | null {
  const appId = Number(readSecretEnv('GITHUB_APP_ID'));
  return Number.isSafeInteger(appId) && appId > 0 ? appId : null;
}

/** Octokit authenticated as a GitHub App installation. */
export function createInstallationOctokit(installationId: number): Octokit {
  const { appId, privateKey } = getGitHubAppCredentials();
  return new Octokit({
    authStrategy: createAppAuth,
    auth: { appId, privateKey, installationId },
  });
}

/**
 * Create a repository-scoped client with installation authentication.
 */
export async function createGitHubClientForInstallation(
  installationId: number,
  repoRef: GitHubRepoRef
): Promise<GitHubClient> {
  return new GitHubClient(createInstallationOctokit(installationId), repoRef);
}

export interface InstallationRepository {
  id: number;
  owner: string;
  name: string;
  fullName: string;
  htmlUrl: string;
}

/** List repositories an installation can access (first 100). */
export async function listInstallationRepositories(
  installationId: number
): Promise<InstallationRepository[]> {
  const octokit = createInstallationOctokit(installationId);
  const { data } = await octokit.apps.listReposAccessibleToInstallation({ per_page: 100 });
  return data.repositories.map((repo) => ({
    id: repo.id,
    owner: repo.owner.login,
    name: repo.name,
    fullName: repo.full_name,
    htmlUrl: repo.html_url,
  }));
}
