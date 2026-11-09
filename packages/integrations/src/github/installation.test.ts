import { describe, expect, test } from 'bun:test';
import {
  InstallationVerificationError,
  verifyUserInstallation,
  type FetchLike,
  type InstallationVerificationErrorCode,
} from './installation.js';

interface Recorded {
  url: string;
  init?: RequestInit;
}

function json(body: object, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

/** Fake GitHub: token exchange + paginated /user/installations. */
function fakeGitHub(options: {
  token?: string | null;
  installationPages?: Array<Array<{ id: number; account?: { login: string; type: string } }>>;
  installationsStatus?: number;
}): { fetchImpl: FetchLike; calls: Recorded[] } {
  const calls: Recorded[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    if (url === 'https://github.com/login/oauth/access_token') {
      return options.token
        ? json({ access_token: options.token, token_type: 'bearer' })
        : json({ error: 'bad_verification_code', error_description: 'The code is incorrect' });
    }
    if (url.startsWith('https://api.github.com/user/installations')) {
      if (options.installationsStatus && options.installationsStatus !== 200) {
        return json({ message: 'Bad credentials' }, options.installationsStatus);
      }
      const page = Number(new URL(url).searchParams.get('page') ?? '1');
      const installations = options.installationPages?.[page - 1] ?? [];
      return json({ total_count: installations.length, installations });
    }
    return json({ message: 'not found' }, 404);
  };
  return { fetchImpl, calls };
}

const creds = { clientId: 'Iv1.client', clientSecret: 'secret' };

async function expectCode(promise: Promise<unknown>, code: InstallationVerificationErrorCode): Promise<void> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(InstallationVerificationError);
    if (error instanceof InstallationVerificationError) expect(error.code).toBe(code);
    return;
  }
  throw new Error(`expected InstallationVerificationError ${code}`);
}

describe('verifyUserInstallation', () => {
  test('accepts an installation listed for the authorizing user', async () => {
    const { fetchImpl, calls } = fakeGitHub({
      token: 'ghu_user',
      installationPages: [[{ id: 5, account: { login: 'someone', type: 'User' } }, { id: 77, account: { login: 'acme', type: 'Organization' } }]],
    });

    const result = await verifyUserInstallation({ code: 'abc', installationId: 77, fetchImpl, ...creds });

    expect(result).toEqual({ installationId: 77, accountLogin: 'acme', accountType: 'Organization' });
    const exchange = calls[0];
    expect(exchange?.url).toBe('https://github.com/login/oauth/access_token');
    expect(JSON.parse(String(exchange?.init?.body))).toEqual({ client_id: 'Iv1.client', client_secret: 'secret', code: 'abc' });
    const headers = new Headers(calls[1]?.init?.headers);
    expect(headers.get('Authorization')).toBe('Bearer ghu_user');
  });

  test('rejects an installation the user cannot access (claiming someone else\'s id)', async () => {
    const { fetchImpl } = fakeGitHub({ token: 'ghu_user', installationPages: [[{ id: 5 }]] });
    await expectCode(verifyUserInstallation({ code: 'abc', installationId: 999, fetchImpl, ...creds }), 'INSTALLATION_NOT_ACCESSIBLE');
  });

  test('follows pagination', async () => {
    const firstPage = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const { fetchImpl, calls } = fakeGitHub({ token: 't', installationPages: [firstPage, [{ id: 500 }]] });
    const result = await verifyUserInstallation({ code: 'abc', installationId: 500, fetchImpl, ...creds });
    expect(result.installationId).toBe(500);
    expect(calls.filter((c) => c.url.includes('/user/installations'))).toHaveLength(2);
  });

  test('rejects an invalid OAuth code', async () => {
    const { fetchImpl } = fakeGitHub({ token: null });
    await expectCode(verifyUserInstallation({ code: 'bad', installationId: 1, fetchImpl, ...creds }), 'CODE_EXCHANGE_FAILED');
  });

  test('surfaces GitHub API failures', async () => {
    const { fetchImpl } = fakeGitHub({ token: 't', installationsStatus: 401 });
    await expectCode(verifyUserInstallation({ code: 'abc', installationId: 1, fetchImpl, ...creds }), 'GITHUB_ERROR');
  });

  test('requires the GitHub App OAuth credentials', async () => {
    const { fetchImpl } = fakeGitHub({ token: 't' });
    const saved = { id: process.env.GITHUB_APP_CLIENT_ID, secret: process.env.GITHUB_APP_CLIENT_SECRET };
    delete process.env.GITHUB_APP_CLIENT_ID;
    delete process.env.GITHUB_APP_CLIENT_SECRET;
    try {
      await expectCode(verifyUserInstallation({ code: 'abc', installationId: 1, fetchImpl }), 'NOT_CONFIGURED');
    } finally {
      if (saved.id !== undefined) process.env.GITHUB_APP_CLIENT_ID = saved.id;
      if (saved.secret !== undefined) process.env.GITHUB_APP_CLIENT_SECRET = saved.secret;
    }
  });
});
