import { Hono } from 'hono';
import { getDatabase, projectIntegrations, projects, workspaceMembers } from '@flowtask/database';
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
  linkedAt: string;
  lastSyncAt: string | null;
  syncStatus: 'idle' | 'syncing' | 'synced' | 'error';
  syncError: string | null;
}

interface GitHubIntegrationConfig {
  installationId?: number;
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

  if (!integration) {
    return c.json({
      success: true,
      data: {
        id: null,
        installationId: null,
        repositories: [],
        isEnabled: false,
      },
    });
  }

  const config = integration.config as GitHubIntegrationConfig;

  return c.json({
    success: true,
    data: {
      id: integration.id,
      installationId: config.installationId || null,
      repositories: config.repositories || [],
      isEnabled: integration.isEnabled,
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

  if (existingIntegration) {
    // Update existing integration with new installationId
    const config = existingIntegration.config as GitHubIntegrationConfig;
    await db
      .update(projectIntegrations)
      .set({
        config: { ...config, installationId },
        isEnabled: true,
        updatedAt: new Date(),
      })
      .where(eq(projectIntegrations.id, existingIntegration.id));

    return c.json({
      success: true,
      data: {
        id: existingIntegration.id,
        installationId,
        repositories: config.repositories || [],
        isEnabled: true,
      },
    });
  }

  // Create new integration with just the installationId
  const [newIntegration] = await db
    .insert(projectIntegrations)
    .values({
      projectId,
      integrationType: 'github',
      config: { installationId, repositories: [] },
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
        config: { installationId, repositories },
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
      config: { installationId, repositories: [newRepo] },
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

  if (!config.installationId) {
    return c.json({ success: false, error: 'GitHub App not installed' }, 400);
  }

  const linkedRepo = config.repositories?.find((r) => r.owner === owner && r.repo === repo);
  if (!linkedRepo) {
    return c.json({ success: false, error: 'Repository not linked' }, 404);
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
    const syncService = new GitHubSyncService(db, taskService);
    const result = await syncService.initialSync(integration.id, projectId, {
      installationId: config.installationId,
      owner,
      repo,
    });

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
