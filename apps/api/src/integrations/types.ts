/** A GitHub repository coordinate. */
export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

/**
 * Realtime publisher injected by the API (apps/api/src/sse/manager.ts `publishEvent`),
 * so integration-driven task writes update boards live.
 */
export type PublishRealtimeEvent = (workspaceId: string, event: string, data: object) => void;

/**
 * Task notification data for external services.
 */
export interface TaskNotification {
  taskId: string;
  taskTitle: string;
  taskUrl: string;
  projectName: string;
  /** e.g. "FLOW-123" */
  taskKey: string;
  action: 'created' | 'state_changed' | 'assigned' | 'commented' | 'completed' | 'updated';
  actorName?: string;
  details?: string;
}
