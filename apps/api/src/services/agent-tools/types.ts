import { getDatabase } from '../../db/index.js';
import { CommentService, SmartViewService, TaskService } from '../../domain/index.js';
import { TaskGitHubLinkService } from '../task-github-link-service.js';
import type { ToolContext } from '../../lib/mcp/tool-context.js';
import type { JsonRecord } from '../../lib/mcp/json-schema-zod.js';
import type { ToolOutput } from '../../lib/mcp/response-shaping.js';

/** Services the tool handlers use, narrowed so tests can pass fakes. */
export interface ToolServices {
  tasks: Pick<
    TaskService,
    | 'create'
    | 'getById'
    | 'update'
    | 'move'
    | 'delete'
    | 'list'
    | 'addAssignee'
    | 'removeAssignee'
    | 'addLabel'
    | 'removeLabel'
  >;
  comments: Pick<CommentService, 'create' | 'list'>;
  smartViews: Pick<SmartViewService, 'create' | 'getById' | 'list'>;
  githubLinks: Pick<TaskGitHubLinkService, 'linkPr'>;
  /**
   * Run task writes in one transaction (TaskService.transaction): all of them
   * commit or none do, and their domain events are emitted after commit.
   */
  withTaskTransaction<T>(fn: (tasks: ToolServices['tasks']) => Promise<T>): Promise<T>;
}

export type ToolHandler = (
  args: JsonRecord,
  ctx: ToolContext,
  services: ToolServices
) => Promise<ToolOutput>;

let defaultServices: ToolServices | null = null;

export function getDefaultToolServices(): ToolServices {
  if (!defaultServices) {
    const db = getDatabase();
    defaultServices = {
      tasks: new TaskService(db),
      comments: new CommentService(db),
      smartViews: new SmartViewService(db),
      githubLinks: new TaskGitHubLinkService(db),
      withTaskTransaction: (fn) => TaskService.transaction(db, (tasks) => fn(tasks)),
    };
  }
  return defaultServices;
}
