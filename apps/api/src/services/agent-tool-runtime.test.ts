import { describe, expect, it } from 'bun:test';
import { AGENT_TOOLS, type ToolParameterSchema } from '../domain/index.js';
import { AgentToolSchema, type AgentTool, type WorkspaceRole } from '@flowtask/shared';
import { buildToolContext } from '../lib/mcp/tool-context.js';
import { ToolExecutionError, type ToolErrorCode } from '../lib/mcp/errors.js';
import { TOOL_PERMISSIONS } from '../lib/mcp/tool-permissions.js';
import { buildAiSdkTools, executeAgentTool, runAgentTool } from './agent-tool-runtime.js';
import {
  PROJECT_A,
  PROJECT_A_ADMIN_ONLY,
  PROJECT_B,
  STATE_A_DOING,
  STATE_A_TODO,
  TASK_A1,
  TASK_A2,
  TASK_B1,
  TASK_SECRET,
  USER_ADMIN,
  USER_MEMBER,
  USER_OTHER_WS,
  WS_A,
  createScopeDeps,
  createServices,
} from './agent-tools/test-fixtures.js';

const ALL_TOOLS: AgentTool[] = [...AgentToolSchema.options];

function contextFor(role: WorkspaceRole, userId = role === 'member' ? USER_MEMBER : USER_ADMIN, grantedTools: AgentTool[] = ALL_TOOLS) {
  return buildToolContext({ workspaceId: WS_A, userId, role, grantedTools }, createScopeDeps());
}

function taskIds(output: Record<string, unknown>): string[] {
  const list = output.tasks;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: unknown) =>
    typeof entry === 'object' && entry !== null && 'id' in entry && typeof entry.id === 'string' ? [entry.id] : []
  );
}

async function expectToolError(promise: Promise<unknown>, code: ToolErrorCode, message?: string | RegExp) {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught
  );
  expect(error).toBeInstanceOf(ToolExecutionError);
  if (error instanceof ToolExecutionError) {
    expect(error.code).toBe(code);
    if (message) expect(error.message).toMatch(message);
  }
}

describe('tenant scoping (buildToolContext)', () => {
  it('query_tasks without projectId only lists accessible projects of the bound workspace', async () => {
    const { services, calls } = createServices();
    const result = await executeAgentTool('query_tasks', {}, contextFor('admin'), services);

    // The old runtime passed no projectIds here, so TaskService.list returned every workspace's tasks.
    expect(calls.list[0]?.filters?.projectIds?.sort()).toEqual([PROJECT_A, PROJECT_A_ADMIN_ONLY].sort());
    const ids = taskIds(result);
    expect(ids).not.toContain(TASK_B1);
    expect(ids.sort()).toEqual([TASK_A1, TASK_A2, TASK_SECRET].sort());
  });

  it('search_tasks without projectId respects the project ACL for members', async () => {
    const { services, calls } = createServices();
    const result = await executeAgentTool('search_tasks', { query: 'Task' }, contextFor('member'), services);

    expect(calls.list[0]?.filters?.projectIds).toEqual([PROJECT_A]);
    const ids = taskIds(result);
    expect(ids).not.toContain(TASK_SECRET);
    expect(ids).not.toContain(TASK_B1);
  });

  it('rejects a project from another workspace as not found', async () => {
    const { services } = createServices();
    await expectToolError(
      executeAgentTool('query_tasks', { projectId: PROJECT_B }, contextFor('owner'), services),
      'NOT_FOUND',
      'Project not found in this workspace'
    );
  });

  it('rejects a task from another workspace without revealing it', async () => {
    const { services } = createServices();
    await expectToolError(executeAgentTool('get_task', { taskId: TASK_B1 }, contextFor('owner'), services), 'NOT_FOUND', /not found/);
    await expectToolError(executeAgentTool('delete_task', { taskId: TASK_B1 }, contextFor('owner'), services), 'NOT_FOUND');
  });

  it('rejects tasks in ACL-restricted projects for members', async () => {
    const { services } = createServices();
    await expectToolError(executeAgentTool('get_task', { taskId: TASK_SECRET }, contextFor('member'), services), 'FORBIDDEN');
  });

  it('only resolves users that belong to the bound workspace', async () => {
    const ctx = contextFor('admin');
    expect((await ctx.resolveUser('me')).id).toBe(USER_ADMIN);
    expect((await ctx.resolveUser('MAX@example.com')).id).toBe(USER_MEMBER);
    expect((await ctx.resolveUser(USER_MEMBER)).email).toBe('max@example.com');
    await expectToolError(ctx.resolveUser(USER_OTHER_WS), 'NOT_FOUND');
    await expectToolError(ctx.resolveUser('olga@example.com'), 'NOT_FOUND');
    await expectToolError(ctx.resolveUser('Olga'), 'VALIDATION_ERROR');
  });
});

