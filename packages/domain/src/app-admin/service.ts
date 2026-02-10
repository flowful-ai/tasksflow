import { and, asc, count, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '@flowtask/database';
import { users } from '@flowtask/database';
import type { AppRole, Result } from '@flowtask/shared';
import { err, ok } from '@flowtask/shared';
import type {
  AppContext,
  AppUserSummary,
  ListAppUsersInput,
  ListAppUsersResult,
  UpdateUserRoleInput,
} from './types.js';

function escapeLike(value: string): string {
  return value.replace(/[%_\\]/g, '\\$&');
}

function normalizeAppRole(appRole: string): AppRole {
  return appRole === 'app_manager' ? 'app_manager' : 'user';
}

function toSummary(row: typeof users.$inferSelect): AppUserSummary {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    avatarUrl: row.avatarUrl,
    appRole: normalizeAppRole(row.appRole),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export class AppAdminService {
  constructor(private db: Database) {}

  async getAppContext(userId: string): Promise<Result<AppContext, Error>> {
    try {
      const [user] = await this.db
        .select({
          id: users.id,
          appRole: users.appRole,
        })
        .from(users)
        .where(eq(users.id, userId));

      if (!user) {
        return err(new Error('User not found'));
      }

      const appRole = normalizeAppRole(user.appRole);
      return ok({
        userId: user.id,
        appRole,
        isAppManager: appRole === 'app_manager',
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  async listUsers(input: ListAppUsersInput = {}): Promise<Result<ListAppUsersResult, Error>> {
    try {
      const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
      const offset = Math.max(input.offset ?? 0, 0);
      const search = input.search?.trim();

      const conditions: SQL[] = [];
      if (search) {
        const pattern = `%${escapeLike(search)}%`;
        conditions.push(or(ilike(users.email, pattern), ilike(users.name, pattern))!);
      }

      const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

      const [rows, [countRow]] = await Promise.all([
        this.db
          .select()
          .from(users)
          .where(whereClause)
          .orderBy(asc(users.email))
          .limit(limit)
          .offset(offset),
        this.db
          .select({ count: count() })
          .from(users)
          .where(whereClause),
      ]);

      return ok({
        users: rows.map(toSummary),
        total: countRow?.count ?? 0,
        limit,
        offset,
      });
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }

  async updateUserRole(input: UpdateUserRoleInput): Promise<Result<AppUserSummary, Error>> {
    try {
      const actorContext = await this.getAppContext(input.actorUserId);
      if (!actorContext.ok) {
        return err(actorContext.error);
      }

      if (!actorContext.value.isAppManager) {
        return err(new Error('Only app managers can manage user roles'));
      }

      const [target] = await this.db.select().from(users).where(eq(users.id, input.targetUserId));
      if (!target) {
        return err(new Error('User not found'));
      }

      const currentRole = normalizeAppRole(target.appRole);
      if (currentRole === input.appRole) {
        return ok(toSummary(target));
      }

      if (currentRole === 'app_manager' && input.appRole === 'user') {
        const [appManagerCount] = await this.db
          .select({ count: sql<number>`COUNT(*)` })
          .from(users)
          .where(eq(users.appRole, 'app_manager'));

        if ((appManagerCount?.count ?? 0) <= 1) {
          return err(new Error('Cannot demote the last app manager'));
        }
      }

      const [updated] = await this.db
        .update(users)
        .set({
          appRole: input.appRole,
          updatedAt: new Date(),
        })
        .where(eq(users.id, input.targetUserId))
        .returning();

      if (!updated) {
        return err(new Error('Failed to update user role'));
      }

      return ok(toSummary(updated));
    } catch (error) {
      return err(error instanceof Error ? error : new Error('Unknown error'));
    }
  }
}
