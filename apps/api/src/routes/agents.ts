import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { stepCountIs, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getDatabase } from '@flowtask/database';
import { AgentService, WorkspaceService, ProjectService } from '@flowtask/domain';
import { getCurrentUser } from '@flowtask/auth';
import {
  type AgentTool,
  AIModelSchema,
  CreateAgentSchema,
  UpdateAgentSchema,
  getRequiredApiKeyProvidersForModel,
} from '@flowtask/shared';
import { hasPermission } from '@flowtask/auth';
import { buildAiSdkTools } from '../services/agent-tool-runtime.js';

const ExecuteAgentSchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string(),
      })
    )
    .transform((messages) =>
      messages
        .map((message) => ({
          ...message,
          content: message.content.trim(),
        }))
        .filter((message) => message.content.length > 0)
    )
    .refine((messages) => messages.length > 0, {
      message: 'At least one non-empty message is required',
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
const projectService = new ProjectService(db);

async function checkWorkspaceAccess(workspaceId: string, userId: string, permission: string) {
  const roleResult = await workspaceService.getMemberRole(workspaceId, userId);
  if (!roleResult.ok || !roleResult.value) {
    return { allowed: false, role: null };
  }
  return {
    allowed: hasPermission(roleResult.value, permission as any),
    role: roleResult.value,
  };
}

type ModelProvider = 'openai' | 'anthropic' | 'google' | 'openrouter';

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
      const openrouter = createOpenRouter({ apiKey });
      return openrouter(model);
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

    const { allowed } = await checkWorkspaceAccess(agentResult.value.workspaceId, user.id, 'agent:execute');
    if (!allowed) {
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

    const allowedTools = (agentResult.value.tools as AgentTool[]) || [];
    const tools = buildAiSdkTools(allowedTools, {
      workspaceId: agentResult.value.workspaceId,
      userId: user.id,
      mcpClientId: null,
      allowedToolNames: new Set(allowedTools),
      canAccessProject: async (projectId: string) => {
        const projectResult = await projectService.getById(projectId);
        return projectResult.ok && projectResult.value.workspaceId === agentResult.value.workspaceId;
      },
    });

    try {
      const model = resolveLanguageModel(selectedProvider, apiKey, effectiveModel);

      const result = streamText({
        model,
        system: [
          agentResult.value.systemPrompt || 'You are a helpful FlowTask workspace assistant.',
          data.context?.projectId ? `Current project ID: ${data.context.projectId}` : '',
          data.context?.taskId ? `Current task ID: ${data.context.taskId}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
        messages: data.messages,
        tools: tools as any,
        stopWhen: stepCountIs(5),
        onFinish: async ({ usage }) => {
          const totalTokens = usage.totalTokens ?? 0;
          if (totalTokens > 0) {
            await agentService.recordTokenUsage(agentId, totalTokens);
          }
        },
      });

      return result.toTextStreamResponse();
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
