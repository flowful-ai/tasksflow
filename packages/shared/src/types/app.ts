import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

export const AppRoleSchema = z.enum(['app_manager', 'user']);
export type AppRole = z.infer<typeof AppRoleSchema>;

export const AppContextSchema = z.object({
  userId: z.string().uuid(),
  appRole: AppRoleSchema,
  isAppManager: z.boolean(),
});

export type AppContext = z.infer<typeof AppContextSchema>;

export const AppManagedUserSchema = BaseEntitySchema.extend({
  email: z.string().email(),
  name: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  appRole: AppRoleSchema,
});

export type AppManagedUser = z.infer<typeof AppManagedUserSchema>;

export const AppUsersListQuerySchema = z.object({
  search: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

export type AppUsersListQuery = z.infer<typeof AppUsersListQuerySchema>;

export const AppUsersListResponseSchema = z.object({
  users: z.array(AppManagedUserSchema),
  total: z.number().int().nonnegative(),
  limit: z.number().int().positive(),
  offset: z.number().int().nonnegative(),
});

export type AppUsersListResponse = z.infer<typeof AppUsersListResponseSchema>;

export const UpdateAppUserRoleSchema = z.object({
  appRole: AppRoleSchema,
});

export type UpdateAppUserRole = z.infer<typeof UpdateAppUserRoleSchema>;
