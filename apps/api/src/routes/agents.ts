import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { convertToModelMessages, stepCountIs, streamText, validateUIMessages } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getDatabase } from '../db/index.js';
import { AgentService, toError } from '../domain/index.js';
import {
  AgentToolSchema,
  AIModelSchema,
  CreateAgentSchema,
  UpdateAgentSchema,
  getRequiredApiKeyProvidersForModel,
} from '@flowtask/shared';
import type { Context } from 'hono';
import type { WorkspacePermission } from '../auth/index.js';
import { requireWorkspace } from '../lib/authorize.js';
import {
  AppError,
  badRequest,
  fromResult,
  notFound,
  validationHook,
  handleRouteError,
} from '../lib/responses.js';
import { buildAiSdkTools, MCP_SERVER_INSTRUCTIONS } from '../services/agent-tool-runtime.js';
import { buildToolContext } from '../lib/mcp/tool-context.js';

const ExecuteAgentSchema = z.object({
  // UI messages are validated structurally by validateUIMessages below.
  messages: z.array(z.unknown()).min(1, {
    message: 'At least one message is required',
  }),
  context: z
    .object({
      projectId: z.string().uuid().optional(),
      taskId: z.string().uuid().optional(),
    })
    .optional(),
  model: AIModelSchema.optional(),
});

const agents = new Hono();
agents.onError(handleRouteError);
const db = getDatabase();
const agentService = new AgentService(db);

/** Load an agent and check the caller's workspace permission on it. */
async function requireAgent(c: Context, permission: WorkspacePermission) {
  const result = await agentService.getById(c.req.param('agentId') ?? '');
  if (!result.ok) throw notFound('Agent');
  const grant = await requireWorkspace(c, result.value.workspaceId, permission);
  return { ...grant, agent: result.value };
}

type ModelProvider = 'openai' | 'anthropic' | 'google' | 'openrouter';
// Each step is one model call; 8 is plenty for read-then-act flows and bounds
// what an injected instruction could chain together.
const TOOL_EXECUTION_STEP_LIMIT = 8;
const TOOL_COMPLETION_INSTRUCTION =
  'When you use one or more tools, you must always finish with a plain-language assistant response that directly answers the user. Never end with only tool calls. Tools that change data ask the user for approval first; if the user denies a call, do not retry it.';

function resolveProviderModelId(model: string, provider: ModelProvider): string {
  if (provider === 'openrouter') {
    return model;
  }
  const [prefix, ...rest] = model.split('/');
  if (prefix === provider && rest.length > 0) {
    return rest.join('/');
  }
  return model;
}

function resolveLanguageModel(provider: ModelProvider, apiKey: string, model: string) {
  const providerModel = resolveProviderModelId(model, provider);

  switch (provider) {
    case 'openai':
      return createOpenAI({ apiKey })(providerModel);
    case 'anthropic':
      return createAnthropic({ apiKey })(providerModel);
    case 'google':
      return createGoogleGenerativeAI({ apiKey })(providerModel);
    case 'openrouter': {
      const openrouter = createOpenRouter({ apiKey, compatibility: 'strict' });
      return openrouter.chat(model);
    }
    default:
      throw new Error('Unsupported model provider');
  }
}

// List agents
agents.get('/', async (c) => {
  const { workspaceId } = await requireWorkspace(c, c.req.query('workspaceId'), 'agent:read');
  const list = fromResult(
    await agentService.list({
      filters: {
        workspaceId,
        isActive:
          c.req.query('isActive') === 'all' ? undefined : c.req.query('isActive') !== 'false',
      },
    }),
    { code: 'LIST_FAILED', message: 'Failed to list agents' }
  );
  return c.json({ success: true, data: list });
});

agents.get('/availability', async (c) => {
  const { workspaceId } = await requireWorkspace(c, c.req.query('workspaceId'), 'agent:execute');

  const [configuredProviders, activeAgentsResult] = await Promise.all([
    agentService.listApiKeyProviders(workspaceId),
    agentService.list({ filters: { workspaceId, isActive: true } }),
  ]);

  const activeAgents = fromResult(activeAgentsResult, {
    status: 400,
    code: 'READ_FAILED',
    message: 'Failed to load agents',
  });

  const hasProviderKey = configuredProviders.size > 0;
  const activeAgentCount = activeAgents.length;

  return c.json({
    success: true,
    data: {
      enabled: hasProviderKey && activeAgentCount > 0,
      hasProviderKey,
      activeAgentCount,
      modelCount: activeAgentCount,
    },
  });
});

