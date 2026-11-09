/**
 * Errors whose message is safe to show to API clients.
 *
 * Services return a DomainError for expected business failures (not found,
 * permission denied, conflicts, validation). Any other Error is treated as an
 * internal failure by the API layer: it is logged and replaced with a generic
 * message, so database errors (which may contain SQL) never reach clients.
 */
export type DomainErrorCode = 'BAD_REQUEST' | 'FORBIDDEN' | 'NOT_FOUND' | 'CONFLICT';

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message: string) {
    super(message);
    this.name = 'DomainError';
    this.code = code;
  }
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('Unknown error');
}
