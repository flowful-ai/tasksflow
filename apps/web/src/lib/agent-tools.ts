/** Labels for the agent / MCP tools, shared by the settings pages and the chat. */
import { AgentToolSchema, type AgentTool } from '@flowtask/shared/types';

export const AGENT_TOOL_LABELS: Record<AgentTool, string> = {
  create_task: 'Create tasks',
  bulk_create_tasks: 'Bulk create tasks',
  update_task: 'Update tasks',
  delete_task: 'Delete tasks',
  query_tasks: 'Query tasks',
  get_task: 'Get task details',
  move_task: 'Move tasks',
  assign_task: 'Assign tasks',
  add_comment: 'Add comments',
  summarize_project: 'Summarize project',
  create_smart_view: 'Create smart views',
  search_tasks: 'Search tasks',
  list_projects: 'List projects',
  list_members: 'List members',
  list_labels: 'List labels',
  list_comments: 'List comments',
  bulk_update_tasks: 'Bulk update tasks',
  list_smart_views: 'List smart views',
  run_smart_view: 'Run smart views',
};

/** Every agent/MCP tool with its label, in AgentToolSchema order (single source for all settings UIs). */
export const AVAILABLE_PERMISSIONS: ReadonlyArray<{ id: AgentTool; label: string }> =
  AgentToolSchema.options.map((id) => ({ id, label: AGENT_TOOL_LABELS[id] }));

/** Narrow a tool name from a model stream to a known tool. */
export function isAgentTool(name: string): name is AgentTool {
  return Object.hasOwn(AGENT_TOOL_LABELS, name);
}

/** Human label of a tool name, or the raw name for unknown (dynamic) tools. */
export function agentToolLabel(name: string): string {
  return isAgentTool(name) ? AGENT_TOOL_LABELS[name] : name;
}
