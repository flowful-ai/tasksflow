import { Hono } from 'hono';
import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import { getDatabase, githubInstallations } from '../db/index.js';
import { authMiddleware, getCurrentSession, getCurrentUser, getOptionalUser } from '../auth/index.js';
import { TaskService } from '../domain/index.js';
import { GitHubRepoRefSchema, LinkGitHubRepositorySchema, findLinkedRepository } from '@flowtask/shared';
import {
  GitHubSyncService,
  createGitHubClientForInstallation,
  createOAuthState,
  getProjectGitHubIntegration,
  getWebUrl,
  listInstallationRepositories,
  readSecretEnv,
  updateGitHubConfig,
  updateRepoSyncStatus,
} from '../integrations/index.js';
import { apiError, authorizeProjectIntegration } from '../services/integration-access.js';
import { GitHubInstallError, completeGitHubInstallation } from '../services/github-install-service.js';
import { slackRoutes } from './slack.js';

const github = new Hono();
const githubPublic = new Hono();
const db = getDatabase();
const taskService = new TaskService(db);

const InstallBodySchema = z.object({
  installationId: z.coerce.number().int().positive(),
  code: z.string().min(1),
  state: z.string().min(1),
});

async function userOwnsInstallation(userId: string, installationId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: githubInstallations.id })
    .from(githubInstallations)
    .where(and(eq(githubInstallations.userId, userId), eq(githubInstallations.installationId, installationId)));
  return Boolean(row);
}

async function readJsonBody(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function sessionIdOf(c: Parameters<typeof getCurrentSession>[0]): string | null {
  try {
    return getCurrentSession(c).id;
  } catch {
    return null;
  }
}

// List repositories of an installation the caller has verified access to.
github.get('/installations/:installationId/repos', async (c) => {
  const user = getCurrentUser(c);
  const installationId = Number(c.req.param('installationId'));
  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    return apiError(c, 400, 'INVALID_INSTALLATION', 'Invalid installation ID');
  }
  if (!(await userOwnsInstallation(user.id, installationId))) {
    return apiError(c, 403, 'FORBIDDEN', 'You do not have access to this GitHub installation');
  }

  try {
    const repositories = await listInstallationRepositories(installationId);
    return c.json({ success: true, data: { repositories } });
  } catch (error) {
    console.error('Error listing installation repos:', error);
    return apiError(c, 502, 'GITHUB_ERROR', 'Failed to list repositories');
  }
});

// The current user's verified GitHub App installations
github.get('/my-installations', async (c) => {
  const user = getCurrentUser(c);
  const installations = await db
    .select()
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, user.id));

  return c.json({
    success: true,
    data: {
      installations: installations.map((i) => ({
        installationId: i.installationId,
        accountLogin: i.accountLogin,
        accountType: i.accountType,
      })),
    },
  });
});

// GitHub integration for a project
github.get('/:projectId/github', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');
  const access = await authorizeProjectIntegration(projectId, user.id, 'project:read');
  if (!access.ok) return apiError(c, access.status, access.code, access.message);

  const integration = await getProjectGitHubIntegration(db, projectId);
  const [userInstallation] = await db
    .select({ id: githubInstallations.id })
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, user.id))
    .limit(1);
  const canManage = (await authorizeProjectIntegration(projectId, user.id, 'project:manage_integrations')).ok;
  const canLinkRepos = canManage && Boolean(userInstallation);

  if (!integration) {
    return c.json({
      success: true,
      data: { id: null, installationId: null, repositories: [], isEnabled: false, canLinkRepos, canManage },
    });
  }

  return c.json({
    success: true,
    data: {
      id: integration.id,
      installationId: integration.config.repositories[0]?.installationId ?? null,
      repositories: integration.config.repositories,
      isEnabled: integration.isEnabled,
      canLinkRepos,
      canManage,
    },
  });
});

