import { Hono } from 'hono';
import { getDatabase, projectIntegrations, projects, workspaceMembers, githubInstallations } from '@flowtask/database';
import { eq, and } from 'drizzle-orm';
import { getCurrentUser } from '@flowtask/auth';
import { GitHubSyncService, createGitHubClientForInstallation } from '@flowtask/integrations';
import { TaskService } from '@flowtask/domain';

const github = new Hono();
const githubPublic = new Hono();
const db = getDatabase();
const taskService = new TaskService(db);

interface LinkedRepository {
  owner: string;
  repo: string;
  installationId: number;
  linkedAt: string;
  lastSyncAt: string | null;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  syncError: string | null;
}

interface GitHubIntegrationConfig {
  installationId?: number; // Legacy top-level, kept for backward compat
  repositories?: LinkedRepository[];
}

// Helper to verify user has access to project
async function verifyProjectAccess(projectId: string, userId: string): Promise<boolean> {
  const [project] = await db
    .select({ workspaceId: projects.workspaceId })
    .from(projects)
    .where(eq(projects.id, projectId));

  if (!project) return false;

  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, project.workspaceId),
        eq(workspaceMembers.userId, userId)
      )
    );

  return !!member;
}

// List repositories from a GitHub App installation
github.get('/installations/:installationId/repos', async (c) => {
  // Auth handled by middleware
  const installationId = parseInt(c.req.param('installationId'), 10);

  if (isNaN(installationId)) {
    return c.json({ success: false, error: 'Invalid installation ID' }, 400);
  }

  try {
    const client = await createGitHubClientForInstallation(installationId, {
      owner: '',
      repo: '',
    });
    const octokit = client.getOctokit();
    const { data } = await octokit.apps.listReposAccessibleToInstallation({
      per_page: 100,
    });

    const repositories = data.repositories.map((repo: { id: number; owner: { login: string }; name: string; full_name: string; html_url: string }) => ({
      id: repo.id,
      owner: repo.owner.login,
      name: repo.name,
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
    }));

    return c.json({ success: true, data: { repositories } });
  } catch (error) {
    console.error('Error listing installation repos:', error);
    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Failed to list repositories',
    }, 500);
  }
});

// Get the current user's GitHub App installations
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

// Get GitHub integration for a project
github.get('/:projectId/github', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');

  // Verify access
  const hasAccess = await verifyProjectAccess(projectId, user.id);
  if (!hasAccess) {
    return c.json({ success: false, error: 'Access denied' }, 403);
  }

  // Find existing integration
  const [integration] = await db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.projectId, projectId),
        eq(projectIntegrations.integrationType, 'github')
      )
    );

  // Check if current user has any GitHub installations (can link repos)
  const [userInstallation] = await db
    .select({ id: githubInstallations.id })
    .from(githubInstallations)
    .where(eq(githubInstallations.userId, user.id))
    .limit(1);
  const canLinkRepos = !!userInstallation;

  if (!integration) {
    return c.json({
      success: true,
      data: {
        id: null,
        installationId: null,
        repositories: [],
        isEnabled: false,
        canLinkRepos,
      },
    });
  }

  const config = integration.config as GitHubIntegrationConfig;
  const repos = config.repositories || [];

  // Backward compat: return installationId from first repo or legacy top-level
  const installationId = repos[0]?.installationId ?? config.installationId ?? null;

  return c.json({
    success: true,
    data: {
      id: integration.id,
      installationId,
      repositories: repos,
      isEnabled: integration.isEnabled,
      canLinkRepos,
    },
  });
});

// Save installation ID for a project (called after GitHub App installation)
github.post('/:projectId/github/install', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');

  // Verify access
  const hasAccess = await verifyProjectAccess(projectId, user.id);
  if (!hasAccess) {
    return c.json({ success: false, error: 'Access denied' }, 403);
  }

  const body = await c.req.json() as { installationId: number };
  const { installationId } = body;

  if (!installationId) {
    return c.json({ success: false, error: 'Missing installationId' }, 400);
  }

  // Upsert into github_installations (user-level)
  let accountLogin: string | null = null;
  let accountType: string | null = null;
  try {
    const client = await createGitHubClientForInstallation(installationId, { owner: '', repo: '' });
    const octokit = client.getOctokit();
    const { data: installation } = await octokit.apps.getInstallation({ installation_id: installationId });
    const account = installation.account as { login?: string; type?: string } | null;
    accountLogin = account?.login ?? null;
    accountType = account?.type ?? null;
  } catch {
    // Non-critical: we can still save without account info
  }

  await db
    .insert(githubInstallations)
    .values({
      userId: user.id,
      installationId,
      accountLogin,
      accountType,
    })
    .onConflictDoUpdate({
      target: [githubInstallations.userId, githubInstallations.installationId],
      set: { accountLogin, accountType },
    });

  // Also ensure project_integrations row exists (without top-level installationId)
  const [existingIntegration] = await db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.projectId, projectId),
        eq(projectIntegrations.integrationType, 'github')
      )
    );

  if (existingIntegration) {
    const config = existingIntegration.config as GitHubIntegrationConfig;
    return c.json({
      success: true,
      data: {
        id: existingIntegration.id,
        installationId,
        repositories: config.repositories || [],
        isEnabled: existingIntegration.isEnabled,
      },
    });
  }

  // Create new integration (no top-level installationId)
  const [newIntegration] = await db
    .insert(projectIntegrations)
    .values({
      projectId,
      integrationType: 'github',
      config: { repositories: [] },
      isEnabled: true,
    })
    .returning();

  if (!newIntegration) {
    return c.json({ success: false, error: 'Failed to create integration' }, 500);
  }

  return c.json({
    success: true,
    data: {
      id: newIntegration.id,
      installationId,
      repositories: [],
      isEnabled: true,
    },
  });
});