// Create agent
agents.post(
  '/',
  zValidator('json', CreateAgentSchema.extend({ workspaceId: z.string().uuid() }), validationHook),
  async (c) => {
    const data = c.req.valid('json');
    const { user } = await requireWorkspace(c, data.workspaceId, 'agent:create');
    const agent = fromResult(await agentService.create({ ...data, createdBy: user.id }), {
      status: 400,
      code: 'CREATE_FAILED',
      message: 'Failed to create agent',
    });
    return c.json({ success: true, data: agent }, 201);
  }
);

// Get agent by ID
agents.get('/:agentId', async (c) => {
  const { agent } = await requireAgent(c, 'agent:read');
  return c.json({ success: true, data: agent });
});

// Update agent
agents.patch('/:agentId', zValidator('json', UpdateAgentSchema, validationHook), async (c) => {
  const data = c.req.valid('json');
  const { user, agent } = await requireAgent(c, 'agent:update');
  const updated = fromResult(await agentService.update(agent.id, { ...data, updatedBy: user.id }), {
    status: 400,
    code: 'UPDATE_FAILED',
    message: 'Failed to update agent',
  });
  return c.json({ success: true, data: updated });
});

// Delete agent
agents.delete('/:agentId', async (c) => {
  const { agent } = await requireAgent(c, 'agent:delete');
  fromResult(await agentService.delete(agent.id), {
    status: 400,
    code: 'DELETE_FAILED',
    message: 'Failed to delete agent',
  });

  return c.json({ success: true, data: null });
});

agents.post(
  '/:agentId/execute',
  zValidator('json', ExecuteAgentSchema, validationHook),
  async (c) => {
    const data = c.req.valid('json');
    const { user, role, agent } = await requireAgent(c, 'agent:execute');
    const agentId = agent.id;

    if (agent.isRateLimited) {
      throw new AppError(429, 'RATE_LIMITED', 'Agent has reached its daily token limit');
    }

    const effectiveModel = agent.model;
    const requiredProviders = getRequiredApiKeyProvidersForModel(effectiveModel);

    let selectedProvider: ModelProvider | null = null;
    let apiKey: string | null = null;

    for (const provider of requiredProviders) {
      const keyResult = await agentService.getApiKey(agent.workspaceId, provider);
      if (keyResult.ok) {
        selectedProvider = provider;
        apiKey = keyResult.value;
        break;
      }
    }

    if (!selectedProvider || !apiKey) {
      const requiredProviderNames = requiredProviders
        .map((provider) => provider.toUpperCase())
        .join(' or ');
      throw badRequest(
        `Please configure a workspace ${requiredProviderNames} API key first`,
        'NO_API_KEY'
      );
    }

    const agentTools = AgentToolSchema.array().safeParse(agent.tools ?? []);
    // One tenant-scoped context: workspace, role permissions and project ACL
    // are enforced exactly as for MCP clients.
    const toolContext = buildToolContext({
      workspaceId: agent.workspaceId,
      userId: user.id,
      role,
      grantedTools: agentTools.success ? agentTools.data : [],
      mcpClientId: null,
    });
    const tools = buildAiSdkTools(toolContext);

    let uiMessages: Awaited<ReturnType<typeof validateUIMessages>>;
    try {
      uiMessages = await validateUIMessages({ messages: data.messages });
    } catch (error) {
      throw badRequest(
        error instanceof Error ? error.message : 'Invalid messages',
        'INVALID_MESSAGES'
      );
    }

    try {
      const model = resolveLanguageModel(selectedProvider, apiKey, effectiveModel);
      const modelMessages = await convertToModelMessages(uiMessages, {
        tools,
        ignoreIncompleteToolCalls: true,
      });

      const systemPrompt = [
        agent.systemPrompt || 'You are a helpful FlowTask workspace assistant.',
        TOOL_COMPLETION_INSTRUCTION,
        MCP_SERVER_INSTRUCTIONS,
        `Current user: ${user.name} (mail: ${user.email}, ID: ${user.id})`,
        data.context?.projectId ? `Current project ID: ${data.context.projectId}` : '',
        data.context?.taskId ? `Current task ID: ${data.context.taskId}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const result = streamText({
        model,
        system: systemPrompt,
        messages: modelMessages,
        tools,
        stopWhen: stepCountIs(TOOL_EXECUTION_STEP_LIMIT),
        onFinish: async ({ totalUsage }) => {
          const totalTokens = totalUsage.totalTokens ?? 0;
          if (totalTokens > 0) {
            await agentService.recordTokenUsage(agentId, totalTokens);
          }
        },
      });

      return result.toUIMessageStreamResponse({
        sendReasoning: false,
        originalMessages: uiMessages,
      });
    } catch (error) {
      console.error('[agents] execution failed', error);
      throw badRequest(
        process.env.NODE_ENV === 'production' ? 'Agent execution failed' : toError(error).message,
        'EXECUTION_FAILED'
      );
    }
  }
);

export { agents as agentRoutes };
