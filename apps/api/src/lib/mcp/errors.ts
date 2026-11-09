export type ToolErrorCode =
  | 'VALIDATION_ERROR'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'UNKNOWN_TOOL'
  | 'TOOL_NOT_GRANTED'
  | 'CONFLICT'
  | 'DOMAIN_ERROR'
  | 'GITHUB_ERROR'
  | 'INTERNAL_ERROR';

const STATUS_BY_CODE: Record<ToolErrorCode, 400 | 403 | 404 | 409 | 500> = {
  VALIDATION_ERROR: 400,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  UNKNOWN_TOOL: 404,
  TOOL_NOT_GRANTED: 403,
  CONFLICT: 409,
  DOMAIN_ERROR: 400,
  GITHUB_ERROR: 400,
  INTERNAL_ERROR: 500,
};

/**
 * An error whose message is safe and useful to show to the model verbatim
 * (validation, permission, not-found, and domain rule violations).
 */
export class ToolExecutionError extends Error {
  public readonly status: 400 | 403 | 404 | 409 | 500;

  constructor(
    message: string,
    public readonly code: ToolErrorCode
  ) {
    super(message);
    this.name = 'ToolExecutionError';
    this.status = STATUS_BY_CODE[code];
  }
}

export const GENERIC_TOOL_ERROR_MESSAGE = 'Tool execution failed due to an internal error';

/**
 * Database driver errors leak SQL and schema details; everything else a
 * domain service returns in a Result is a rule violation worth showing.
 */
export function isDatabaseError(error: Error): boolean {
  return (
    error.name === 'PostgresError' ||
    error.message.startsWith('Failed query') ||
    ('severity' in error && 'routine' in error) ||
    (error.cause instanceof Error && isDatabaseError(error.cause))
  );
}

/** Converts a failed domain Result into a model-visible error, hiding driver errors. */
export function fromDomainError(error: Error): ToolExecutionError {
  if (error instanceof ToolExecutionError) {
    return error;
  }
  if (isDatabaseError(error)) {
    console.error('Agent tool database error', error.message);
    return new ToolExecutionError(GENERIC_TOOL_ERROR_MESSAGE, 'INTERNAL_ERROR');
  }
  if (/not found/i.test(error.message)) {
    return new ToolExecutionError(error.message, 'NOT_FOUND');
  }
  return new ToolExecutionError(error.message, 'DOMAIN_ERROR');
}

export interface ToolErrorPayload {
  code: ToolErrorCode;
  message: string;
}

/**
 * Final classification at the tool boundary: expected errors keep their
 * message, anything else becomes a generic message (logged server-side).
 */
export function toToolErrorPayload(error: unknown, toolName: string): ToolErrorPayload {
  if (error instanceof ToolExecutionError) {
    return { code: error.code, message: error.message };
  }
  console.error(`Agent tool "${toolName}" failed unexpectedly`, error instanceof Error ? error.stack ?? error.message : error);
  return { code: 'INTERNAL_ERROR', message: GENERIC_TOOL_ERROR_MESSAGE };
}
