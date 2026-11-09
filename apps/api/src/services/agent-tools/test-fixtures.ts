/**
 * In-memory fakes for agent tool tests (two workspaces, an ACL-restricted
 * project). Not imported by production code.
 */
import type {
  ProjectWithRelations,
  TaskFilters,
  TaskListOptions,
  TaskWithRelations,
} from '../../domain/index.js';
import { err, ok, type WorkspaceRole } from '@flowtask/shared';
import type { ToolScopeDeps, WorkspaceMemberSummary } from '../../lib/mcp/tool-context.js';
import type { ToolServices } from './types.js';

export const WS_A = '00000000-0000-4000-8000-00000000000a';
export const WS_B = '00000000-0000-4000-8000-00000000000b';
export const USER_ADMIN = '00000000-0000-4000-8000-000000000001';
export const USER_MEMBER = '00000000-0000-4000-8000-000000000002';
export const USER_OTHER_WS = '00000000-0000-4000-8000-000000000003';
export const PROJECT_A = '00000000-0000-4000-8000-0000000000a1';
export const PROJECT_A_ADMIN_ONLY = '00000000-0000-4000-8000-0000000000a2';
export const PROJECT_B = '00000000-0000-4000-8000-0000000000b1';
export const STATE_A_TODO = '00000000-0000-4000-8000-0000000a1001';
export const STATE_A_DOING = '00000000-0000-4000-8000-0000000a1002';
export const STATE_B_TODO = '00000000-0000-4000-8000-0000000b1001';

const created = new Date('2026-11-01T00:00:00.000Z');

function project(
  id: string,
  workspaceId: string,
  identifier: string,
  access: 'all' | 'admin',
  states: ProjectWithRelations['taskStates']
): ProjectWithRelations {
  return {
    id,
    workspaceId,
    name: `Project ${identifier}`,
    identifier,
    description: null,
    icon: null,
    access,
    isArchived: false,
    createdBy: null,
    createdAt: created,
    updatedAt: created,
    taskStates: states,
    labels: [{ id: `${id.slice(0, -4)}1abe`, projectId: id, name: 'bug', color: '#f00' }],
    integrations: [],
    taskCount: 1,
    nextTaskSeq: 2,
  };
}

function state(id: string, projectId: string, name: string, category: string, position: string) {
  return { id, projectId, name, category, position, color: '#fff' };
}

export const PROJECTS: ProjectWithRelations[] = [
  project(PROJECT_A, WS_A, 'ENG', 'all', [
    state(STATE_A_TODO, PROJECT_A, 'Todo', 'backlog', 'a0'),
    state(STATE_A_DOING, PROJECT_A, 'In Progress', 'in_progress', 'a1'),
  ]),
  project(PROJECT_A_ADMIN_ONLY, WS_A, 'SEC', 'admin', []),
  project(PROJECT_B, WS_B, 'OPS', 'all', [state(STATE_B_TODO, PROJECT_B, 'Todo', 'backlog', 'a0')]),
];

export function task(
  id: string,
  projectId: string,
  sequenceNumber: number,
  stateId: string,
  position: string
): TaskWithRelations {
  const owner = PROJECTS.find((candidate) => candidate.id === projectId);
  return {
    id,
    projectId,
    stateId,
    sequenceNumber,
    title: `Task ${sequenceNumber}`,
    description: null,
    priority: null,
    position,
    dueDate: null,
    startDate: null,
    createdBy: null,
    agentId: null,
    createdAt: created,
    updatedAt: created,
    deletedAt: null,
    completedAt: null,
    state: null,
    project: { id: projectId, identifier: owner?.identifier ?? 'X', name: owner?.name ?? 'X' },
    assignees: [],
    labels: [],
    agent: null,
    externalLinks: [],
  };
}

export const TASK_A1 = '00000000-0000-4000-8000-00000000a001';
export const TASK_A2 = '00000000-0000-4000-8000-00000000a002';
export const TASK_SECRET = '00000000-0000-4000-8000-00000000a003';
export const TASK_B1 = '00000000-0000-4000-8000-00000000b001';

export function createTasks(): TaskWithRelations[] {
  return [
    task(TASK_A1, PROJECT_A, 1, STATE_A_TODO, 'a0'),
    task(TASK_A2, PROJECT_A, 2, STATE_A_DOING, 'a5'),
    task(TASK_SECRET, PROJECT_A_ADMIN_ONLY, 1, STATE_A_TODO, 'a0'),
    task(TASK_B1, PROJECT_B, 1, STATE_B_TODO, 'a0'),
  ];
}

