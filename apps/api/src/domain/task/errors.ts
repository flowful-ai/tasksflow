/**
 * Typed errors returned (inside Result.err) by TaskService and the other task
 * services. Routes can map `code` to a response and `status` to an HTTP code.
 */
export type TaskErrorCode =
  | 'TASK_NOT_FOUND'
  | 'PROJECT_NOT_FOUND'
  | 'INVALID_STATE'
  | 'INVALID_LABEL'
  | 'INVALID_ASSIGNEE'
  | 'INVALID_PARENT'
  | 'PARENT_CYCLE'
  | 'INVALID_NEIGHBOR'
  | 'INVALID_RELATION'
  | 'RELATION_EXISTS'
  | 'RELATION_NOT_FOUND'
  | 'MISSING_SCOPE'
  | 'NOT_DELETED'
  | 'INVALID_INPUT';

const STATUS: Record<TaskErrorCode, 400 | 404 | 409> = {
  TASK_NOT_FOUND: 404,
  PROJECT_NOT_FOUND: 404,
  INVALID_STATE: 400,
  INVALID_LABEL: 400,
  INVALID_ASSIGNEE: 400,
  INVALID_PARENT: 400,
  PARENT_CYCLE: 400,
  INVALID_NEIGHBOR: 400,
  INVALID_RELATION: 400,
  RELATION_EXISTS: 409,
  RELATION_NOT_FOUND: 404,
  MISSING_SCOPE: 400,
  NOT_DELETED: 409,
  INVALID_INPUT: 400,
};

export class TaskError extends Error {
  readonly code: TaskErrorCode;
  readonly status: 400 | 404 | 409;
  /** Offending ids, when relevant (e.g. the label ids that are not in the project). */
  readonly ids: readonly string[];

  constructor(code: TaskErrorCode, message: string, ids: readonly string[] = []) {
    super(message);
    this.name = 'TaskError';
    this.code = code;
    this.status = STATUS[code];
    this.ids = ids;
  }
}

export function isTaskError(error: Error): error is TaskError {
  return error instanceof TaskError;
}

/** Normalise anything caught into an Error (TaskError passes through). */
export { toError } from '../workspace/errors.js';
