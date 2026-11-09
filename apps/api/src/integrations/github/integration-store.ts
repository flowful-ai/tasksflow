import type { Database } from '../../db/index.js';
import { projectIntegrations, projects } from '../../db/index.js';
import {
  findLinkedRepository,
  parseGitHubConfig,
  type GitHubConfig,
  type GitHubLinkedRepository,
} from '@flowtask/shared';
import { and, eq, sql } from 'drizzle-orm';

/** A project integration resolved for one linked repository. */
export interface GitHubRepoTarget {
  integrationId: string;
  projectId: string;
  workspaceId: string;
  repo: GitHubLinkedRepository;
}

export interface ProjectGitHubIntegration {
  id: string;
  projectId: string;
  isEnabled: boolean;
  config: GitHubConfig;
}

/**
 * Find every enabled GitHub integration that links owner/repo, with a JSONB
 * query instead of loading and filtering all integrations in memory.
 */
export async function findGitHubTargetsForRepo(
  db: Database,
  owner: string,
  repo: string
): Promise<GitHubRepoTarget[]> {
  const ownerLc = owner.toLowerCase();
  const repoLc = repo.toLowerCase();
  const rows = await db
    .select({
      integrationId: projectIntegrations.id,
      projectId: projectIntegrations.projectId,
      workspaceId: projects.workspaceId,
      config: projectIntegrations.config,
    })
    .from(projectIntegrations)
    .innerJoin(projects, eq(projectIntegrations.projectId, projects.id))
    .where(
      and(
        eq(projectIntegrations.integrationType, 'github'),
        eq(projectIntegrations.isEnabled, true),
        sql`(
          EXISTS (
            SELECT 1
            FROM jsonb_array_elements(
              CASE WHEN jsonb_typeof(${projectIntegrations.config}->'repositories') = 'array'
                THEN ${projectIntegrations.config}->'repositories'
                ELSE '[]'::jsonb
              END
            ) AS r
            WHERE lower(r->>'owner') = ${ownerLc} AND lower(r->>'repo') = ${repoLc}
          )
          OR (
            lower(${projectIntegrations.config}->>'owner') = ${ownerLc}
            AND lower(${projectIntegrations.config}->>'repo') = ${repoLc}
          )
        )`
      )
    );

  const targets: GitHubRepoTarget[] = [];
  for (const row of rows) {
    const linked = findLinkedRepository(parseGitHubConfig(row.config), owner, repo);
    if (linked) {
      targets.push({
        integrationId: row.integrationId,
        projectId: row.projectId,
        workspaceId: row.workspaceId,
        repo: linked,
      });
    }
  }
  return targets;
}

export async function getProjectGitHubIntegration(
  db: Database,
  projectId: string,
  options: { enabledOnly?: boolean } = {}
): Promise<ProjectGitHubIntegration | null> {
  const conditions = [
    eq(projectIntegrations.projectId, projectId),
    eq(projectIntegrations.integrationType, 'github'),
  ];
  if (options.enabledOnly) conditions.push(eq(projectIntegrations.isEnabled, true));
  const [row] = await db
    .select()
    .from(projectIntegrations)
    .where(and(...conditions));
  if (!row) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    isEnabled: row.isEnabled,
    config: parseGitHubConfig(row.config),
  };
}

/** Resolve a repo target for a project, or null when the repo isn't linked to it. */
export async function getGitHubTargetForProjectRepo(
  db: Database,
  projectId: string,
  owner: string,
  repo: string
): Promise<GitHubRepoTarget | null> {
  const [row] = await db
    .select({
      integrationId: projectIntegrations.id,
      workspaceId: projects.workspaceId,
      config: projectIntegrations.config,
    })
    .from(projectIntegrations)
    .innerJoin(projects, eq(projectIntegrations.projectId, projects.id))
    .where(
      and(
        eq(projectIntegrations.projectId, projectId),
        eq(projectIntegrations.integrationType, 'github'),
        eq(projectIntegrations.isEnabled, true)
      )
    );
  if (!row) return null;
  const linked = findLinkedRepository(parseGitHubConfig(row.config), owner, repo);
  return linked
    ? { integrationId: row.integrationId, projectId, workspaceId: row.workspaceId, repo: linked }
    : null;
}

/**
 * Read-modify-write the GitHub config under a row lock, so concurrent edits
 * (link, unlink, sync status) don't drop each other's changes.
 * Creates the integration row when missing.
 */
export async function updateGitHubConfig(
  db: Database,
  projectId: string,
  mutate: (config: GitHubConfig) => GitHubConfig,
  extra: {
    syncStatus?: 'idle' | 'syncing' | 'synced' | 'error';
    syncError?: string | null;
    lastSyncAt?: Date;
  } = {}
): Promise<ProjectGitHubIntegration> {
  return db.transaction(async (tx) => {
    await tx
      .insert(projectIntegrations)
      .values({
        projectId,
        integrationType: 'github',
        config: { repositories: [] },
        isEnabled: true,
      })
      .onConflictDoNothing({
        target: [projectIntegrations.projectId, projectIntegrations.integrationType],
      });

    const [row] = await tx
      .select()
      .from(projectIntegrations)
      .where(
        and(
          eq(projectIntegrations.projectId, projectId),
          eq(projectIntegrations.integrationType, 'github')
        )
      )
      .for('update');
    if (!row) {
      throw new Error('GitHub integration row missing after upsert');
    }

    const next = mutate(parseGitHubConfig(row.config));
    await tx
      .update(projectIntegrations)
      .set({
        config: { repositories: next.repositories },
        updatedAt: new Date(),
        ...(extra.syncStatus !== undefined ? { syncStatus: extra.syncStatus } : {}),
        ...(extra.syncError !== undefined ? { syncError: extra.syncError } : {}),
        ...(extra.lastSyncAt !== undefined ? { lastSyncAt: extra.lastSyncAt } : {}),
      })
      .where(eq(projectIntegrations.id, row.id));

    return { id: row.id, projectId, isEnabled: row.isEnabled, config: next };
  });
}

/** Patch one linked repository's sync status fields. */
export async function updateRepoSyncStatus(
  db: Database,
  projectId: string,
  owner: string,
  repo: string,
  patch: Pick<GitHubLinkedRepository, 'syncStatus' | 'syncError' | 'lastSyncAt'>
): Promise<void> {
  await updateGitHubConfig(
    db,
    projectId,
    (config) => ({
      repositories: config.repositories.map((r) =>
        r.owner.toLowerCase() === owner.toLowerCase() && r.repo.toLowerCase() === repo.toLowerCase()
          ? { ...r, ...patch }
          : r
      ),
    }),
    {
      syncStatus: patch.syncStatus,
      syncError: patch.syncError ?? null,
      ...(patch.syncStatus === 'synced' ? { lastSyncAt: new Date() } : {}),
    }
  );
}