const MEMBERS: Record<string, WorkspaceMemberSummary[]> = {
  [WS_A]: [
    { id: USER_ADMIN, name: 'Ada Admin', email: 'ada@example.com', role: 'admin' },
    { id: USER_MEMBER, name: 'Max Member', email: 'max@example.com', role: 'member' },
  ],
  [WS_B]: [{ id: USER_OTHER_WS, name: 'Olga Other', email: 'olga@example.com', role: 'owner' }],
};

export function createScopeDeps(tasks: TaskWithRelations[] = createTasks()): ToolScopeDeps {
  const canSee = (projectId: string, role: WorkspaceRole) => {
    const target = PROJECTS.find((candidate) => candidate.id === projectId);
    return Boolean(target) && (role !== 'member' || target?.access === 'all');
  };
  return {
    getProject: async (projectId) =>
      PROJECTS.find((candidate) => candidate.id === projectId) ?? null,
    hasProjectAccess: async (project, _userId, role) => canSee(project.id, role),
    listAccessibleProjects: async (workspaceId, _userId, role) =>
      PROJECTS.filter(
        (candidate) => candidate.workspaceId === workspaceId && canSee(candidate.id, role)
      ),
    getTask: async (taskId) => tasks.find((candidate) => candidate.id === taskId) ?? null,
    findTaskIdByKey: async (workspaceId, key) => {
      const owner = PROJECTS.find(
        (candidate) =>
          candidate.workspaceId === workspaceId && candidate.identifier === key.identifier
      );
      return (
        tasks.find(
          (candidate) =>
            candidate.projectId === owner?.id && candidate.sequenceNumber === key.sequenceNumber
        )?.id ?? null
      );
    },
    listMembers: async (workspaceId) => MEMBERS[workspaceId] ?? [],
  };
}

export interface RecordedCalls {
  list: TaskListOptions[];
  move: Array<{ taskId: string; stateId: string }>;
  delete: string[];
  addAssignee: Array<{ taskId: string; userId: string }>;
  published: string[];
}

function matches(candidate: TaskWithRelations, filters: TaskFilters): boolean {
  if (filters.projectIds && !filters.projectIds.includes(candidate.projectId)) return false;
  if (filters.projectId && candidate.projectId !== filters.projectId) return false;
  if (filters.stateId && candidate.stateId !== filters.stateId) return false;
  if (filters.search && !candidate.title.includes(filters.search)) return false;
  return !candidate.deletedAt;
}

/** Fake services that behave like TaskService.list regarding projectIds (undefined = every workspace). */
export function createServices(tasks: TaskWithRelations[] = createTasks()): {
  services: ToolServices;
  calls: RecordedCalls;
} {
  const calls: RecordedCalls = { list: [], move: [], delete: [], addAssignee: [], published: [] };
  const byId = (taskId: string) => tasks.find((candidate) => candidate.id === taskId);
  const unsupported = async () => err(new Error('not supported in this fake'));

  const services: ToolServices = {
    tasks: {
      create: unsupported,
      update: async (taskId) => {
        const found = byId(taskId);
        return found ? ok(found) : err(new Error('Task not found'));
      },
      getById: async (taskId) => {
        const found = byId(taskId);
        return found ? ok(found) : err(new Error('Task not found'));
      },
      list: async (options = {}) => {
        calls.list.push(options);
        const filters = options.filters ?? {};
        let rows = tasks.filter((candidate) => matches(candidate, filters));
        if (options.sortBy === 'position') {
          rows = [...rows].sort((a, b) => (a.position < b.position ? -1 : 1));
          if (options.sortOrder === 'desc') rows.reverse();
        }
        const limit = options.limit ?? 50;
        const page = options.page ?? 1;
        return ok({ tasks: rows.slice((page - 1) * limit, page * limit), total: rows.length });
      },
      move: async (taskId, input) => {
        calls.move.push({ taskId, stateId: input.stateId });
        const found = byId(taskId);
        return found ? ok({ ...found, stateId: input.stateId }) : err(new Error('Task not found'));
      },
      delete: async (taskId) => {
        calls.delete.push(taskId);
        return ok(undefined);
      },
      addAssignee: async (taskId, userId) => {
        calls.addAssignee.push({ taskId, userId });
        return ok(undefined);
      },
      removeAssignee: async () => ok(undefined),
      addLabel: async () => ok(undefined),
      removeLabel: async () => ok(undefined),
    },
    comments: { create: unsupported, list: async () => ok({ comments: [], total: 0 }) },
    smartViews: { create: unsupported, getById: unsupported, list: async () => ok([]) },
    githubLinks: {
      linkPr: async () => {
        throw new Error('not supported in this fake');
      },
    },
    publish: (_workspaceId, event) => {
      calls.published.push(event);
    },
    withTaskTransaction(fn) {
      return fn(this.tasks);
    },
  };

  return { services, calls };
}
