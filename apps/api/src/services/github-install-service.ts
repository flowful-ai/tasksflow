import { getDatabase, githubInstallations } from '../db/index.js';
import {
  InstallationVerificationError,
  consumeOAuthState,
  updateGitHubConfig,
  verifyUserInstallation,
  type FetchLike,
} from '../integrations/index.js';
import { authorizeProjectIntegration } from './integration-access.js';

const db = getDatabase();

export type GitHubInstallErrorCode =
  | 'INVALID_STATE'
  | 'SESSION_MISMATCH'
  | 'FORBIDDEN'
  | 'NOT_CONFIGURED'
  | 'VERIFICATION_FAILED';

export class GitHubInstallError extends Error {
  constructor(
    public readonly code: GitHubInstallErrorCode,
    message: string,
    public readonly status: 400 | 403 | 500 = 400
  ) {
    super(message);
    this.name = 'GitHubInstallError';
  }
}

function rethrowVerificationError(error: unknown): never {
  if (error instanceof InstallationVerificationError) {
    const notConfigured = error.code === 'NOT_CONFIGURED';
    throw new GitHubInstallError(notConfigured ? 'NOT_CONFIGURED' : 'VERIFICATION_FAILED', error.message, notConfigured ? 500 : 403);
  }
  throw error;
}

export interface CompleteInstallationInput {
  state: string;
  code: string;
  installationId: number;
  userId: string;
  sessionId: string;
  fetchImpl?: FetchLike;
}

/**
 * Finish a GitHub App install: the `state` nonce must belong to this user
 * session, and the OAuth `code` must prove the user can access the
 * installation. Only then is the installation stored for the user.
 */
export async function completeGitHubInstallation(input: CompleteInstallationInput): Promise<{ projectId: string; installationId: number }> {
  const binding = await consumeOAuthState(db, input.state, 'github');
  if (!binding) {
    throw new GitHubInstallError('INVALID_STATE', 'Install link expired or already used. Start again from project settings.');
  }
  if (binding.userId !== input.userId || binding.sessionId !== input.sessionId) {
    throw new GitHubInstallError('SESSION_MISMATCH', 'This install was started from a different session.', 403);
  }

  const access = await authorizeProjectIntegration(binding.projectId, input.userId, 'project:manage_integrations');
  if (!access.ok) {
    throw new GitHubInstallError('FORBIDDEN', access.message, 403);
  }

  const verified = await verifyUserInstallation({
    code: input.code,
    installationId: input.installationId,
    fetchImpl: input.fetchImpl,
  }).catch(rethrowVerificationError);

  await db
    .insert(githubInstallations)
    .values({
      userId: input.userId,
      installationId: verified.installationId,
      accountLogin: verified.accountLogin,
      accountType: verified.accountType,
    })
    .onConflictDoUpdate({
      target: [githubInstallations.userId, githubInstallations.installationId],
      set: { accountLogin: verified.accountLogin, accountType: verified.accountType },
    });

  // Make sure the project has a GitHub integration row to link repositories into.
  await updateGitHubConfig(db, binding.projectId, (config) => config);

  return { projectId: binding.projectId, installationId: verified.installationId };
}
