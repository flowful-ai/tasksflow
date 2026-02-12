import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

// Available AI models
export const AIModelSchema = z.string().trim().transform((value, ctx) => {
  if (!value) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Model is required',
    });
    return z.NEVER;
  }

  if (/\s/.test(value)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Model must not contain spaces',
    });
    return z.NEVER;
  }

  const slashIndex = value.indexOf('/');
  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Model must follow "provider/model" format',
    });
    return z.NEVER;
  }

  const provider = value.slice(0, slashIndex);
  const model = value.slice(slashIndex + 1);

  if (!/^[a-z0-9][a-z0-9-]*$/i.test(provider)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'Provider must contain only letters, numbers, and hyphens',
    });
    return z.NEVER;
  }

  return `${provider.toLowerCase()}/${model}`;
});
export type AIModel = z.infer<typeof AIModelSchema>;

// Agent tools
export const AgentToolSchema = z.enum([
  'create_task',
  'bulk_create_tasks',
  'update_task',
  'delete_task',
  'query_tasks',
  'get_task',
  'move_task',
  'assign_task',
  'add_comment',
  'summarize_project',
  'create_smart_view',
  'search_tasks',
  'list_projects',
]);
export type AgentTool = z.infer<typeof AgentToolSchema>;

// Agent schema
export const AgentSchema = BaseEntitySchema.extend({
  workspaceId: z.string().uuid(),
  name: z.string().min(1).max(100),
  model: AIModelSchema,
  systemPrompt: z.string().nullable(),
  tools: z.array(AgentToolSchema),
  requestsPerMinute: z.number().int().positive().default(10),
  tokensPerDay: z.number().int().positive().default(100000),
  currentDayTokens: z.number().int().nonnegative().default(0),
  lastTokenReset: z.coerce.date().nullable(),
  isActive: z.boolean().default(true),
  createdBy: z.string().uuid().nullable(),
});

export type Agent = z.infer<typeof AgentSchema>;

export const CreateAgentSchema = z.object({
  name: z.string().min(1).max(100),
  model: AIModelSchema,
  systemPrompt: z.string().optional(),
  tools: z.array(AgentToolSchema).optional(),
  requestsPerMinute: z.number().int().positive().optional(),
  tokensPerDay: z.number().int().positive().optional(),
});

export type CreateAgent = z.infer<typeof CreateAgentSchema>;

export const UpdateAgentSchema = CreateAgentSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type UpdateAgent = z.infer<typeof UpdateAgentSchema>;

// Workspace API keys
export const ApiKeyProviderSchema = z.enum(['openai', 'anthropic', 'google', 'openrouter']);
export type ApiKeyProvider = z.infer<typeof ApiKeyProviderSchema>;

const NATIVE_API_KEY_PROVIDERS = ['openai', 'anthropic', 'google'] as const satisfies readonly ApiKeyProvider[];

export function getRequiredApiKeyProvidersForModel(model: string): ApiKeyProvider[] {
  const nativeProvider = NATIVE_API_KEY_PROVIDERS.find((provider) => model.startsWith(`${provider}/`));
  return nativeProvider ? [nativeProvider, 'openrouter'] : ['openrouter'];
}

export const WorkspaceApiKeySchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  provider: ApiKeyProviderSchema,
  lastUsedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export type WorkspaceApiKey = z.infer<typeof WorkspaceApiKeySchema>;

// Agent execution
export const AgentExecutionStatusSchema = z.enum(['pending', 'running', 'completed', 'failed']);
export type AgentExecutionStatus = z.infer<typeof AgentExecutionStatusSchema>;

export const AgentMessageRoleSchema = z.enum(['user', 'assistant', 'system', 'tool']);
export type AgentMessageRole = z.infer<typeof AgentMessageRoleSchema>;

export const AgentMessageSchema = z.object({
  role: AgentMessageRoleSchema,
  content: z.string(),
  toolCalls: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        arguments: z.record(z.unknown()),
      })
    )
    .optional(),
  toolResults: z
    .array(
      z.object({
        id: z.string(),
        result: z.unknown(),
      })
    )
    .optional(),
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export const AgentExecutionSchema = z.object({
  id: z.string().uuid(),
  agentId: z.string().uuid(),
  userId: z.string().uuid(),
  status: AgentExecutionStatusSchema,
  messages: z.array(AgentMessageSchema),
  tokensUsed: z.number().int().nonnegative().default(0),
  error: z.string().nullable(),
  startedAt: z.coerce.date(),
  completedAt: z.coerce.date().nullable(),
});

export type AgentExecution = z.infer<typeof AgentExecutionSchema>;

export const RunAgentSchema = z.object({
  message: z.string().min(1),
  context: z
    .object({
      projectId: z.string().uuid().optional(),
      taskId: z.string().uuid().optional(),
    })
    .optional(),
});

export type RunAgent = z.infer<typeof RunAgentSchema>;

export const WorkspaceAiSettingsSchema = z.object({
  allowedModels: z.array(AIModelSchema),
  defaultAgentId: z.string().uuid().nullable(),
});
export type WorkspaceAiSettings = z.infer<typeof WorkspaceAiSettingsSchema>;

export const UpdateWorkspaceAiSettingsSchema = z.object({
  allowedModels: z.array(AIModelSchema),
  defaultAgentId: z.string().uuid().nullable(),
});
export type UpdateWorkspaceAiSettings = z.infer<typeof UpdateWorkspaceAiSettingsSchema>;