// Start a GitHub App install: returns a single-use state nonce bound to this session.
github.post('/:projectId/github/install/start', async (c) => {
  const user = getCurrentUser(c);
  const sessionId = sessionIdOf(c);
  const projectId = c.req.param('projectId');
  const access = await authorizeProjectIntegration(projectId, user.id, 'project:manage_integrations');
  if (!access.ok) return apiError(c, access.status, access.code, access.message);
  if (!sessionId) return apiError(c, 401, 'UNAUTHORIZED', 'A browser session is required to install the GitHub App');

  const state = await createOAuthState(db, { provider: 'github', userId: user.id, sessionId, projectId });
  const slug = readSecretEnv('GITHUB_APP_SLUG');
  const installUrl = slug
    ? `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`
    : null;
  return c.json({ success: true, data: { state, installUrl } });
});

// Complete an install from the SPA (alternative to the server-side callback below).
// Requires the OAuth code and the state nonce; a bare installationId is never trusted.
github.post('/:projectId/github/install', async (c) => {
  const user = getCurrentUser(c);
  const sessionId = sessionIdOf(c);
  const projectId = c.req.param('projectId');
  const parsed = InstallBodySchema.safeParse(await readJsonBody(c));
  if (!parsed.success) {
    return apiError(c, 400, 'VERIFICATION_REQUIRED', 'installationId, code and state are required');
  }
  if (!sessionId) return apiError(c, 401, 'UNAUTHORIZED', 'Session required');

  try {
    const result = await completeGitHubInstallation({ ...parsed.data, userId: user.id, sessionId });
    if (result.projectId !== projectId) {
      return apiError(c, 400, 'INVALID_STATE', 'Install was started for a different project');
    }
    const integration = await getProjectGitHubIntegration(db, projectId);
    return c.json({
      success: true,
      data: {
        id: integration?.id ?? null,
        installationId: result.installationId,
        repositories: integration?.config.repositories ?? [],
        isEnabled: integration?.isEnabled ?? true,
      },
    });
  } catch (error) {
    if (error instanceof GitHubInstallError) return apiError(c, error.status, error.code, error.message);
    throw error;
  }
});

// Link a repository to a project
github.post('/:projectId/github/link', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');
  const access = await authorizeProjectIntegration(projectId, user.id, 'project:manage_integrations');
  if (!access.ok) return apiError(c, access.status, access.code, access.message);

  const parsed = LinkGitHubRepositorySchema.safeParse(await readJsonBody(c));
  if (!parsed.success) return apiError(c, 400, 'INVALID_BODY', 'installationId, owner and repo are required');
  const { installationId, owner, repo } = parsed.data;

  if (!(await userOwnsInstallation(user.id, installationId))) {
    return apiError(c, 403, 'FORBIDDEN', 'You do not have access to this GitHub installation');
  }

  // The installation must actually grant access to the repository.
  let canonical: { owner: string; repo: string };
  try {
    const client = await createGitHubClientForInstallation(installationId, { owner, repo });
    const repository = await client.getRepository();
    canonical = { owner: repository.owner.login, repo: repository.name };
  } catch {
    return apiError(c, 400, 'REPO_NOT_ACCESSIBLE', 'This installation cannot access that repository');
  }

  let alreadyLinked = false;
  const integration = await updateGitHubConfig(db, projectId, (config) => {
    if (findLinkedRepository(config, canonical.owner, canonical.repo)) {
      alreadyLinked = true;
      return config;
    }
    return {
      repositories: [
        ...config.repositories,
        {
          ...canonical,
          installationId,
          linkedAt: new Date().toISOString(),
          lastSyncAt: null,
          syncStatus: 'idle',
          syncError: null,
        },
      ],
    };
  });
  if (alreadyLinked) return apiError(c, 400, 'ALREADY_LINKED', 'Repository already linked');

  return c.json({
    success: true,
    data: {
      id: integration.id,
      installationId,
      repositories: integration.config.repositories,
      isEnabled: integration.isEnabled,
    },
  });
});

// Unlink a repository from a project
github.delete('/:projectId/github/link', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');
  const access = await authorizeProjectIntegration(projectId, user.id, 'project:manage_integrations');
  if (!access.ok) return apiError(c, access.status, access.code, access.message);

  const parsed = GitHubRepoRefSchema.safeParse({ owner: c.req.query('owner'), repo: c.req.query('repo') });
  if (!parsed.success) return apiError(c, 400, 'INVALID_QUERY', 'Missing owner or repo parameter');
  const { owner, repo } = parsed.data;

  const existing = await getProjectGitHubIntegration(db, projectId);
  if (!existing) return apiError(c, 404, 'NO_INTEGRATION', 'No GitHub integration found');

  await updateGitHubConfig(db, projectId, (config) => ({
    repositories: config.repositories.filter(
      (r) => !(r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase())
    ),
  }));
  return c.json({ success: true });
});

