/** A GitHub repository coordinate. */
export interface GitHubRepoRef {
  owner: string;
  repo: string;
}

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
