import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

export const UserSchema = BaseEntitySchema.extend({
  email: z.string().email(),
  name: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
});

export type User = z.infer<typeof UserSchema>;

export const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

export type CreateUser = z.infer<typeof CreateUserSchema>;

export const UpdateUserSchema = z.object({
  name: z.string().optional(),
  avatarUrl: z.string().url().optional(),
});

export type UpdateUser = z.infer<typeof UpdateUserSchema>;