// Link a repository to a project
github.post('/:projectId/github/link', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');

  // Verify access
  const hasAccess = await verifyProjectAccess(projectId, user.id);
  if (!hasAccess) {
    return c.json({ success: false, error: 'Access denied' }, 403);
  }

  const body = await c.req.json() as { installationId: number; owner: string; repo: string };
  const { installationId, owner, repo } = body;

  if (!installationId || !owner || !repo) {
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  // Verify the current user owns this installation
  const [userInstallation] = await db
    .select()
    .from(githubInstallations)
    .where(
      and(
        eq(githubInstallations.userId, user.id),
        eq(githubInstallations.installationId, installationId)
      )
    );

  if (!userInstallation) {
    return c.json({ success: false, error: 'You do not own this GitHub installation' }, 403);
  }

  // Check if integration exists
  const [existingIntegration] = await db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.projectId, projectId),
        eq(projectIntegrations.integrationType, 'github')
      )
    );

  const newRepo: LinkedRepository = {
    owner,
    repo,
    installationId,
    linkedAt: new Date().toISOString(),
    lastSyncAt: null,
    syncStatus: 'idle',
    syncError: null,
  };

  if (existingIntegration) {
    // Update existing integration
    const config = existingIntegration.config as GitHubIntegrationConfig;
    const repositories = config.repositories || [];

    // Check if already linked
    const isAlreadyLinked = repositories.some((r) => r.owner === owner && r.repo === repo);
    if (isAlreadyLinked) {
      return c.json({ success: false, error: 'Repository already linked' }, 400);
    }

    repositories.push(newRepo);

    await db
      .update(projectIntegrations)
      .set({
        config: { repositories },
        updatedAt: new Date(),
      })
      .where(eq(projectIntegrations.id, existingIntegration.id));

    return c.json({
      success: true,
      data: {
        id: existingIntegration.id,
        installationId,
        repositories,
        isEnabled: true,
      },
    });
  }

  // Create new integration
  const [newIntegration] = await db
    .insert(projectIntegrations)
    .values({
      projectId,
      integrationType: 'github',
      config: { repositories: [newRepo] },
      isEnabled: true,
    })
    .returning();

  if (!newIntegration) {
    return c.json({ success: false, error: 'Failed to create integration' }, 500);
  }

  return c.json({
    success: true,
    data: {
      id: newIntegration.id,
      installationId,
      repositories: [newRepo],
      isEnabled: true,
    },
  });
});

// Unlink a repository from a project
github.delete('/:projectId/github/link', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');

  // Verify access
  const hasAccess = await verifyProjectAccess(projectId, user.id);
  if (!hasAccess) {
    return c.json({ success: false, error: 'Access denied' }, 403);
  }

  if (!owner || !repo) {
    return c.json({ success: false, error: 'Missing owner or repo parameter' }, 400);
  }

  // Find existing integration
  const [integration] = await db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.projectId, projectId),
        eq(projectIntegrations.integrationType, 'github')
      )
    );

  if (!integration) {
    return c.json({ success: false, error: 'No GitHub integration found' }, 404);
  }

  const config = integration.config as GitHubIntegrationConfig;
  const repositories = (config.repositories || []).filter(
    (r) => !(r.owner === owner && r.repo === repo)
  );

  await db
    .update(projectIntegrations)
    .set({
      config: { ...config, repositories },
      updatedAt: new Date(),
    })
    .where(eq(projectIntegrations.id, integration.id));

  return c.json({ success: true });
});

