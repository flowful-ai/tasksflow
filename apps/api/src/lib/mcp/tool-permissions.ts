import type { WorkspacePermission } from '../../auth/index.js';
import type { AgentTool } from '@flowtask/shared';

/**
 * Workspace permission each tool requires. Exhaustive by type, so a new tool
 * cannot ship without a permission. Handlers add finer checks (e.g. assigning
 * someone else during create/update also requires task:assign).
 */
export const TOOL_PERMISSIONS: Record<AgentTool, WorkspacePermission> = {
  create_task: 'task:create',
  bulk_create_tasks: 'task:create',
  update_task: 'task:update',
  bulk_update_tasks: 'task:update',
  delete_task: 'task:delete',
  query_tasks: 'task:read',
  get_task: 'task:read',
  search_tasks: 'task:read',
  move_task: 'task:update',
  assign_task: 'task:assign',
  add_comment: 'comment:create',
  list_comments: 'comment:read',
  summarize_project: 'project:read',
  list_projects: 'project:read',
  list_labels: 'project:read',
  list_members: 'workspace:read',
  create_smart_view: 'smart_view:create',
  list_smart_views: 'smart_view:read',
  run_smart_view: 'smart_view:read',
};