describe('task key resolution', () => {
  it('accepts ENG-2 style keys (case-insensitive) wherever a taskId is accepted', async () => {
    const { services } = createServices();
    const result = await executeAgentTool('get_task', { taskId: 'eng-2' }, contextFor('admin'), services);
    expect(result.task).toMatchObject({ id: TASK_A2, key: 'ENG-2' });
  });

  it('does not resolve keys of another workspace', async () => {
    const { services } = createServices();
    await expectToolError(executeAgentTool('get_task', { taskId: 'OPS-1' }, contextFor('admin'), services), 'NOT_FOUND');
  });

  it('rejects refs that are neither ids nor keys', async () => {
    const { services } = createServices();
    await expectToolError(
      executeAgentTool('get_task', { taskId: 'the login bug' }, contextFor('admin'), services),
      'VALIDATION_ERROR',
      /task key like/
    );
  });
});

describe('per-tool role permissions', () => {
  it('maps every tool to a permission', () => {
    expect(Object.keys(TOOL_PERMISSIONS).sort()).toEqual([...ALL_TOOLS].sort());
  });

  it('forbids members from deleting tasks (in-app chat used to allow it)', async () => {
    const { services, calls } = createServices();
    await expectToolError(
      executeAgentTool('delete_task', { taskId: TASK_A1 }, contextFor('member'), services),
      'FORBIDDEN',
      /task:delete/
    );
    expect(calls.delete).toEqual([]);
  });

  it('forbids members from assigning tasks', async () => {
    const { services } = createServices();
    await expectToolError(
      executeAgentTool('assign_task', { taskId: TASK_A1, userId: 'ada@example.com', action: 'assign' }, contextFor('member'), services),
      'FORBIDDEN'
    );
  });

  it('allows admins to delete and assign', async () => {
    const { services, calls } = createServices();
    await executeAgentTool('delete_task', { taskId: 'ENG-1' }, contextFor('admin'), services);
    await executeAgentTool('assign_task', { taskId: TASK_A1, userId: 'max@example.com', action: 'assign' }, contextFor('admin'), services);
    expect(calls.delete).toEqual([TASK_A1]);
    expect(calls.addAssignee).toEqual([{ taskId: TASK_A1, userId: USER_MEMBER }]);
  });

  it('refuses tools that were not granted', async () => {
    const { services } = createServices();
    await expectToolError(
      executeAgentTool('delete_task', { taskId: TASK_A1 }, contextFor('owner', USER_ADMIN, ['query_tasks']), services),
      'TOOL_NOT_GRANTED'
    );
    await expectToolError(executeAgentTool('drop_database', {}, contextFor('owner'), services), 'UNKNOWN_TOOL');
  });

  it('does not expose forbidden tools to the in-app model at all', () => {
    const memberTools = Object.keys(buildAiSdkTools(contextFor('member')));
    expect(memberTools).not.toContain('delete_task');
    expect(memberTools).not.toContain('assign_task');
    expect(memberTools).toContain('query_tasks');
  });

  it('requires approval for mutating tools only', () => {
    const tools = buildAiSdkTools(contextFor('admin'));
    expect(tools.delete_task?.needsApproval).toBe(true);
    expect(tools.update_task?.needsApproval).toBe(true);
    expect(tools.query_tasks?.needsApproval).toBe(false);
  });
});

