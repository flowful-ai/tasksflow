/**
 * OpenRouter API client for AI model access.
 * Provides a unified interface to various AI models through OpenRouter.
 */

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
  tool_call_id?: string;
}

export interface OpenRouterTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, {
        type: string;
        description: string;
        enum?: string[];
      }>;
      required: string[];
    };
  };
}

export interface OpenRouterCompletionRequest {
  model: string;
  messages: OpenRouterMessage[];
  tools?: OpenRouterTool[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  stream?: boolean;
}

export interface OpenRouterCompletionResponse {
  id: string;
  model: string;
  choices: Array<{
    index: number;
    message: OpenRouterMessage;
    finish_reason: 'stop' | 'length' | 'tool_calls' | 'content_filter';
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
}

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1';

/**
 * OpenRouter API client.
 */
export class OpenRouterClient {
  private apiKey: string;
  private siteUrl: string;
  private siteName: string;

  constructor(apiKey: string, options?: { siteUrl?: string; siteName?: string }) {
    this.apiKey = apiKey;
    this.siteUrl = options?.siteUrl || process.env.WEB_URL || 'http://localhost:3000';
    this.siteName = options?.siteName || 'FlowTask';
  }

  /**
   * Create a chat completion.
   */
  async createCompletion(request: OpenRouterCompletionRequest): Promise<OpenRouterCompletionResponse> {
    const response = await fetch(`${OPENROUTER_API_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
        'HTTP-Referer': this.siteUrl,
        'X-Title': this.siteName,
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(`OpenRouter API error: ${(error as any).error?.message || response.statusText}`);
    }

    return response.json() as Promise<OpenRouterCompletionResponse>;
  }

  /**
   * Create a chat completion with tool use support.
   */
  async createCompletionWithTools(
    model: string,
    messages: OpenRouterMessage[],
    tools: OpenRouterTool[],
    options?: {
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<OpenRouterCompletionResponse> {
    return this.createCompletion({
      model,
      messages,
      tools,
      tool_choice: 'auto',
      max_tokens: options?.maxTokens || 4096,
      temperature: options?.temperature || 0.7,
    });
  }

  /**
   * Run a conversation loop with tool execution.
   */
  async runConversation(
    model: string,
    systemPrompt: string,
    userMessage: string,
    tools: OpenRouterTool[],
    toolExecutor: (name: string, args: Record<string, unknown>) => Promise<unknown>,
    options?: {
      maxIterations?: number;
      maxTokens?: number;
      temperature?: number;
    }
  ): Promise<{
    response: string;
    messages: OpenRouterMessage[];
    tokensUsed: number;
  }> {
    const maxIterations = options?.maxIterations || 10;
    let totalTokens = 0;

    const messages: OpenRouterMessage[] = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage },
    ];

    for (let i = 0; i < maxIterations; i++) {
      const response = await this.createCompletionWithTools(model, messages, tools, {
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
      });

      totalTokens += response.usage.total_tokens;

      const choice = response.choices[0];
      if (!choice) {
        throw new Error('No response from model');
      }

      messages.push(choice.message);

      // Check if we should stop
      if (choice.finish_reason === 'stop' || choice.finish_reason === 'length') {
        return {
          response: choice.message.content,
          messages,
          tokensUsed: totalTokens,
        };
      }

      // Handle tool calls
      if (choice.finish_reason === 'tool_calls' && choice.message.tool_calls) {
        for (const toolCall of choice.message.tool_calls) {
          try {
            const args = JSON.parse(toolCall.function.arguments);
            const result = await toolExecutor(toolCall.function.name, args);

            messages.push({
              role: 'tool',
              content: JSON.stringify(result),
              tool_call_id: toolCall.id,
            });
          } catch (error) {
            messages.push({
              role: 'tool',
              content: JSON.stringify({
                error: error instanceof Error ? error.message : 'Tool execution failed',
              }),
              tool_call_id: toolCall.id,
            });
          }
        }
      }
    }

    // Max iterations reached
    const lastMessage = messages[messages.length - 1];
    return {
      response: lastMessage?.content || 'Max iterations reached without completion',
      messages,
      tokensUsed: totalTokens,
    };
  }

  /**
   * Get available models.
   */
  async listModels(): Promise<OpenRouterModel[]> {
    const response = await fetch(`${OPENROUTER_API_URL}/models`, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = await response.json();
    return (data as { data: OpenRouterModel[] }).data;
  }

  /**
   * Check if the API key is valid.
   */
  async validateApiKey(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Create an OpenRouter client with the given API key.
 */
export function createOpenRouterClient(apiKey: string): OpenRouterClient {
  return new OpenRouterClient(apiKey);
}
