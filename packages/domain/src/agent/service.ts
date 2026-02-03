import { eq, and, desc, asc, SQL } from 'drizzle-orm';
import type { Database } from '@flowtask/database';
import { agents, userApiKeys } from '@flowtask/database';
import type { Result, AgentTool } from '@flowtask/shared';
import { ok, err } from '@flowtask/shared';
import type {
  AgentWithRelations,
  AgentCreateInput,
  AgentUpdateInput,
  ApiKeyCreateInput,
  AgentListOptions,
} from './types.js';
import { AGENT_TOOLS } from './types.js';

// Simple encryption for API keys (in production, use a proper encryption library)
const ENCRYPTION_KEY = process.env.API_KEY_ENCRYPTION_KEY || 'default-dev-key-32-chars-here!!';

async function encryptApiKey(apiKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));
  const iv = crypto.getRandomValues(new Uint8Array(12));

  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['encrypt']);

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoder.encode(apiKey)
  );

  // Combine IV and encrypted data
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);

  return btoa(String.fromCharCode(...combined));
}

async function decryptApiKey(encryptedKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(ENCRYPTION_KEY.slice(0, 32).padEnd(32, '0'));

  const combined = new Uint8Array(
    atob(encryptedKey)
      .split('')
      .map((c) => c.charCodeAt(0))
  );

  const iv = combined.slice(0, 12);
  const encrypted = combined.slice(12);

  const key = await crypto.subtle.importKey('raw', keyData, { name: 'AES-GCM' }, false, ['decrypt']);

  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, encrypted);

  return new TextDecoder().decode(decrypted);
}

export class AgentService {
  constructor(private db: Database) {}

