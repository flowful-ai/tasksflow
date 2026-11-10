import { getDatabase } from '../../db/index.js';
import {
  AgentLookupService,
  ProjectService,
  TaskService,
  WorkspaceService,
  isUuid,
  parseTaskKey,
  type ProjectWithRelations,
  type TaskDetail,
  type TaskKey,
} from '../../domain/index.js';
import { hasPermission, type WorkspacePermission } from '../../auth/index.js';
import { getAuthz } from '../authorize.js';
import { AgentToolSchema, type AgentTool, type WorkspaceRole } from '@flowtask/shared';
import { ToolExecutionError } from './errors.js';

export interface WorkspaceMemberSummary {
  id: string;
  name: string | null;
  email: string;
  role: string;
}

/** Data access the scoping layer needs. Swappable in tests. */
export interface ToolScopeDeps {
  getProject(projectId: string): Promise<ProjectWithRelations | null>;
  hasProjectAccess(
    project: Pick<ProjectWithRelations, 'id' | 'access'>,
    userId: string,
    role: WorkspaceRole
  ): Promise<boolean>;
  listAccessibleProjects(
    workspaceId: string,
    userId: string,
    role: WorkspaceRole
  ): Promise<ProjectWithRelations[]>;
  getTask(taskId: string): Promise<TaskDetail | null>;
  findTaskIdByKey(workspaceId: string, key: TaskKey): Promise<string | null>;
  listMembers(workspaceId: string): Promise<WorkspaceMemberSummary[]>;
}

export interface ToolContextInput {
  workspaceId: string;
  userId: string;
  role: WorkspaceRole;
  grantedTools: Iterable<string>;
  mcpClientId?: string | null;
}

/**
 * Everything a tool needs to stay inside its tenant: the bound workspace, the
 * caller's role, the granted tools, and the projects the caller can see.
 * Every project/task/user a tool touches is resolved through this object.
 */
export interface ToolContext {
  readonly workspaceId: string;
  readonly userId: string;
  readonly role: WorkspaceRole;
  readonly mcpClientId: string | null;
  readonly grantedTools: ReadonlySet<AgentTool>;
  /** Throws UNKNOWN_TOOL / TOOL_NOT_GRANTED. */
  assertToolGranted(toolName: string): AgentTool;
  /** Throws FORBIDDEN when the caller's workspace role lacks the permission. */
  assertPermission(permission: WorkspacePermission): void;
  can(permission: WorkspacePermission): boolean;
  accessibleProjects(): Promise<ProjectWithRelations[]>;
  /** Always an explicit list: pass it as TaskFilters.projectIds (an empty list matches nothing). */
  accessibleProjectIds(): Promise<string[]>;
  requireProject(projectId: string): Promise<ProjectWithRelations>;
  /** Accepts a task id (uuid) or a task key like "ENG-123". */
  requireTask(taskRef: string): Promise<TaskDetail>;
  /** Accepts "me", a member email or a user id; the user must belong to the workspace. */
  resolveUser(userRef: string): Promise<WorkspaceMemberSummary>;
  members(): Promise<WorkspaceMemberSummary[]>;
}

export function createDefaultToolScopeDeps(): ToolScopeDeps {
  const db = getDatabase();
  const projectService = new ProjectService(db);
  const taskService = new TaskService(db);
  const workspaceService = new WorkspaceService(db);
  const lookupService = new AgentLookupService(db);

  return {
    async getProject(projectId) {
      const result = await projectService.getById(projectId);
      return result.ok ? result.value : null;
    },
    // One ACL rule for routes, MCP and the in-app chat.
    hasProjectAccess: (project, userId, role) => getAuthz().canAccessProject(project, userId, role),
    async listAccessibleProjects(workspaceId, userId, role) {
      const result = await projectService.list({
        filters: { workspaceId, userId, workspaceRole: role, includeArchived: true },
      });
      if (!result.ok) {
        throw result.error;
      }
      return result.value;
    },
    async getTask(taskId) {
      const result = await taskService.getById(taskId);
      return result.ok ? result.value : null;
    },
    findTaskIdByKey: (workspaceId, key) => lookupService.findTaskIdByKey(workspaceId, key),
    async listMembers(workspaceId) {
      const result = await workspaceService.getById(workspaceId);
      if (!result.ok) {
        throw result.error;
      }
      return result.value.members.map((member) => ({
        id: member.user.id,
        name: member.user.name,
        email: member.user.email,
        role: member.role,
      }));
    },
  };
}

let defaultDeps: ToolScopeDeps | null = null;