// Trigger a sync for a linked repository
github.post('/:projectId/github/sync', async (c) => {
  const user = getCurrentUser(c);
  const projectId = c.req.param('projectId');

  // Verify access
  const hasAccess = await verifyProjectAccess(projectId, user.id);
  if (!hasAccess) {
    return c.json({ success: false, error: 'Access denied' }, 403);
  }

  const body = await c.req.json() as { owner: string; repo: string };
  const { owner, repo } = body;

  if (!owner || !repo) {
    return c.json({ success: false, error: 'Missing owner or repo' }, 400);
  }

  // Find integration
  const [integration] = await db
    .select()
    .from(projectIntegrations)
    .where(
      and(
        eq(projectIntegrations.projectId, projectId),
        eq(projectIntegrations.integrationType, 'github')
      )
    );

  if (!integration) {
    return c.json({ success: false, error: 'No GitHub integration found' }, 404);
  }

  const config = integration.config as GitHubIntegrationConfig;

  const linkedRepo = config.repositories?.find((r) => r.owner === owner && r.repo === repo);
  if (!linkedRepo) {
    return c.json({ success: false, error: 'Repository not linked' }, 404);
  }

  // Get installationId from the repo entry (or fall back to legacy top-level)
  const repoInstallationId = linkedRepo.installationId ?? config.installationId;
  if (!repoInstallationId) {
    return c.json({ success: false, error: 'GitHub App not installed' }, 400);
  }

  // Update status to syncing
  const updatedRepos = config.repositories?.map((r) =>
    r.owner === owner && r.repo === repo ? { ...r, syncStatus: 'syncing' as const, syncError: null } : r
  );

  await db
    .update(projectIntegrations)
    .set({
      config: { ...config, repositories: updatedRepos },
      syncStatus: 'syncing',
      updatedAt: new Date(),
    })
    .where(eq(projectIntegrations.id, integration.id));

  // Perform sync
  try {
    console.log(`[GitHub Sync] Starting sync for ${owner}/${repo} (project: ${projectId})`);
    const syncService = new GitHubSyncService(db, taskService);
    const result = await syncService.initialSync(integration.id, projectId, {
      installationId: repoInstallationId,
      owner,
      repo,
    });
    console.log(`[GitHub Sync] Completed for ${owner}/${repo}: ${result.created} created, ${result.updated} updated, ${result.errors.length} errors`);

    // Update status based on result
    const finalRepos = config.repositories?.map((r) =>
      r.owner === owner && r.repo === repo
        ? {
            ...r,
            syncStatus: result.errors.length > 0 ? ('error' as const) : ('synced' as const),
            syncError: result.errors.length > 0 ? result.errors[0] : null,
            lastSyncAt: new Date().toISOString(),
          }
        : r
    );

    await db
      .update(projectIntegrations)
      .set({
        config: { ...config, repositories: finalRepos },
        syncStatus: result.errors.length > 0 ? 'error' : 'synced',
        lastSyncAt: new Date(),
        syncError: result.errors.length > 0 ? result.errors[0] : null,
        updatedAt: new Date(),
      })
      .where(eq(projectIntegrations.id, integration.id));

    return c.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error(`[GitHub Sync] Failed for ${owner}/${repo}:`, error);

    // Update status to error
    const errorRepos = config.repositories?.map((r) =>
      r.owner === owner && r.repo === repo
        ? { ...r, syncStatus: 'error' as const, syncError: error instanceof Error ? error.message : 'Unknown error' }
        : r
    );

    await db
      .update(projectIntegrations)
      .set({
        config: { ...config, repositories: errorRepos },
        syncStatus: 'error',
        syncError: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: new Date(),
      })
      .where(eq(projectIntegrations.id, integration.id));

    return c.json({
      success: false,
      error: error instanceof Error ? error.message : 'Sync failed',
    }, 500);
  }
});

// GitHub App installation callback (when OAuth during installation is enabled)
// This handles the redirect from GitHub after app installation
// GitHub sends: code, installation_id, setup_action, and state (which contains our return URL)
// This is on the PUBLIC router - no auth required
githubPublic.get('/callback', async (c) => {
  const installationId = c.req.query('installation_id');
  const setupAction = c.req.query('setup_action');
  const state = c.req.query('state'); // Contains the return URL we passed

  const webUrl = process.env.WEB_URL || 'http://localhost:3000';

  // Build redirect URL to frontend callback handler
  const params = new URLSearchParams();
  if (installationId) params.set('installation_id', installationId);
  if (setupAction) params.set('setup_action', setupAction);
  if (state) params.set('state', state);

  const redirectUrl = `${webUrl}/github/callback?${params.toString()}`;
  return c.redirect(redirectUrl);
});

export { github as githubRoutes, githubPublic as githubPublicRoutes };
