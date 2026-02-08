import { eq, and, or, desc, asc, inArray, SQL } from 'drizzle-orm';
import type { Database } from '@flowtask/database';
import { smartViews, smartViewShares, publicShares, users, type NewPublicShare } from '@flowtask/database';
import type { Result, FilterGroup } from '@flowtask/shared';
import { ok, err } from '@flowtask/shared';
import type {
  SmartViewWithRelations,
  SmartViewCreateInput,
  SmartViewUpdateInput,
  PublicShareCreateInput,
  SmartViewShareInput,
  SmartViewListOptions,
} from './types.js';
import { FilterEngine } from './filter-engine.js';

async function hashPassword(password: string): Promise<string> {
  return Bun.password.hash(password, { algorithm: 'bcrypt', cost: 12 });
}

async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return Bun.password.verify(password, hash);
}

export class SmartViewService {
  constructor(private db: Database) {}

  /**
   * Create a new smart view.
   */
  async create(input: SmartViewCreateInput): Promise<Result<SmartViewWithRelations, Error>> {
    try {
      // Validate filters if provided
      if (input.filters) {
        const validation = FilterEngine.validate(input.filters);
        if (!validation.valid) {
          return err(new Error(`Invalid filters: ${validation.errors.join(', ')}`));
        }
      }

      const normalizedGroupBy = input.groupBy && input.groupBy !== 'none' ? input.groupBy : 'state';
      const normalizedSecondaryGroupByRaw =
        input.secondaryGroupBy && input.secondaryGroupBy !== 'none' ? input.secondaryGroupBy : null;
      const normalizedSecondaryGroupBy =
        normalizedSecondaryGroupByRaw === normalizedGroupBy ? null : normalizedSecondaryGroupByRaw;

      const [view] = await this.db
        .insert(smartViews)
        .values({
          workspaceId: input.workspaceId,
          createdBy: input.createdBy,
          name: input.name,
          description: input.description || null,
          icon: input.icon || null,
          filters: input.filters || { operator: 'AND', conditions: [] },
          displayType: input.displayType || 'kanban',
          groupBy: normalizedGroupBy,
          secondaryGroupBy: normalizedSecondaryGroupBy,
          sortBy: input.sortBy || 'position',
          sortOrder: input.sortOrder || 'asc',
          visibleFields: input.visibleFields || null,
          isPersonal: input.isPersonal || false,
        })
        .returning();

      if (!view) {
        return err(new Error('Failed to create smart view'));
      }

      return this.getById(view.id);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get a smart view by ID with all relations.
   */
  async getById(viewId: string): Promise<Result<SmartViewWithRelations, Error>> {
    try {
      const [view] = await this.db.select().from(smartViews).where(eq(smartViews.id, viewId));

      if (!view) {
        return err(new Error('Smart view not found'));
      }

      // Get shares
      const shares = await this.db.select().from(smartViewShares).where(eq(smartViewShares.smartViewId, viewId));

      // Get public shares
      const publicSharesList = await this.db
        .select()
        .from(publicShares)
        .where(eq(publicShares.smartViewId, viewId));

      return ok({
        ...view,
        shares,
        publicShares: publicSharesList,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Update a smart view.
   */
  async update(viewId: string, input: SmartViewUpdateInput): Promise<Result<SmartViewWithRelations, Error>> {
    try {
      // Validate filters if provided
      if (input.filters) {
        const validation = FilterEngine.validate(input.filters);
        if (!validation.valid) {
          return err(new Error(`Invalid filters: ${validation.errors.join(', ')}`));
        }
      }

      const updateData: Record<string, unknown> = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.icon !== undefined) updateData.icon = input.icon;
      if (input.filters !== undefined) updateData.filters = input.filters;
      if (input.displayType !== undefined) updateData.displayType = input.displayType;
      if (input.groupBy !== undefined) {
        const normalizedGroupBy =
          input.groupBy === 'none' || input.groupBy === null ? 'state' : input.groupBy;
        updateData.groupBy = normalizedGroupBy;

        if (input.secondaryGroupBy !== undefined) {
          const normalizedSecondary =
            input.secondaryGroupBy === 'none' ? null : input.secondaryGroupBy;
          updateData.secondaryGroupBy =
            normalizedSecondary === normalizedGroupBy ? null : normalizedSecondary;
        }
      } else if (input.secondaryGroupBy !== undefined) {
        updateData.secondaryGroupBy =
          input.secondaryGroupBy === 'none' ? null : input.secondaryGroupBy;
      }
      if (input.sortBy !== undefined) updateData.sortBy = input.sortBy;
      if (input.sortOrder !== undefined) updateData.sortOrder = input.sortOrder;
      if (input.visibleFields !== undefined) updateData.visibleFields = input.visibleFields;
      if (input.isPersonal !== undefined) updateData.isPersonal = input.isPersonal;

      const [updated] = await this.db
        .update(smartViews)
        .set(updateData)
        .where(eq(smartViews.id, viewId))
        .returning();

      if (!updated) {
        return err(new Error('Failed to update smart view'));
      }

      return this.getById(viewId);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Delete a smart view.
   */
  async delete(viewId: string): Promise<Result<void, Error>> {
    try {
      await this.db.delete(smartViews).where(eq(smartViews.id, viewId));
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * List smart views with filtering.
   */
  async list(options: SmartViewListOptions = {}): Promise<Result<SmartViewWithRelations[], Error>> {
    try {
      const { filters = {}, sortBy = 'name', sortOrder = 'asc' } = options;

      // Build where conditions
      const conditions: SQL[] = [];

      if (filters.workspaceId) {
        conditions.push(eq(smartViews.workspaceId, filters.workspaceId));
      }

      if (filters.createdBy) {
        conditions.push(eq(smartViews.createdBy, filters.createdBy));
      }

      if (filters.isPersonal !== undefined) {
        conditions.push(eq(smartViews.isPersonal, filters.isPersonal));
      }

      // If filtering by user, include:
      // 1. Non-personal views (team views visible to all workspace members)
      // 2. Personal views created by the user
      // 3. Views explicitly shared with the user
      if (filters.userId && filters.includeShared) {
        const sharedViewIds = await this.db
          .select({ smartViewId: smartViewShares.smartViewId })
          .from(smartViewShares)
          .where(eq(smartViewShares.sharedWithUserId, filters.userId));

        const sharedIds = sharedViewIds.map((r) => r.smartViewId);

        const visibilityConditions = [
          // Non-personal views are visible to everyone in the workspace
          eq(smartViews.isPersonal, false),
          // Personal views created by the user
          and(eq(smartViews.isPersonal, true), eq(smartViews.createdBy, filters.userId)),
        ];

        // Views explicitly shared with the user
        if (sharedIds.length > 0) {
          visibilityConditions.push(inArray(smartViews.id, sharedIds));
        }

        conditions.push(or(...visibilityConditions)!);
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      // Build sort clause
      const sortColumn = {
        name: smartViews.name,
        created_at: smartViews.createdAt,
        updated_at: smartViews.updatedAt,
      }[sortBy];

      const orderFn = sortOrder === 'desc' ? desc : asc;

      // Get views
      const viewRows = await this.db
        .select()
        .from(smartViews)
        .where(whereClause)
        .orderBy(orderFn(sortColumn!));

      // Get all shares and public shares
      const viewIds = viewRows.map((v) => v.id);

      if (viewIds.length === 0) {
        return ok([]);
      }

      const [allShares, allPublicShares] = await Promise.all([
        this.db.select().from(smartViewShares).where(inArray(smartViewShares.smartViewId, viewIds)),
        this.db.select().from(publicShares).where(inArray(publicShares.smartViewId, viewIds)),
      ]);

      // Build maps
      const sharesMap = new Map<string, typeof smartViewShares.$inferSelect[]>();
      const publicSharesMap = new Map<string, typeof publicShares.$inferSelect[]>();

      for (const share of allShares) {
        const existing = sharesMap.get(share.smartViewId) || [];
        existing.push(share);
        sharesMap.set(share.smartViewId, existing);
      }

      for (const share of allPublicShares) {
        const existing = publicSharesMap.get(share.smartViewId) || [];
        existing.push(share);
        publicSharesMap.set(share.smartViewId, existing);
      }

      // Build result
      const result: SmartViewWithRelations[] = viewRows.map((view) => ({
        ...view,
        shares: sharesMap.get(view.id) || [],
        publicShares: publicSharesMap.get(view.id) || [],
      }));

      return ok(result);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  // === Smart View Sharing ===

  /**
   * Share a smart view with a user.
   */
  async share(input: SmartViewShareInput): Promise<Result<typeof smartViewShares.$inferSelect, Error>> {
    try {
      const [share] = await this.db
        .insert(smartViewShares)
        .values({
          smartViewId: input.smartViewId,
          sharedWithUserId: input.sharedWithUserId,
          permission: input.permission,
        })
        .onConflictDoUpdate({
          target: [smartViewShares.smartViewId, smartViewShares.sharedWithUserId],
          set: { permission: input.permission },
        })
        .returning();

      if (!share) {
        return err(new Error('Failed to share smart view'));
      }

      return ok(share);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Remove a share from a smart view.
   */
  async unshare(smartViewId: string, userId: string): Promise<Result<void, Error>> {
    try {
      await this.db
        .delete(smartViewShares)
        .where(
          and(eq(smartViewShares.smartViewId, smartViewId), eq(smartViewShares.sharedWithUserId, userId))
        );

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  // === Public Sharing ===

  /**
   * Create a public share link for a smart view.
   */
  async createPublicShare(input: PublicShareCreateInput): Promise<Result<typeof publicShares.$inferSelect, Error>> {
    try {
      const values: NewPublicShare = {
        smartViewId: input.smartViewId,
        createdBy: input.createdBy,
        displayTypeOverride: input.displayTypeOverride,
        hideFields: input.hideFields,
        expiresAt: input.expiresAt,
        maxAccessCount: input.maxAccessCount,
        passwordHash: input.password ? await hashPassword(input.password) : null,
      };

      const [share] = await this.db.insert(publicShares).values(values).returning();

      if (!share) {
        return err(new Error('Failed to create public share'));
      }

      return ok(share);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Get a public share by token.
   */
  async getPublicShareByToken(token: string): Promise<Result<typeof publicShares.$inferSelect, Error>> {
    try {
      const [share] = await this.db.select().from(publicShares).where(eq(publicShares.token, token));

      if (!share) {
        return err(new Error('Public share not found'));
      }

      // Check if active
      if (!share.isActive) {
        return err(new Error('Public share is disabled'));
      }

      // Check expiration
      if (share.expiresAt && share.expiresAt < new Date()) {
        return err(new Error('Public share has expired'));
      }

      // Check access count
      if (share.maxAccessCount && share.accessCount >= share.maxAccessCount) {
        return err(new Error('Public share has reached maximum access count'));
      }

      return ok(share);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Verify password for a protected public share.
   */
  async verifyPublicSharePassword(token: string, password: string): Promise<Result<boolean, Error>> {
    try {
      const shareResult = await this.getPublicShareByToken(token);
      if (!shareResult.ok) {
        return shareResult;
      }

      const share = shareResult.value;
      if (!share.passwordHash) {
        return ok(true); // No password required
      }

      const valid = await verifyPassword(password, share.passwordHash);
      return ok(valid);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Record an access to a public share.
   */
  async recordPublicShareAccess(token: string): Promise<Result<void, Error>> {
    try {
      await this.db
        .update(publicShares)
        .set({
          accessCount: sql`${publicShares.accessCount} + 1`,
          lastAccessedAt: new Date(),
        })
        .where(eq(publicShares.token, token));

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Disable a public share.
   */
  async disablePublicShare(shareId: string): Promise<Result<void, Error>> {
    try {
      await this.db.update(publicShares).set({ isActive: false }).where(eq(publicShares.id, shareId));

      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  /**
   * Delete a public share.
   */
  async deletePublicShare(shareId: string): Promise<Result<void, Error>> {
    try {
      await this.db.delete(publicShares).where(eq(publicShares.id, shareId));
      return ok(undefined);
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }
}

// Import sql for the recordPublicShareAccess function
import { sql } from 'drizzle-orm';
