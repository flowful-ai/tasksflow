import { z } from 'zod';
import { BaseEntitySchema, SortOrderSchema } from './common.js';

// Filter operators
export const FilterOperatorSchema = z.enum([
  'eq',
  'neq',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'nin',
  'contains',
  'not_contains',
  'starts_with',
  'ends_with',
  'is_null',
  'is_not_null',
]);
export type FilterOperator = z.infer<typeof FilterOperatorSchema>;

// Filter condition
export const FilterConditionSchema = z.object({
  field: z.string(),
  op: FilterOperatorSchema,
  value: z.unknown(),
});
export type FilterCondition = z.infer<typeof FilterConditionSchema>;

// Filter group (AND/OR)
export const FilterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    operator: z.enum(['AND', 'OR']),
    conditions: z.array(z.union([FilterConditionSchema, FilterGroupSchema])),
  })
);
export type FilterGroup = {
  operator: 'AND' | 'OR';
  conditions: (FilterCondition | FilterGroup)[];
};

// Display types
export const DisplayTypeSchema = z.enum(['kanban', 'list', 'table', 'calendar']);
export type DisplayType = z.infer<typeof DisplayTypeSchema>;

// Group by options
export const GroupBySchema = z.enum(['state', 'assignee', 'project', 'priority', 'label', 'none']);
export type GroupBy = z.infer<typeof GroupBySchema>;

// Sort by options
export const SortBySchema = z.enum([
  'position',
  'created_at',
  'updated_at',
  'due_date',
  'priority',
  'title',
  'sequence_number',
]);
export type SortBy = z.infer<typeof SortBySchema>;

// Visible fields
export const VisibleFieldSchema = z.enum([
  'title',
  'description',
  'state',
  'priority',
  'assignee',
  'labels',
  'due_date',
  'start_date',
  'created_at',
  'updated_at',
  'project',
  'sequence_number',
]);
export type VisibleField = z.infer<typeof VisibleFieldSchema>;

// Smart View schema
export const SmartViewSchema = BaseEntitySchema.extend({
  workspaceId: z.string().uuid(),
  createdBy: z.string().uuid().nullable(),
  name: z.string().min(1).max(100),
  description: z.string().nullable(),
  icon: z.string().nullable(),
  filters: FilterGroupSchema,
  displayType: DisplayTypeSchema.default('kanban'),
  groupBy: GroupBySchema.nullable(),
  sortBy: SortBySchema.default('position'),
  sortOrder: SortOrderSchema.default('asc'),
  visibleFields: z.array(VisibleFieldSchema).nullable(),
  isPersonal: z.boolean().default(false),
});

export type SmartView = z.infer<typeof SmartViewSchema>;

export const CreateSmartViewSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  icon: z.string().optional(),
  filters: FilterGroupSchema.optional(),
  displayType: DisplayTypeSchema.optional(),
  groupBy: GroupBySchema.optional(),
  sortBy: SortBySchema.optional(),
  sortOrder: SortOrderSchema.optional(),
  visibleFields: z.array(VisibleFieldSchema).optional(),
  isPersonal: z.boolean().optional(),
});

export type CreateSmartView = z.infer<typeof CreateSmartViewSchema>;

export const UpdateSmartViewSchema = CreateSmartViewSchema.partial();
export type UpdateSmartView = z.infer<typeof UpdateSmartViewSchema>;

// Smart View shares
export const SmartViewSharePermissionSchema = z.enum(['view', 'edit']);
export type SmartViewSharePermission = z.infer<typeof SmartViewSharePermissionSchema>;

export const SmartViewShareSchema = z.object({
  id: z.string().uuid(),
  smartViewId: z.string().uuid(),
  sharedWithUserId: z.string().uuid(),
  permission: SmartViewSharePermissionSchema.default('view'),
  createdAt: z.coerce.date(),
});

export type SmartViewShare = z.infer<typeof SmartViewShareSchema>;

// Public shares
export const PublicShareSchema = z.object({
  id: z.string().uuid(),
  smartViewId: z.string().uuid(),
  token: z.string().uuid(),
  displayTypeOverride: DisplayTypeSchema.nullable(),
  hideFields: z.array(VisibleFieldSchema).nullable(),
  passwordHash: z.string().nullable(),
  expiresAt: z.coerce.date().nullable(),
  maxAccessCount: z.number().int().positive().nullable(),
  accessCount: z.number().int().nonnegative().default(0),
  lastAccessedAt: z.coerce.date().nullable(),
  isActive: z.boolean().default(true),
  createdBy: z.string().uuid().nullable(),
  createdAt: z.coerce.date(),
});

export type PublicShare = z.infer<typeof PublicShareSchema>;

export const CreatePublicShareSchema = z.object({
  displayTypeOverride: DisplayTypeSchema.optional(),
  hideFields: z.array(VisibleFieldSchema).optional(),
  password: z.string().min(4).optional(),
  expiresAt: z.coerce.date().optional(),
  maxAccessCount: z.number().int().positive().optional(),
});

export type CreatePublicShare = z.infer<typeof CreatePublicShareSchema>;
