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