// Import open issues of a linked repository
github.post('/:projectId/github/sync', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');
  const access = await authorizeProjectIntegration(projectId, user.id, 'project:manage_integrations');
  if (!access.ok) return apiError(c, access.status, access.code, access.message);

  const parsed = GitHubRepoRefSchema.safeParse(await readJsonBody(c));
  if (!parsed.success) return apiError(c, 400, 'INVALID_BODY', 'Missing owner or repo');

  const integration = await getProjectGitHubIntegration(db, projectId, { enabledOnly: true });
  if (!integration) return apiError(c, 404, 'NO_INTEGRATION', 'No GitHub integration found');
  const linkedRepo = findLinkedRepository(integration.config, parsed.data.owner, parsed.data.repo);
  if (!linkedRepo) return apiError(c, 404, 'REPO_NOT_LINKED', 'Repository not linked');

  await updateRepoSyncStatus(db, projectId, linkedRepo.owner, linkedRepo.repo, { syncStatus: 'syncing', syncError: null });

  try {
    const syncService = new GitHubSyncService({ db, taskService });
    const result = await syncService.initialSync({
      integrationId: integration.id,
      projectId,
      workspaceId: access.workspaceId,
      repo: linkedRepo,
    });
    const firstError = result.errors[0] ?? null;
    await updateRepoSyncStatus(db, projectId, linkedRepo.owner, linkedRepo.repo, {
      syncStatus: firstError ? 'error' : 'synced',
      syncError: firstError,
      lastSyncAt: new Date().toISOString(),
    });
    return c.json({ success: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync failed';
    console.error(`[GitHub Sync] Failed for ${linkedRepo.owner}/${linkedRepo.repo}:`, error);
    await updateRepoSyncStatus(db, projectId, linkedRepo.owner, linkedRepo.repo, { syncStatus: 'error', syncError: message });
    return apiError(c, 502, 'SYNC_FAILED', message);
  }
});

// Slack project settings live in their own module; mounted here so they share
// this router's /api/projects mount.
github.route('/', slackRoutes);

/**
 * GitHub App setup/callback URL (public router; runs the session middleware itself).
 * With "Request user authorization (OAuth) during installation" enabled, GitHub
 * sends `code`, `installation_id`, `setup_action` and our `state` nonce. The
 * install is verified and stored here, then the user lands on project settings.
 */
githubPublic.get('/callback', authMiddleware, async (c) => {
  const webUrl = getWebUrl();
  const state = c.req.query('state') ?? '';
  const code = c.req.query('code');
  const installationId = Number(c.req.query('installation_id'));
  const setupAction = c.req.query('setup_action');

  const fail = (reason: string, projectId?: string) => {
    const target = projectId ? `${webUrl}/project/${projectId}/settings` : `${webUrl}/projects`;
    return c.redirect(`${target}?github_error=${encodeURIComponent(reason)}`);
  };

  const user = getOptionalUser(c);
  const sessionId = sessionIdOf(c);
  if (!user || !sessionId) return fail('not_signed_in');
  if (setupAction === 'request') return fail('installation_requested');
  if (!code || !state) return fail('authorization_required');
  if (!Number.isSafeInteger(installationId) || installationId <= 0) return fail('missing_installation');

  try {
    const result = await completeGitHubInstallation({ state, code, installationId, userId: user.id, sessionId });
    return c.redirect(
      `${webUrl}/project/${result.projectId}/settings?section=github&github_installation_id=${result.installationId}`
    );
  } catch (error) {
    if (error instanceof GitHubInstallError) {
      console.warn(JSON.stringify({ level: 'warn', msg: 'github_install_rejected', code: error.code, userId: user.id }));
      return fail(error.code.toLowerCase());
    }
    console.error('GitHub install callback failed:', error);
    return fail('internal_error');
  }
});

export { github as githubRoutes, githubPublic as githubPublicRoutes };
