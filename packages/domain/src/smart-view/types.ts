import type { SmartView, PublicShare, SmartViewShare } from '@flowtask/database';
import type {
  CreateSmartView,
  UpdateSmartView,
  CreatePublicShare,
  FilterGroup,
  DisplayType,
  GroupBy,
  SortBy,
  SortOrder,
  VisibleField,
} from '@flowtask/shared';

export interface SmartViewWithRelations extends SmartView {
  shares: SmartViewShare[];
  publicShares: PublicShare[];
}

export interface SmartViewCreateInput extends CreateSmartView {
  workspaceId: string;
  createdBy: string | null;
}

export interface SmartViewUpdateInput extends UpdateSmartView {
  updatedBy: string;
}

export interface PublicShareCreateInput extends CreatePublicShare {
  smartViewId: string;
  createdBy: string;
}

export interface SmartViewShareInput {
  smartViewId: string;
  sharedWithUserId: string;
  permission: 'view' | 'edit';
}

export interface SmartViewFilters {
  workspaceId?: string;
  createdBy?: string;
  isPersonal?: boolean;
  includeShared?: boolean;
  userId?: string; // For filtering views accessible to a user
}

export interface SmartViewListOptions {
  filters?: SmartViewFilters;
  sortBy?: 'name' | 'created_at' | 'updated_at';
  sortOrder?: 'asc' | 'desc';
}

// Filter execution context
export interface FilterContext {
  currentUserId: string;
  now: Date;
  startOfWeek: Date;
  endOfWeek: Date;
  startOfMonth: Date;
  endOfMonth: Date;
}

// Resolved filter (with template variables replaced)
export interface ResolvedFilter {
  filters: FilterGroup;
  context: FilterContext;
}