function getDefaultDeps(): ToolScopeDeps {
  defaultDeps ??= createDefaultToolScopeDeps();
  return defaultDeps;
}

function isAgentTool(value: string): value is AgentTool {
  return AgentToolSchema.safeParse(value).success;
}

function memoize<T>(load: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= load().catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}

export function buildToolContext(
  input: ToolContextInput,
  deps: ToolScopeDeps = getDefaultDeps()
): ToolContext {
  const grantedTools = new Set<AgentTool>();
  for (const tool of input.grantedTools) {
    if (isAgentTool(tool)) {
      grantedTools.add(tool);
    }
  }

  const accessibleProjects = memoize(async () => {
    const projects = await deps.listAccessibleProjects(input.workspaceId, input.userId, input.role);
    // Defence in depth: never trust a project from another workspace even if the lookup returned it.
    return projects.filter((project) => project.workspaceId === input.workspaceId);
  });
  const members = memoize(() => deps.listMembers(input.workspaceId));

  const can = (permission: WorkspacePermission): boolean => hasPermission(input.role, permission);

  const requireProject = async (projectId: string): Promise<ProjectWithRelations> => {
    if (!isUuid(projectId)) {
      throw new ToolExecutionError(
        'projectId must be a project id (uuid) from list_projects',
        'VALIDATION_ERROR'
      );
    }
    const project = await deps.getProject(projectId);
    if (!project || project.workspaceId !== input.workspaceId) {
      throw new ToolExecutionError('Project not found in this workspace', 'NOT_FOUND');
    }
    // Like the routes, a project the caller may not see is reported as not found.
    if (!(await deps.hasProjectAccess(project, input.userId, input.role))) {
      throw new ToolExecutionError('Project not found in this workspace', 'NOT_FOUND');
    }
    return project;
  };

  return {
    workspaceId: input.workspaceId,
    userId: input.userId,
    role: input.role,
    mcpClientId: input.mcpClientId ?? null,
    grantedTools,

    assertToolGranted(toolName) {
      if (!isAgentTool(toolName)) {
        throw new ToolExecutionError(`Tool "${toolName}" not found`, 'UNKNOWN_TOOL');
      }
      if (!grantedTools.has(toolName)) {
        throw new ToolExecutionError(
          `Tool "${toolName}" is not granted to this client`,
          'TOOL_NOT_GRANTED'
        );
      }
      return toolName;
    },

    assertPermission(permission) {
      if (!can(permission)) {
        throw new ToolExecutionError(
          `Your workspace role (${input.role}) does not allow ${permission}`,
          'FORBIDDEN'
        );
      }
    },

    can,
    accessibleProjects,

    async accessibleProjectIds() {
      return (await accessibleProjects()).map((project) => project.id);
    },

    requireProject,

    async requireTask(taskRef) {
      const ref = taskRef.trim();
      let taskId: string | null = null;
      if (isUuid(ref)) {
        taskId = ref;
      } else {
        const key = parseTaskKey(ref);
        if (!key) {
          throw new ToolExecutionError(
            'taskId must be a task id (uuid) or a task key like "ENG-123"',
            'VALIDATION_ERROR'
          );
        }
        taskId = await deps.findTaskIdByKey(input.workspaceId, key);
      }

      const task = taskId ? await deps.getTask(taskId) : null;
      if (!task || task.deletedAt) {
        throw new ToolExecutionError(`Task ${ref} not found`, 'NOT_FOUND');
      }

      try {
        await requireProject(task.projectId);
      } catch (error) {
        if (error instanceof ToolExecutionError && error.code === 'NOT_FOUND') {
          // Same message as a missing task: do not reveal tasks of other workspaces.
          throw new ToolExecutionError(`Task ${ref} not found`, 'NOT_FOUND');
        }
        throw error;
      }
      return task;
    },

    async resolveUser(userRef) {
      const ref = userRef.trim();
      const all = await members();
      let member: WorkspaceMemberSummary | undefined;
      if (ref.toLowerCase() === 'me') {
        member = all.find((candidate) => candidate.id === input.userId);
      } else if (ref.includes('@')) {
        const email = ref.toLowerCase();
        member = all.find((candidate) => candidate.email.toLowerCase() === email);
      } else if (isUuid(ref)) {
        member = all.find((candidate) => candidate.id === ref);
      } else {
        throw new ToolExecutionError(
          `${JSON.stringify(ref)} is not a user reference; use "me", an email or a user id from list_members`,
          'VALIDATION_ERROR'
        );
      }
      if (!member) {
        throw new ToolExecutionError(`User ${ref} is not a member of this workspace`, 'NOT_FOUND');
      }
      return member;
    },

    members,
  };
}
