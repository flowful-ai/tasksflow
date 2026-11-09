import { z } from 'zod';

/**
 * Query-string pagination that never fails and never returns NaN.
 *
 * `page` and `limit` arrive as strings (or are missing). Non-numeric, empty,
 * fractional or out-of-range values are coerced into range instead of being
 * rejected, so `?limit=abc` falls back to the default and `?limit=100000` is
 * clamped to the maximum.
 */
export interface PaginationBounds {
  defaultLimit?: number;
  maxLimit?: number;
  maxPage?: number;
}

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;
const MAX_PAGE = 100_000;

export function clampInt(raw: string | number | null | undefined, fallback: number, min: number, max: number): number {
  const parsed = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

const QueryScalarSchema = z.union([z.string(), z.number()]).optional().nullable();

export function createPaginationQuerySchema(bounds: PaginationBounds = {}) {
  const maxLimit = bounds.maxLimit ?? MAX_PAGE_LIMIT;
  const defaultLimit = Math.min(bounds.defaultLimit ?? DEFAULT_PAGE_LIMIT, maxLimit);
  const maxPage = bounds.maxPage ?? MAX_PAGE;

  return z.object({
    page: QueryScalarSchema.transform((value) => clampInt(value, 1, 1, maxPage)),
    limit: QueryScalarSchema.transform((value) => clampInt(value, defaultLimit, 1, maxLimit)),
  });
}

export const PaginationQuerySchema = createPaginationQuerySchema();
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** Parse pagination from raw query values; always succeeds. */
export function parsePagination(
  query: { page?: string | null; limit?: string | null },
  bounds?: PaginationBounds
): PaginationQuery {
  const schema = bounds ? createPaginationQuerySchema(bounds) : PaginationQuerySchema;
  const parsed = schema.safeParse({ page: query.page ?? undefined, limit: query.limit ?? undefined });
  if (parsed.success) return parsed.data;
  const maxLimit = bounds?.maxLimit ?? MAX_PAGE_LIMIT;
  return { page: 1, limit: Math.min(bounds?.defaultLimit ?? DEFAULT_PAGE_LIMIT, maxLimit) };
}
