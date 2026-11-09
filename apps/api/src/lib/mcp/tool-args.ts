import { ToolExecutionError } from './errors.js';
import type { JsonRecord, JsonValue } from './json-schema-zod.js';

/**
 * Typed readers for tool arguments. Arguments are validated against the tool's
 * JSON Schema before a handler runs, so these only narrow types (no casts);
 * a mismatch here means the schema and handler disagree.
 */

function schemaMismatch(key: string, expected: string): ToolExecutionError {
  return new ToolExecutionError(`${key} must be ${expected}`, 'VALIDATION_ERROR');
}

export function optionalString(args: JsonRecord, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw schemaMismatch(key, 'a string');
  return value;
}

export function requiredString(args: JsonRecord, key: string): string {
  const value = optionalString(args, key);
  if (value === undefined || value.trim() === '') {
    throw new ToolExecutionError(`${key} is required`, 'VALIDATION_ERROR');
  }
  return value;
}

/** undefined = not provided, null = explicitly cleared. */
export function nullableString(args: JsonRecord, key: string): string | null | undefined {
  const value = args[key];
  if (value === undefined || value === null) return value;
  if (typeof value !== 'string') throw schemaMismatch(key, 'a string or null');
  return value;
}

export function optionalBoolean(args: JsonRecord, key: string): boolean | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') throw schemaMismatch(key, 'a boolean');
  return value;
}

export function optionalInteger(args: JsonRecord, key: string): number | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value)) throw schemaMismatch(key, 'an integer');
  return value;
}

export function optionalStringArray(args: JsonRecord, key: string): string[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw schemaMismatch(key, 'an array of strings');
  return value.map((entry) => {
    if (typeof entry !== 'string') throw schemaMismatch(key, 'an array of strings');
    return entry;
  });
}

export function optionalRecordArray(args: JsonRecord, key: string): JsonRecord[] | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw schemaMismatch(key, 'an array of objects');
  return value.map((entry) => {
    if (!isRecord(entry)) throw schemaMismatch(key, 'an array of objects');
    return entry;
  });
}

export function optionalRecord(args: JsonRecord, key: string): JsonRecord | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw schemaMismatch(key, 'an object');
  return value;
}

function isRecord(value: JsonValue | undefined): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const TASK_PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
export type ToolTaskPriority = (typeof TASK_PRIORITIES)[number];

export function optionalPriority(args: JsonRecord, key = 'priority'): ToolTaskPriority | undefined {
  const value = optionalString(args, key);
  if (value === undefined) return undefined;
  const match = TASK_PRIORITIES.find((priority) => priority === value);
  if (!match) throw schemaMismatch(key, `one of ${TASK_PRIORITIES.join(', ')}`);
  return match;
}

/**
 * Parses a due date given as YYYY-MM-DD (stored as midnight UTC) or an ISO
 * 8601 datetime.
 */
export function parseDueDate(value: string, key = 'dueDate'): Date {
  const trimmed = value.trim();
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  const parsed = new Date(dateOnly ? `${trimmed}T00:00:00.000Z` : trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new ToolExecutionError(`${key} must be YYYY-MM-DD or an ISO 8601 datetime`, 'VALIDATION_ERROR');
  }
  return parsed;
}

export type McpTaskView = 'compact' | 'full' | 'custom';
export type McpWriteReturnMode = 'ack' | 'compact' | 'full';

const TASK_VIEW_VALUES: readonly McpTaskView[] = ['compact', 'full', 'custom'];
const WRITE_RETURN_VALUES: readonly McpWriteReturnMode[] = ['ack', 'compact', 'full'];

export interface McpTaskViewArgs {
  view: McpTaskView;
  fields?: string[];
  includeAssignees: boolean;
  includeLabels: boolean;
  includeExternalLinks: boolean;
}

export function resolveMcpTaskViewArgs(args: JsonRecord): McpTaskViewArgs {
  const rawView = optionalString(args, 'view');
  const view = TASK_VIEW_VALUES.find((candidate) => candidate === (rawView ?? 'compact'));
  if (!view) {
    throw new ToolExecutionError('view must be one of: compact, full, custom', 'VALIDATION_ERROR');
  }

  const rawFields = optionalStringArray(args, 'fields');
  let fields: string[] | undefined;
  if (rawFields !== undefined) {
    fields = Array.from(new Set(rawFields.map((field) => field.trim()).filter(Boolean)));
    if (fields.length === 0) {
      throw new ToolExecutionError('fields must contain at least one field', 'VALIDATION_ERROR');
    }
  }

  if (view === 'custom' && !fields) {
    throw new ToolExecutionError('fields is required when view is custom', 'VALIDATION_ERROR');
  }

  if (view !== 'custom' && fields) {
    throw new ToolExecutionError('fields is only supported when view is custom', 'VALIDATION_ERROR');
  }

  return {
    view,
    fields,
    includeAssignees: optionalBoolean(args, 'includeAssignees') ?? false,
    includeLabels: optionalBoolean(args, 'includeLabels') ?? false,
    includeExternalLinks: optionalBoolean(args, 'includeExternalLinks') ?? false,
  };
}

export function resolveMcpWriteReturnMode(args: JsonRecord): McpWriteReturnMode {
  const rawReturn = optionalString(args, 'return') ?? 'ack';
  const mode = WRITE_RETURN_VALUES.find((candidate) => candidate === rawReturn.trim());
  if (!mode) {
    throw new ToolExecutionError('return must be one of: ack, compact, full', 'VALIDATION_ERROR');
  }
  return mode;
}

export interface UpdateTaskGitHubPrArgs {
  owner: string;
  repo: string;
  prNumber: number;
}

export function resolveUpdateTaskGitHubPrArgs(args: JsonRecord): UpdateTaskGitHubPrArgs | null {
  const rawOwner = args.githubPrOwner;
  const rawRepo = args.githubPrRepo;
  const rawPrNumber = args.githubPrNumber;

  if (rawOwner === undefined && rawRepo === undefined && rawPrNumber === undefined) {
    return null;
  }

  if (typeof rawOwner !== 'string' || !rawOwner.trim()) {
    throw new ToolExecutionError('githubPrOwner is required when linking a pull request', 'VALIDATION_ERROR');
  }

  if (typeof rawRepo !== 'string' || !rawRepo.trim()) {
    throw new ToolExecutionError('githubPrRepo is required when linking a pull request', 'VALIDATION_ERROR');
  }

  if (typeof rawPrNumber !== 'number' || !Number.isInteger(rawPrNumber) || rawPrNumber <= 0) {
    throw new ToolExecutionError(
      'githubPrNumber must be a positive integer when linking a pull request',
      'VALIDATION_ERROR'
    );
  }

  return {
    owner: rawOwner.trim(),
    repo: rawRepo.trim(),
    prNumber: rawPrNumber,
  };
}
