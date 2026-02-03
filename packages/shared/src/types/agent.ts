import { z } from 'zod';
import { BaseEntitySchema } from './common.js';

// Available AI models
export const AIModelSchema = z.enum([
  'anthropic/claude-3-opus',
  'anthropic/claude-3-sonnet',
  'anthropic/claude-3-haiku',
  'openai/gpt-4-turbo',
  'openai/gpt-4',
  'openai/gpt-3.5-turbo',
  'google/gemini-pro',
  'meta/llama-2-70b',
]);
export type AIModel = z.infer<typeof AIModelSchema>;

// Agent tools
export const AgentToolSchema = z.enum([
  'create_task',
  'update_task',
  'delete_task',
  'query_tasks',
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

// User API keys
export const ApiKeyProviderSchema = z.enum(['openrouter']);
export type ApiKeyProvider = z.infer<typeof ApiKeyProviderSchema>;

export const UserApiKeySchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  provider: ApiKeyProviderSchema,
  lastUsedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
});

export type UserApiKey = z.infer<typeof UserApiKeySchema>;

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
