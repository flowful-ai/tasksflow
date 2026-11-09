import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HTTPException } from 'hono/http-exception';
import { isDomainError, isTaskError, type DomainErrorCode } from '@flowtask/domain';
import type { Result } from '@flowtask/shared';

/**
 * API error with a status, a stable code and a message that is safe to show.
 * Throw it from a handler (or helper) and the route's error handler turns it
 * into `{ success: false, error: { code, message } }`.
 */
export class AppError extends Error {
  readonly status: ContentfulStatusCode;
  readonly code: string;

  constructor(status: ContentfulStatusCode, code: string, message: string) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

export const badRequest = (message = 'Bad request', code = 'BAD_REQUEST'): AppError => new AppError(400, code, message);
export const unauthorized = (message = 'Authentication required'): AppError => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Not authorized', code = 'FORBIDDEN'): AppError => new AppError(403, code, message);
export const notFound = (what = 'Resource'): AppError => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, code = 'CONFLICT'): AppError => new AppError(409, code, message);
export const tooManyRequests = (message = 'Too many requests'): AppError => new AppError(429, 'RATE_LIMITED', message);

const DOMAIN_STATUS: Record<DomainErrorCode, ContentfulStatusCode> = {
  BAD_REQUEST: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
};

export interface ResultFallback {
  status?: ContentfulStatusCode;
  code: string;
  message: string;
}

/**
 * Convert a service error into an AppError. Domain errors keep their message;
 * anything else (typically a database error, which may embed SQL) is logged
 * server-side and replaced with the generic fallback message.
 */
export function toAppError(error: Error, fallback: ResultFallback): AppError {
  if (isAppError(error)) return error;
  if (isDomainError(error)) {
    return new AppError(DOMAIN_STATUS[error.code], error.code, error.message);
  }
  if (isTaskError(error)) {
    return new AppError(error.status, error.code, error.message);
  }
  console.error(`[${fallback.code}]`, error);
  return new AppError(fallback.status ?? 500, fallback.code, fallback.message);
}

/** Unwrap a Result, throwing an AppError on failure. */
export function fromResult<T>(result: Result<T, Error>, fallback: ResultFallback): T {
  if (result.ok) return result.value;
  throw toAppError(result.error, fallback);
}

export function errorBody(code: string, message: string) {
  return { success: false as const, error: { code, message } };
}

export function respondError(c: Context, error: AppError): Response {
  return c.json(errorBody(error.code, error.message), error.status);
}

/**
 * Route-level `onError` handler. Register it on each router *before* it is
 * mounted with `app.route()` (Hono captures the handler at mount time).
 */
export function handleRouteError(error: Error, c: Context): Response {
  if (isAppError(error)) {
    return respondError(c, error);
  }
  if (error instanceof HTTPException && error.status < 500) {
    const code = error.status === 401 ? 'UNAUTHORIZED' : 'HTTP_ERROR';
    return c.json(errorBody(code, error.message || 'Request failed'), error.status);
  }
  console.error('Unhandled route error:', error);
  return c.json(errorBody('INTERNAL_ERROR', 'Internal server error'), 500);
}
