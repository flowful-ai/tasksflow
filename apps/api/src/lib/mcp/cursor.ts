import { z } from 'zod';
import { DEFAULT_LIST_LIMIT, MAX_LIST_LIMIT } from '../../domain/index.js';
import { ToolExecutionError } from './errors.js';

/**
 * Opaque list cursors. They encode the offset and page size, so a follow-up
 * call returns the next page even if the model omits or changes `limit`.
 */

const CursorSchema = z.object({
  o: z.number().int().min(0),
  l: z.number().int().min(1).max(MAX_LIST_LIMIT),
});

export interface PageWindow {
  offset: number;
  limit: number;
}

export function encodeCursor(window: PageWindow): string {
  return Buffer.from(JSON.stringify({ o: window.offset, l: window.limit })).toString('base64url');
}

export function decodeCursor(cursor: string): PageWindow {
  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new ToolExecutionError('cursor is invalid; pass nextCursor from the previous page unchanged', 'VALIDATION_ERROR');
  }
  const parsed = CursorSchema.safeParse(json);
  if (!parsed.success) {
    throw new ToolExecutionError('cursor is invalid; pass nextCursor from the previous page unchanged', 'VALIDATION_ERROR');
  }
  return { offset: parsed.data.o, limit: parsed.data.l };
}

export function resolvePageWindow(input: { limit?: number; cursor?: string }): PageWindow {
  if (input.cursor) {
    return decodeCursor(input.cursor);
  }
  const limit = Math.min(Math.max(input.limit ?? DEFAULT_LIST_LIMIT, 1), MAX_LIST_LIMIT);
  return { offset: 0, limit };
}

/** 1-based page number for services paginating by page; offsets are always multiples of limit. */
export function pageNumber(window: PageWindow): number {
  return Math.floor(window.offset / window.limit) + 1;
}

export function nextCursorFor(window: PageWindow, total: number): string | undefined {
  const nextOffset = window.offset + window.limit;
  return nextOffset < total ? encodeCursor({ offset: nextOffset, limit: window.limit }) : undefined;
}
