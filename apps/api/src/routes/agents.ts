import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { convertToModelMessages, stepCountIs, streamText, validateUIMessages } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getDatabase } from '../db/index.js';
import { AgentService, WorkspaceService } from '../domain/index.js';
import { getCurrentUser } from '../auth/index.js';
import {
  AgentToolSchema,
  AIModelSchema,
  CreateAgentSchema,
  UpdateAgentSchema,
  getRequiredApiKeyProvidersForModel,
} from '@flowtask/shared';
import { hasPermission, type WorkspacePermission } from '../auth/index.js';
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
const db = getDatabase();
const agentService = new AgentService(db);
const workspaceService = new WorkspaceService(db);

async function checkWorkspaceAccess(workspaceId: string, userId: string, permission: WorkspacePermission) {
  const roleResult = await workspaceService.getMemberRole(workspaceId, userId);
  if (!roleResult.ok || !roleResult.value) {
    return { allowed: false, role: null };
  }
  return {
    allowed: hasPermission(roleResult.value, permission),
    role: roleResult.value,
  };
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
  const user = getCurrentUser(c);
  const workspaceId = c.req.query('workspaceId');

  if (!workspaceId) {
    return c.json({ success: false, error: { code: 'MISSING_PARAM', message: 'workspaceId is required' } }, 400);
  }

  const { allowed } = await checkWorkspaceAccess(workspaceId, user.id, 'agent:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await agentService.list({
    filters: {
      workspaceId,
      isActive:
        c.req.query('isActive') === 'all'
          ? undefined
          : c.req.query('isActive') !== 'false',
    },
  });

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'LIST_FAILED', message: result.error.message } }, 500);
  }

  return c.json({ success: true, data: result.value });
});

