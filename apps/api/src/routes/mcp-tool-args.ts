export function resolveQueryTasksAssigneeId(args: Record<string, unknown>, currentUserId: string): string | undefined {
  if (args.assignedId !== undefined) {
    throw new Error('assignedId is not supported. Use assigneeId.');
  }

  const assigneeId = args.assigneeId;
  if (assigneeId === undefined || assigneeId === null) {
    return undefined;
  }

  if (typeof assigneeId !== 'string') {
    throw new Error('assigneeId must be a string');
  }

  const normalized = assigneeId.trim();
  if (!normalized) {
    return undefined;
  }

  return normalized.toLowerCase() === 'me' ? currentUserId : normalized;
}

export type McpTaskView = 'compact' | 'full' | 'custom';
export type McpWriteReturnMode = 'ack' | 'compact' | 'full';

const TASK_VIEW_VALUES: McpTaskView[] = ['compact', 'full', 'custom'];
const WRITE_RETURN_VALUES: McpWriteReturnMode[] = ['ack', 'compact', 'full'];

function normalizeStringArrayArg(value: unknown, fieldName: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldName} must be an array of strings`);
  }

  const normalized = value.map((entry) => {
    if (typeof entry !== 'string') {
      throw new Error(`${fieldName} must be an array of strings`);
    }
    return entry.trim();
  }).filter(Boolean);

  if (normalized.length === 0) {
    throw new Error(`${fieldName} must contain at least one field`);
  }

  return Array.from(new Set(normalized));
}

function normalizeBooleanArg(value: unknown, fieldName: string): boolean {
  if (value === undefined) {
    return false;
  }

  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'string') {
    if (value === 'true') {
      return true;
    }
    if (value === 'false') {
      return false;
    }
  }

  throw new Error(`${fieldName} must be a boolean`);
}

export function resolveMcpTaskViewArgs(args: Record<string, unknown>): {
  view: McpTaskView;
  fields?: string[];
  includeAssignees: boolean;
  includeLabels: boolean;
  includeExternalLinks: boolean;
} {
  const rawView = args.view;
  const view = rawView === undefined ? 'compact' : String(rawView).trim() as McpTaskView;
  if (!TASK_VIEW_VALUES.includes(view)) {
    throw new Error('view must be one of: compact, full, custom');
  }

  const rawFields = args.fields;
  let fields: string[] | undefined;
  if (rawFields !== undefined) {
    fields = normalizeStringArrayArg(rawFields, 'fields');
  }

  if (view === 'custom' && (!fields || fields.length === 0)) {
    throw new Error('fields is required when view is custom');
  }

  if (view !== 'custom' && fields) {
    throw new Error('fields is only supported when view is custom');
  }

  return {
    view,
    fields,
    includeAssignees: normalizeBooleanArg(args.includeAssignees, 'includeAssignees'),
    includeLabels: normalizeBooleanArg(args.includeLabels, 'includeLabels'),
    includeExternalLinks: normalizeBooleanArg(args.includeExternalLinks, 'includeExternalLinks'),
  };
}

export function resolveMcpWriteReturnMode(args: Record<string, unknown>): McpWriteReturnMode {
  const rawReturn = args.return;
  if (rawReturn === undefined) {
    return 'ack';
  }

  const mode = String(rawReturn).trim() as McpWriteReturnMode;
  if (!WRITE_RETURN_VALUES.includes(mode)) {
    throw new Error('return must be one of: ack, compact, full');
  }

  return mode;
}

export function resolveMcpLimit(args: Record<string, unknown>, options?: { defaultLimit?: number; maxLimit?: number }): number {
  const defaultLimit = options?.defaultLimit ?? 10;
  const maxLimit = options?.maxLimit ?? 50;
  const rawLimit = args.limit;

  if (rawLimit === undefined || rawLimit === null || rawLimit === '') {
    return defaultLimit;
  }

  const parsed =
    typeof rawLimit === 'number'
      ? rawLimit
      : typeof rawLimit === 'string'
        ? Number.parseInt(rawLimit, 10)
        : Number.NaN;

  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || parsed <= 0) {
    return defaultLimit;
  }

  return Math.min(Math.trunc(parsed), maxLimit);
}

export interface UpdateTaskGitHubPrArgs {
  owner: string;
  repo: string;
  prNumber: number;
}

export function resolveUpdateTaskGitHubPrArgs(args: Record<string, unknown>): UpdateTaskGitHubPrArgs | null {
  const rawOwner = args.githubPrOwner;
  const rawRepo = args.githubPrRepo;
  const rawPrNumber = args.githubPrNumber;

  const hasAnyInput =
    rawOwner !== undefined ||
    rawRepo !== undefined ||
    rawPrNumber !== undefined;

  if (!hasAnyInput) {
    return null;
  }

  if (typeof rawOwner !== 'string' || !rawOwner.trim()) {
    throw new Error('githubPrOwner is required when linking a pull request');
  }

  if (typeof rawRepo !== 'string' || !rawRepo.trim()) {
    throw new Error('githubPrRepo is required when linking a pull request');
  }

  const parsedNumber =
    typeof rawPrNumber === 'number'
      ? rawPrNumber
      : typeof rawPrNumber === 'string'
        ? Number(rawPrNumber)
        : Number.NaN;

  if (!Number.isInteger(parsedNumber) || parsedNumber <= 0) {
    throw new Error('githubPrNumber must be a positive integer when linking a pull request');
  }

  return {
    owner: rawOwner.trim(),
    repo: rawRepo.trim(),
    prNumber: parsedNumber,
  };
}
