import {
  GitHubOAuthTokenResponseSchema,
  GitHubUserInstallationsResponseSchema,
} from '@flowtask/shared';
import { readSecretEnv } from '../env.js';

/**
 * Proof that a user can access a GitHub App installation.
 *
 * The GitHub App must have "Request user authorization (OAuth) during
 * installation" enabled, so GitHub returns an OAuth `code` with the
 * installation callback. We exchange it for a user-to-server token and check
 * that the installation appears in `GET /user/installations` for that user.
 */

export type InstallationVerificationErrorCode =
  | 'NOT_CONFIGURED'
  | 'CODE_EXCHANGE_FAILED'
  | 'INSTALLATION_NOT_ACCESSIBLE'
  | 'GITHUB_ERROR';

export class InstallationVerificationError extends Error {
  constructor(
    public readonly code: InstallationVerificationErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'InstallationVerificationError';
  }
}

export interface VerifiedInstallation {
  installationId: number;
  accountLogin: string | null;
  accountType: string | null;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface VerifyInstallationParams {
  code: string;
  installationId: number;
  clientId?: string;
  clientSecret?: string;
  fetchImpl?: FetchLike;
}

const MAX_INSTALLATION_PAGES = 10;
const PER_PAGE = 100;

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

export async function exchangeGitHubOAuthCode(params: {
  code: string;
  clientId: string;
  clientSecret: string;
  fetchImpl: FetchLike;
}): Promise<string> {
  const response = await params.fetchImpl('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: params.clientId,
      client_secret: params.clientSecret,
      code: params.code,
    }),
  });
  const parsed = GitHubOAuthTokenResponseSchema.safeParse(await readJson(response));
  if (!response.ok || !parsed.success || !('access_token' in parsed.data)) {
    const detail =
      parsed.success && 'error' in parsed.data ? parsed.data.error : `HTTP ${response.status}`;
    throw new InstallationVerificationError(
      'CODE_EXCHANGE_FAILED',
      `GitHub OAuth code exchange failed (${detail})`
    );
  }
  return parsed.data.access_token;
}

/**
 * Exchange the OAuth code and confirm the user can access `installationId`.
 * Throws InstallationVerificationError when the proof fails.
 */
export async function verifyUserInstallation(
  params: VerifyInstallationParams
): Promise<VerifiedInstallation> {
  const clientId = params.clientId ?? readSecretEnv('GITHUB_APP_CLIENT_ID');
  const clientSecret = params.clientSecret ?? readSecretEnv('GITHUB_APP_CLIENT_SECRET');
  const fetchImpl = params.fetchImpl ?? fetch;
  if (!clientId || !clientSecret) {
    throw new InstallationVerificationError(
      'NOT_CONFIGURED',
      'GitHub App OAuth is not configured. Set GITHUB_APP_CLIENT_ID and GITHUB_APP_CLIENT_SECRET.'
    );
  }

  const token = await exchangeGitHubOAuthCode({
    code: params.code,
    clientId,
    clientSecret,
    fetchImpl,
  });

  for (let page = 1; page <= MAX_INSTALLATION_PAGES; page++) {
    const response = await fetchImpl(
      `https://api.github.com/user/installations?per_page=${PER_PAGE}&page=${page}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    const parsed = GitHubUserInstallationsResponseSchema.safeParse(await readJson(response));
    if (!response.ok || !parsed.success) {
      throw new InstallationVerificationError(
        'GITHUB_ERROR',
        `Failed to list user installations (HTTP ${response.status})`
      );
    }

    const match = parsed.data.installations.find((i) => i.id === params.installationId);
    if (match) {
      return {
        installationId: match.id,
        accountLogin: match.account?.login ?? null,
        accountType: match.account?.type ?? null,
      };
    }
    if (parsed.data.installations.length < PER_PAGE) break;
  }

  throw new InstallationVerificationError(
    'INSTALLATION_NOT_ACCESSIBLE',
    'This GitHub installation is not accessible to the authorizing GitHub user'
  );
}