describe('argument validation', () => {
  it('rejects wrong types, unknown params and out-of-range limits with readable messages', async () => {
    const { services } = createServices();
    const ctx = contextFor('admin');
    await expectToolError(executeAgentTool('query_tasks', { limit: '10' }, ctx, services), 'VALIDATION_ERROR', /limit/);
    await expectToolError(executeAgentTool('query_tasks', { limit: 500 }, ctx, services), 'VALIDATION_ERROR', /limit/);
    await expectToolError(
      executeAgentTool('query_tasks', { assignedId: 'me' }, ctx, services),
      'VALIDATION_ERROR',
      /unknown parameter\(s\) assignedId/
    );
    await expectToolError(executeAgentTool('get_task', {}, ctx, services), 'VALIDATION_ERROR', /taskId/);
    await expectToolError(
      executeAgentTool('query_tasks', { projectId: 'not-a-uuid' }, ctx, services),
      'VALIDATION_ERROR',
      /projectId/
    );
  });

  it('returns validation errors verbatim through runAgentTool', async () => {
    const { services } = createServices();
    const outcome = await runAgentTool('move_task', { taskId: TASK_A1 }, contextFor('admin'), services);
    expect(outcome).toEqual({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Provide stateId or state (a state name or category)' },
    });
  });

  it('hides unexpected errors behind a generic message', async () => {
    const { services } = createServices();
    services.tasks.list = async () => {
      throw new Error('connect ECONNREFUSED 10.0.0.5:5432');
    };
    const outcome = await runAgentTool('query_tasks', {}, contextFor('admin'), services);
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.error.code).toBe('INTERNAL_ERROR');
      expect(outcome.error.message).not.toContain('ECONNREFUSED');
    }
  });
});

describe('move_task', () => {
  // Placement (append to the end of the target column, under the column lock)
  // is TaskService.move's job and is covered by the domain position tests.
  it('resolves a state by name and leaves placement to TaskService', async () => {
    const { services, calls } = createServices();
    await executeAgentTool('move_task', { taskId: TASK_A1, state: 'in progress' }, contextFor('admin'), services);
    const move = calls.move[0];
    expect(move?.stateId).toBe(STATE_A_DOING);
    expect(move?.position).toBeUndefined();
  });

  it('accepts a state category and rejects unknown states with the available list', async () => {
    const { services, calls } = createServices();
    await executeAgentTool('move_task', { taskId: TASK_A2, state: 'backlog' }, contextFor('admin'), services);
    expect(calls.move[0]?.stateId).toBe(STATE_A_TODO);
    await expectToolError(
      executeAgentTool('move_task', { taskId: TASK_A2, state: 'Shipped' }, contextFor('admin'), services),
      'VALIDATION_ERROR',
      /Available: Todo \(backlog\), In Progress \(in_progress\)/
    );
  });
});

describe('tool registry quality', () => {
  function missingDescriptions(schema: ToolParameterSchema, path: string): string[] {
    const own = schema.description ? [] : [path];
    const nested = Object.entries(schema.properties ?? {}).flatMap(([key, value]) => missingDescriptions(value, `${path}.${key}`));
    const items = schema.items ? missingDescriptions(schema.items, `${path}[]`) : [];
    return [...own, ...nested, ...items];
  }

  it('describes every parameter', () => {
    const missing = AGENT_TOOLS.flatMap((definition) =>
      Object.entries(definition.parameters.properties).flatMap(([key, value]) => missingDescriptions(value, `${definition.name}.${key}`))
    );
    expect(missing).toEqual([]);
  });

  it('types every limit as a bounded integer', () => {
    for (const definition of AGENT_TOOLS) {
      const limit = definition.parameters.properties.limit;
      if (limit) {
        expect(limit).toMatchObject({ type: 'integer', minimum: 1, maximum: 50 });
      }
    }
  });

  it('marks update/move/assign idempotent and update_task open-world', () => {
    const byName = new Map(AGENT_TOOLS.map((definition) => [definition.name, definition]));
    for (const name of ['update_task', 'move_task', 'assign_task'] as const) {
      expect(byName.get(name)?.annotations.idempotentHint).toBe(true);
    }
    expect(byName.get('update_task')?.annotations.openWorldHint).toBe(true);
  });
});
