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