  /**
   * Create a new agent.
   */
  async create(input: AgentCreateInput): Promise<Result<AgentWithRelations, Error>> {
    try {
      const [agent] = await this.db
        .insert(agents)
        .values({
          workspaceId: input.workspaceId,
          name: input.name,
          model: input.model,
          systemPrompt: input.systemPrompt || null,
          tools: input.tools || [],
          requestsPerMinute: input.requestsPerMinute || 10,
          tokensPerDay: input.tokensPerDay || 100000,
          createdBy: input.createdBy,
        })
        .returning();

      if (!agent) {
        return err(new Error('Failed to create agent'));
      }

      return this.getById(agent.id);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get an agent by ID with computed fields.
   */
  async getById(agentId: string): Promise<Result<AgentWithRelations, Error>> {
    try {
      const [agent] = await this.db.select().from(agents).where(eq(agents.id, agentId));

      if (!agent) {
        return err(new Error('Agent not found'));
      }

      // Check if token reset is needed
      const now = new Date();
      const lastReset = agent.lastTokenReset;
      const needsReset = !lastReset || lastReset.toDateString() !== now.toDateString();

      if (needsReset) {
        await this.db
          .update(agents)
          .set({ currentDayTokens: 0, lastTokenReset: now })
          .where(eq(agents.id, agentId));
        agent.currentDayTokens = 0;
      }

      return ok({
        ...agent,
        isRateLimited: agent.currentDayTokens >= agent.tokensPerDay,
        remainingTokensToday: Math.max(0, agent.tokensPerDay - agent.currentDayTokens),
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Update an agent.
   */
  async update(agentId: string, input: AgentUpdateInput): Promise<Result<AgentWithRelations, Error>> {
    try {
      const updateData: Record<string, unknown> = {};

      if (input.name !== undefined) updateData.name = input.name;
      if (input.model !== undefined) updateData.model = input.model;
      if (input.systemPrompt !== undefined) updateData.systemPrompt = input.systemPrompt;
      if (input.tools !== undefined) updateData.tools = input.tools;
      if (input.requestsPerMinute !== undefined) updateData.requestsPerMinute = input.requestsPerMinute;
      if (input.tokensPerDay !== undefined) updateData.tokensPerDay = input.tokensPerDay;
      if (input.isActive !== undefined) updateData.isActive = input.isActive;

      if (Object.keys(updateData).length > 0) {
        const [updated] = await this.db
          .update(agents)
          .set(updateData)
          .where(eq(agents.id, agentId))
          .returning();

        if (!updated) {
          return err(new Error('Failed to update agent'));
        }
      }

      return this.getById(agentId);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Delete an agent.
   */
  async delete(agentId: string): Promise<Result<void, Error>> {
    try {
      await this.db.delete(agents).where(eq(agents.id, agentId));
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * List agents with filtering.
   */
  async list(options: AgentListOptions = {}): Promise<Result<AgentWithRelations[], Error>> {
    try {
      const { filters = {}, sortBy = 'name', sortOrder = 'asc' } = options;

      // Build where conditions
      const conditions: SQL[] = [];

      if (filters.workspaceId) {
        conditions.push(eq(agents.workspaceId, filters.workspaceId));
      }

      if (filters.isActive !== undefined) {
        conditions.push(eq(agents.isActive, filters.isActive));
      }

      if (filters.model) {
        conditions.push(eq(agents.model, filters.model));
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Build sort clause
      const sortColumn = {
        name: agents.name,
        created_at: agents.createdAt,
      }[sortBy];

      const orderFn = sortOrder === 'desc' ? desc : asc;

      // Get agents
      const agentRows = await this.db
        .select()
        .from(agents)
        .where(whereClause)
        .orderBy(orderFn(sortColumn!));

      // Add computed fields
      const result: AgentWithRelations[] = agentRows.map((agent) => ({
        ...agent,
        isRateLimited: agent.currentDayTokens >= agent.tokensPerDay,
        remainingTokensToday: Math.max(0, agent.tokensPerDay - agent.currentDayTokens),
      }));

      return ok(result);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Record token usage for an agent.
   */
  async recordTokenUsage(agentId: string, tokensUsed: number): Promise<Result<void, Error>> {
    try {
      const agentResult = await this.getById(agentId);
      if (!agentResult.ok) {
        return agentResult;
      }

      await this.db
        .update(agents)
        .set({
          currentDayTokens: agentResult.value.currentDayTokens + tokensUsed,
        })
        .where(eq(agents.id, agentId));

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get tools available for an agent.
   */
  getAgentTools(agent: AgentWithRelations): typeof AGENT_TOOLS {
    const enabledTools = agent.tools as AgentTool[];
    return AGENT_TOOLS.filter((tool) => enabledTools.includes(tool.name));
  }

  // === API Key Management ===

  /**
   * Store an encrypted API key for a user.
   */
  async storeApiKey(input: ApiKeyCreateInput): Promise<Result<typeof userApiKeys.$inferSelect, Error>> {
    try {
      const encryptedKey = await encryptApiKey(input.apiKey);

      const [apiKey] = await this.db
        .insert(userApiKeys)
        .values({
          userId: input.userId,
          provider: input.provider,
          encryptedKey,
        })
        .onConflictDoUpdate({
          target: [userApiKeys.userId, userApiKeys.provider],
          set: { encryptedKey, lastUsedAt: null },
        })
        .returning();

      if (!apiKey) {
        return err(new Error('Failed to store API key'));
      }

      return ok(apiKey);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get the decrypted API key for a user.
   */
  async getApiKey(userId: string, provider: 'openrouter'): Promise<Result<string, Error>> {
    try {
      const [apiKey] = await this.db
        .select()
        .from(userApiKeys)
        .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider)));

      if (!apiKey) {
        return err(new Error('API key not found'));
      }

      // Update last used timestamp
      await this.db
        .update(userApiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(userApiKeys.id, apiKey.id));

      const decrypted = await decryptApiKey(apiKey.encryptedKey);
      return ok(decrypted);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Check if a user has an API key stored.
   */
  async hasApiKey(userId: string, provider: 'openrouter'): Promise<boolean> {
    const [apiKey] = await this.db
      .select({ id: userApiKeys.id })
      .from(userApiKeys)
      .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider)));

    return !!apiKey;
  }

  /**
   * Delete a user's API key.
   */
  async deleteApiKey(userId: string, provider: 'openrouter'): Promise<Result<void, Error>> {
    try {
      await this.db
        .delete(userApiKeys)
        .where(and(eq(userApiKeys.userId, userId), eq(userApiKeys.provider, provider)));

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }
}
