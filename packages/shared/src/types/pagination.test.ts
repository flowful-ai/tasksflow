import { describe, expect, it } from 'bun:test';
import { createPaginationQuerySchema, PaginationQuerySchema, parsePagination } from './pagination.js';

describe('PaginationQuerySchema', () => {
  it('applies defaults when missing', () => {
    expect(PaginationQuerySchema.parse({})).toEqual({ page: 1, limit: 50 });
  });

  it('clamps out-of-range values', () => {
    expect(PaginationQuerySchema.parse({ page: '0', limit: '100000' })).toEqual({ page: 1, limit: 100 });
    expect(PaginationQuerySchema.parse({ page: '-5', limit: '-1' })).toEqual({ page: 1, limit: 1 });
  });

  it('is NaN-safe', () => {
    expect(PaginationQuerySchema.parse({ page: 'abc', limit: 'NaN' })).toEqual({ page: 1, limit: 50 });
    expect(PaginationQuerySchema.parse({ page: '', limit: 'Infinity' })).toEqual({ page: 1, limit: 50 });
  });

  it('truncates fractions', () => {
    expect(PaginationQuerySchema.parse({ page: '2.9', limit: '10.5' })).toEqual({ page: 2, limit: 10 });
  });

  it('honours custom bounds', () => {
    const schema = createPaginationQuerySchema({ defaultLimit: 20, maxLimit: 30 });
    expect(schema.parse({})).toEqual({ page: 1, limit: 20 });
    expect(schema.parse({ limit: '31' })).toEqual({ page: 1, limit: 30 });
  });

  it('parsePagination never throws', () => {
    expect(parsePagination({ page: null, limit: 'x' })).toEqual({ page: 1, limit: 50 });
  });
});
