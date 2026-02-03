import { eq, and, desc, asc, lte, SQL } from 'drizzle-orm';
import type { Database } from '@flowtask/database';
import { workspaceAgents, workspaces, projects } from '@flowtask/database';
import type { Result, ApiTokenPermission } from '@flowtask/shared';
import { ok, err, API_TOKEN_PREFIX, TOKEN_PREFIX_LENGTH, TOKEN_REGEX } from '@flowtask/shared';
import type { Redis } from 'ioredis';
import { RateLimitService } from '../rate-limit/service.js';
import type {
  WorkspaceAgentWithWorkspace,
  WorkspaceAgentCreateInput,
  WorkspaceAgentUpdateInput,
  WorkspaceAgentListOptions,
  TokenGenerationResult,
  VerifiedAgent,
  TokenVerifyOptions,
} from './types.js';

// Per-minute rate limit for API tokens
const REQUESTS_PER_MINUTE = 60;

/**
 * Generate a secure API token.
 * Format: ft_v1_<44 base64url chars> (33 bytes = 264 bits of entropy)
 */
function generateSecureToken(): TokenGenerationResult {
  const randomBytes = crypto.getRandomValues(new Uint8Array(33));
  const base64 = btoa(String.fromCharCode(...randomBytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');

  const token = `${API_TOKEN_PREFIX}${base64}`;
  const tokenPrefix = base64.slice(0, TOKEN_PREFIX_LENGTH);

  return {
    token,
    tokenHash: '', // Will be set after hashing
    tokenPrefix,
  };
}

/**
 * Extract the 12-char prefix from a token (after ft_v1_).
 */
function getTokenPrefix(token: string): string {
  return token.slice(API_TOKEN_PREFIX.length, API_TOKEN_PREFIX.length + TOKEN_PREFIX_LENGTH);
}

/**
 * Validate token format.
 */
function isValidTokenFormat(token: string): boolean {
  return TOKEN_REGEX.test(token);
}

export class WorkspaceAgentService {
  private rateLimitService: RateLimitService | null = null;

  constructor(
    private db: Database,
    redis?: Redis
  ) {
    if (redis) {
      this.rateLimitService = new RateLimitService(redis);
    }
  }

  /**
   * Create a new workspace agent.
   * Returns the token ONCE - it cannot be retrieved again.
   */
  async create(input: WorkspaceAgentCreateInput): Promise<Result<WorkspaceAgentWithWorkspace & { token: string }, Error>> {
    try {
      // Generate token
      const { token, tokenPrefix } = generateSecureToken();

      // Hash the token using Bun's built-in bcrypt
      const tokenHash = await Bun.password.hash(token, {
        algorithm: 'bcrypt',
        cost: 12,
      });

      // Insert into database
      const [agent] = await this.db
        .insert(workspaceAgents)
        .values({
          workspaceId: input.workspaceId,
          restrictedProjectIds: input.restrictedProjectIds && input.restrictedProjectIds.length > 0
            ? input.restrictedProjectIds
            : null,
          name: input.name,
          description: input.description || null,
          tokenHash,
          tokenPrefix,
          permissions: input.permissions,
          tokensPerDay: input.tokensPerDay || 100000,
          expiresAt: input.expiresAt || null,
          createdBy: input.createdBy,
        })
        .returning();

      if (!agent) {
        return err(new Error('Failed to create workspace agent'));
      }

      // Fetch with workspace info
      const result = await this.getById(agent.id);
      if (!result.ok) {
        return result;
      }

      // Return with the raw token (only time it's visible)
      return ok({
        ...result.value,
        token,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get a workspace agent by ID.
   */
  async getById(agentId: string): Promise<Result<WorkspaceAgentWithWorkspace, Error>> {
    try {
      const result = await this.db
        .select({
          agent: workspaceAgents,
          workspace: {
            id: workspaces.id,
            name: workspaces.name,
            slug: workspaces.slug,
          },
        })
        .from(workspaceAgents)
        .leftJoin(workspaces, eq(workspaceAgents.workspaceId, workspaces.id))
        .where(eq(workspaceAgents.id, agentId));

      if (!result.length || !result[0]) {
        return err(new Error('Workspace agent not found'));
      }

      const { agent, workspace } = result[0];

      return ok({
        ...agent,
        workspace: workspace || undefined,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Update a workspace agent.
   */
  async update(agentId: string, input: WorkspaceAgentUpdateInput): Promise<Result<WorkspaceAgentWithWorkspace, Error>> {
    try {
      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.permissions !== undefined) updateData.permissions = input.permissions;
      if (input.tokensPerDay !== undefined) updateData.tokensPerDay = input.tokensPerDay;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;
      if (input.expiresAt !== undefined) updateData.expiresAt = input.expiresAt;

      // Handle restrictedProjectIds update (null means all projects)
      if (input.restrictedProjectIds !== undefined) {
        updateData.restrictedProjectIds = input.restrictedProjectIds && input.restrictedProjectIds.length > 0
          ? input.restrictedProjectIds
          : null;
      }

      const [updated] = await this.db
        .update(workspaceAgents)
        .set(updateData)
        .where(eq(workspaceAgents.id, agentId))
        .returning();

      if (!updated) {
        return err(new Error('Workspace agent not found'));
      }

      return this.getById(agentId);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Delete (revoke) a workspace agent.
   */
  async delete(agentId: string): Promise<Result<void, Error>> {
    try {
      const result = await this.db
        .delete(workspaceAgents)
        .where(eq(workspaceAgents.id, agentId))
        .returning({ id: workspaceAgents.id });

      if (!result.length) {
        return err(new Error('Workspace agent not found'));
      }

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Regenerate a workspace agent's token (creates new secret, keeps settings).
   * Returns the new token ONCE.
   */
  async regenerate(agentId: string): Promise<Result<WorkspaceAgentWithWorkspace & { token: string }, Error>> {
    try {
      // Generate new token
      const { token, tokenPrefix } = generateSecureToken();

      // Hash the new token
      const tokenHash = await Bun.password.hash(token, {
        algorithm: 'bcrypt',
        cost: 12,
      });

      // Update the agent
      const [updated] = await this.db
        .update(workspaceAgents)
        .set({
          tokenHash,
          tokenPrefix,
          lastUsedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(workspaceAgents.id, agentId))
        .returning();

      if (!updated) {
        return err(new Error('Workspace agent not found'));
      }

      // Clear any failed attempts for old prefix
      if (this.rateLimitService) {
        await this.rateLimitService.clearFailedAttempts(updated.tokenPrefix);
      }

      // Fetch with workspace info
      const result = await this.getById(agentId);
      if (!result.ok) {
        return result;
      }

      return ok({
        ...result.value,
        token,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * List workspace agents for a workspace.
   */
  async list(options: WorkspaceAgentListOptions = {}): Promise<Result<{ agents: WorkspaceAgentWithWorkspace[]; total: number }, Error>> {
    try {
      const { filters = {}, sortBy = 'created_at', sortOrder = 'desc', limit = 50, offset = 0 } = options;

      // Build where conditions
      const conditions: SQL[] = [];

      if (filters.workspaceId) {
        conditions.push(eq(workspaceAgents.workspaceId, filters.workspaceId));
      }

      if (filters.isActive !== undefined) {
        conditions.push(eq(workspaceAgents.isActive, filters.isActive));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Build sort clause
      const sortColumn = {
        name: workspaceAgents.name,
        created_at: workspaceAgents.createdAt,
        last_used_at: workspaceAgents.lastUsedAt,
      }[sortBy];

      const orderFn = sortOrder === 'desc' ? desc : asc;

      // Get agents with workspace info
      const results = await this.db
        .select({
          agent: workspaceAgents,
          workspace: {
            id: workspaces.id,
            name: workspaces.name,
            slug: workspaces.slug,
          },
        })
        .from(workspaceAgents)
        .leftJoin(workspaces, eq(workspaceAgents.workspaceId, workspaces.id))
        .where(whereClause)
        .orderBy(orderFn(sortColumn!))
        .limit(limit)
        .offset(offset);

      // Get total count
      const countResult = await this.db
        .select({ count: workspaceAgents.id })
        .from(workspaceAgents)
        .where(whereClause);

      const agents: WorkspaceAgentWithWorkspace[] = results.map(({ agent, workspace }) => ({
        ...agent,
        workspace: workspace || undefined,
      }));

      return ok({
        agents,
        total: countResult.length,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Verify an API token and return its details if valid.
   * Uses constant-time comparison and checks all candidates to prevent timing attacks.
   */
  async verifyToken(
    token: string,
    options: TokenVerifyOptions = {}
  ): Promise<
    Result<
      VerifiedAgent,
      { code: 'INVALID_FORMAT' | 'TOKEN_NOT_FOUND' | 'TOKEN_EXPIRED' | 'TOKEN_INACTIVE' | 'RATE_LIMITED' | 'LOCKED_OUT' | 'PERMISSION_DENIED'; message: string }
    >
  > {
    // Validate format first
    if (!isValidTokenFormat(token)) {
      return err({ code: 'INVALID_FORMAT', message: 'Invalid token format' });
    }

    const tokenPrefix = getTokenPrefix(token);

    // Check lockout status
    if (this.rateLimitService) {
      const lockout = await this.rateLimitService.isLockedOut(tokenPrefix);
      if (lockout.lockedOut) {
        return err({
          code: 'LOCKED_OUT',
          message: `Too many failed attempts. Try again in ${lockout.resetIn} seconds.`,
        });
      }
    }

    // Find all agents with this prefix (could be multiple due to hash collisions)
    const candidates = await this.db
      .select()
      .from(workspaceAgents)
      .where(eq(workspaceAgents.tokenPrefix, tokenPrefix));

    if (!candidates.length) {
      // Track failed attempt
      if (this.rateLimitService) {
        await this.rateLimitService.trackFailedAttempt(tokenPrefix);
      }
      return err({ code: 'TOKEN_NOT_FOUND', message: 'Invalid API token' });
    }

    // SECURITY: Check ALL candidates to prevent timing attacks
    // Even after finding a match, continue checking to ensure constant time
    let matchedAgent: (typeof candidates)[0] | null = null;

    for (const candidate of candidates) {
      const isMatch = await Bun.password.verify(token, candidate.tokenHash);
      if (isMatch && !matchedAgent) {
        matchedAgent = candidate;
      }
      // Continue checking even after match to prevent timing attacks
    }

    if (!matchedAgent) {
      // Track failed attempt
      if (this.rateLimitService) {
        await this.rateLimitService.trackFailedAttempt(tokenPrefix);
      }
      return err({ code: 'TOKEN_NOT_FOUND', message: 'Invalid API token' });
    }

    // Clear failed attempts on successful verification
    if (this.rateLimitService) {
      await this.rateLimitService.clearFailedAttempts(tokenPrefix);
    }

    // Check if agent is active
    if (!matchedAgent.isActive) {
      return err({ code: 'TOKEN_INACTIVE', message: 'API token is inactive' });
    }

    // Check expiration
    if (matchedAgent.expiresAt && matchedAgent.expiresAt < new Date()) {
      return err({ code: 'TOKEN_EXPIRED', message: 'API token has expired' });
    }

    // Check tool permission if specified
    if (options.toolName) {
      const permissions = matchedAgent.permissions as ApiTokenPermission[];
      if (!permissions.includes(options.toolName as ApiTokenPermission)) {
        return err({ code: 'PERMISSION_DENIED', message: `Token not authorized for tool: ${options.toolName}` });
      }
    }

    // Check rate limits if requested
    if (options.checkRateLimit && this.rateLimitService) {
      const rateLimit = await this.rateLimitService.checkMinuteLimit(matchedAgent.id, REQUESTS_PER_MINUTE);
      if (!rateLimit.allowed) {
        return err({
          code: 'RATE_LIMITED',
          message: `Rate limit exceeded. Try again in ${rateLimit.resetIn} seconds.`,
        });
      }
    }

    // Update last used timestamp (fire and forget)
    this.db
      .update(workspaceAgents)
      .set({ lastUsedAt: new Date() })
      .where(eq(workspaceAgents.id, matchedAgent.id))
      .then(() => {})
      .catch((e) => console.error('Failed to update lastUsedAt:', e));

    // Check daily token limit and reset if needed
    await this.checkAndResetDailyLimit(matchedAgent);

    // Parse restrictedProjectIds from JSONB
    const restrictedProjectIds = matchedAgent.restrictedProjectIds as string[] | null;

    return ok({
      id: matchedAgent.id,
      workspaceId: matchedAgent.workspaceId,
      restrictedProjectIds,
      name: matchedAgent.name,
      permissions: matchedAgent.permissions as ApiTokenPermission[],
      tokensPerDay: matchedAgent.tokensPerDay,
      currentDayTokens: matchedAgent.currentDayTokens,
    });
  }

  /**
   * Check if an agent can access a specific project.
   * Returns true if:
   * 1. The project is in the agent's workspace, AND
   * 2. Either no restrictions (null) OR project is in restricted list
   */
  async canAccessProject(agent: VerifiedAgent, projectId: string): Promise<boolean> {
    // Get project's workspace
    const [project] = await this.db
      .select({ workspaceId: projects.workspaceId })
      .from(projects)
      .where(eq(projects.id, projectId));

    if (!project) {
      return false;
    }

    // Must be in agent's workspace
    if (project.workspaceId !== agent.workspaceId) {
      return false;
    }

    // If no restrictions, allow all projects in workspace
    if (!agent.restrictedProjectIds || agent.restrictedProjectIds.length === 0) {
      return true;
    }

    // Check if project is in allowed list
    return agent.restrictedProjectIds.includes(projectId);
  }

  /**
   * Check and reset daily token limit if needed.
   */
  private async checkAndResetDailyLimit(agent: (typeof workspaceAgents.$inferSelect)): Promise<void> {
    const now = new Date();
    const lastReset = agent.lastTokenReset;
    const needsReset = !lastReset || lastReset.toDateString() !== now.toDateString();

    if (needsReset) {
      await this.db
        .update(workspaceAgents)
        .set({ currentDayTokens: 0, lastTokenReset: now })
        .where(eq(workspaceAgents.id, agent.id));
    }
  }

  /**
   * Record token usage (for daily limits).
   */
  async recordTokenUsage(agentId: string, tokensUsed: number): Promise<Result<void, Error>> {
    try {
      // Get current agent state
      const [agent] = await this.db
        .select()
        .from(workspaceAgents)
        .where(eq(workspaceAgents.id, agentId));

      if (!agent) {
        return err(new Error('Agent not found'));
      }

      // Check and reset daily limit if needed
      await this.checkAndResetDailyLimit(agent);

      // Increment usage
      await this.db
        .update(workspaceAgents)
        .set({
          currentDayTokens: agent.currentDayTokens + tokensUsed,
        })
        .where(eq(workspaceAgents.id, agentId));

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get agents that are expiring soon (for notifications).
   */
  async getExpiringAgents(daysUntilExpiry: number): Promise<Result<WorkspaceAgentWithWorkspace[], Error>> {
    try {
      const expiryDate = new Date();
      expiryDate.setDate(expiryDate.getDate() + daysUntilExpiry);

      const results = await this.db
        .select({
          agent: workspaceAgents,
          workspace: {
            id: workspaces.id,
            name: workspaces.name,
            slug: workspaces.slug,
          },
        })
        .from(workspaceAgents)
        .leftJoin(workspaces, eq(workspaceAgents.workspaceId, workspaces.id))
        .where(
          and(
            eq(workspaceAgents.isActive, true),
            lte(workspaceAgents.expiresAt, expiryDate)
          )
        );

      const agents: WorkspaceAgentWithWorkspace[] = results.map(({ agent, workspace }) => ({
        ...agent,
        workspace: workspace || undefined,
      }));

      return ok(agents);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }
}

// Export legacy alias for backwards compatibility
export { WorkspaceAgentService as ApiTokenService };