agents.get('/availability', async (c) => {
  const user = getCurrentUser(c);
  const workspaceId = c.req.query('workspaceId');

  if (!workspaceId) {
    return c.json({ success: false, error: { code: 'MISSING_PARAM', message: 'workspaceId is required' } }, 400);
  }

  const { allowed } = await checkWorkspaceAccess(workspaceId, user.id, 'agent:execute');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const [configuredProviders, activeAgentsResult] = await Promise.all([
    agentService.listApiKeyProviders(workspaceId),
    agentService.list({ filters: { workspaceId, isActive: true } }),
  ]);

  if (!activeAgentsResult.ok) {
    return c.json({ success: false, error: { code: 'READ_FAILED', message: activeAgentsResult.error.message } }, 400);
  }

  const hasProviderKey = configuredProviders.size > 0;
  const activeAgentCount = activeAgentsResult.value.length;

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
  zValidator(
    'json',
    CreateAgentSchema.extend({ workspaceId: z.string().uuid() })
  ),
  async (c) => {
    const user = getCurrentUser(c);
    const data = c.req.valid('json');

    const { allowed } = await checkWorkspaceAccess(data.workspaceId, user.id, 'agent:create');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await agentService.create({
      ...data,
      createdBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'CREATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value }, 201);
  }
);

// Get agent by ID
agents.get('/:agentId', async (c) => {
  const user = getCurrentUser(c);
  const agentId = c.req.param('agentId');

  const result = await agentService.getById(agentId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: result.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(result.value.workspaceId, user.id, 'agent:read');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  return c.json({ success: true, data: result.value });
});

// Update agent
agents.patch(
  '/:agentId',
  zValidator('json', UpdateAgentSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const agentId = c.req.param('agentId');
    const data = c.req.valid('json');

    const agentResult = await agentService.getById(agentId);
    if (!agentResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: agentResult.error.message } }, 404);
    }

    const { allowed } = await checkWorkspaceAccess(agentResult.value.workspaceId, user.id, 'agent:update');
    if (!allowed) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    const result = await agentService.update(agentId, {
      ...data,
      updatedBy: user.id,
    });

    if (!result.ok) {
      return c.json({ success: false, error: { code: 'UPDATE_FAILED', message: result.error.message } }, 400);
    }

    return c.json({ success: true, data: result.value });
  }
);

// Delete agent
agents.delete('/:agentId', async (c) => {
  const user = getCurrentUser(c);
  const agentId = c.req.param('agentId');

  const agentResult = await agentService.getById(agentId);
  if (!agentResult.ok) {
    return c.json({ success: false, error: { code: 'NOT_FOUND', message: agentResult.error.message } }, 404);
  }

  const { allowed } = await checkWorkspaceAccess(agentResult.value.workspaceId, user.id, 'agent:delete');
  if (!allowed) {
    return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
  }

  const result = await agentService.delete(agentId);

  if (!result.ok) {
    return c.json({ success: false, error: { code: 'DELETE_FAILED', message: result.error.message } }, 400);
  }

  return c.json({ success: true, data: null });
});

agents.post(
  '/:agentId/execute',
  zValidator('json', ExecuteAgentSchema),
  async (c) => {
    const user = getCurrentUser(c);
    const agentId = c.req.param('agentId');
    const data = c.req.valid('json');

    const agentResult = await agentService.getById(agentId);
    if (!agentResult.ok) {
      return c.json({ success: false, error: { code: 'NOT_FOUND', message: agentResult.error.message } }, 404);
    }

    const access = await checkWorkspaceAccess(agentResult.value.workspaceId, user.id, 'agent:execute');
    if (!access.allowed || !access.role) {
      return c.json({ success: false, error: { code: 'FORBIDDEN', message: 'Not authorized' } }, 403);
    }

    if (agentResult.value.isRateLimited) {
      return c.json({
        success: false,
        error: {
          code: 'RATE_LIMITED',
          message: 'Agent has reached its daily token limit',
        },
      }, 429);
    }

    const effectiveModel = agentResult.value.model;
    const requiredProviders = getRequiredApiKeyProvidersForModel(effectiveModel);

    let selectedProvider: ModelProvider | null = null;
    let apiKey: string | null = null;

    for (const provider of requiredProviders) {
      const keyResult = await agentService.getApiKey(agentResult.value.workspaceId, provider);
      if (keyResult.ok) {
        selectedProvider = provider;
        apiKey = keyResult.value;
        break;
      }
    }

    if (!selectedProvider || !apiKey) {
      const requiredProviderNames = requiredProviders.map((provider) => provider.toUpperCase()).join(' or ');
      return c.json({
        success: false,
        error: {
          code: 'NO_API_KEY',
          message: `Please configure a workspace ${requiredProviderNames} API key first`,
        },
      }, 400);
    }

    const agentTools = AgentToolSchema.array().safeParse(agentResult.value.tools ?? []);
    // One tenant-scoped context: workspace, role permissions and project ACL
    // are enforced exactly as for MCP clients.
    const toolContext = buildToolContext({
      workspaceId: agentResult.value.workspaceId,
      userId: user.id,
      role: access.role,
      grantedTools: agentTools.success ? agentTools.data : [],
      mcpClientId: null,
    });
    const tools = buildAiSdkTools(toolContext);

    let uiMessages: Awaited<ReturnType<typeof validateUIMessages>>;
    try {
      uiMessages = await validateUIMessages({ messages: data.messages });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: { code: 'INVALID_MESSAGES', message: error instanceof Error ? error.message : 'Invalid messages' },
        },
        400
      );
    }

    try {
      const model = resolveLanguageModel(selectedProvider, apiKey, effectiveModel);
      const modelMessages = await convertToModelMessages(uiMessages, { tools, ignoreIncompleteToolCalls: true });

      const systemPrompt = [
        agentResult.value.systemPrompt || 'You are a helpful FlowTask workspace assistant.',
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

      return result.toUIMessageStreamResponse({ sendReasoning: false, originalMessages: uiMessages });
    } catch (error) {
      return c.json({
        success: false,
        error: {
          code: 'EXECUTION_FAILED',
          message: process.env.NODE_ENV === 'production' ? 'Agent execution failed' : error instanceof Error ? error.message : 'Unknown error',
        },
      }, 400);
    }
  }
);

export { agents as agentRoutes };
