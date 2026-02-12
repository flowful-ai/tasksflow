import { useEffect, useMemo, useRef, useState } from 'react';
import { MessageSquare, X, Send, Bot, Wrench, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, type UIMessage, type UIMessagePart } from 'ai';
import { agentApi, workspaceAiSettingsApi, type AgentSummary } from '../../api/client';
import { useWorkspaceStore } from '../../stores/workspace';
import { useAuthStore } from '../../stores/auth';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';
const TOOL_ONLY_FALLBACK_MESSAGE = 'Done. I completed the requested actions.';

function storageKey(userId: string, workspaceId: string): string {
  return `flowtask:chat:agent:${workspaceId}:${userId}`;
}

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function isToolPart(part: UIMessagePart<Record<string, never>, Record<string, { input: unknown; output: unknown }>>): boolean {
  return part.type === 'dynamic-tool' || part.type.startsWith('tool-');
}

function getToolName(part: UIMessagePart<Record<string, never>, Record<string, { input: unknown; output: unknown }>>): string {
  if (part.type === 'dynamic-tool') {
    return part.toolName;
  }
  return part.type.replace(/^tool-/, '');
}

function getToolStatusLabel(state: string | undefined): string {
  switch (state) {
    case 'input-streaming':
      return 'Preparing...';
    case 'input-available':
      return 'Queued';
    case 'output-available':
      return 'Completed';
    case 'output-error':
      return 'Failed';
    default:
      return state ?? 'Running';
  }
}

function getUserMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export function GlobalAgentChat() {
  const { currentWorkspace } = useWorkspaceStore();
  const userId = useAuthStore((state) => state.user?.id ?? null);

  const [isOpen, setIsOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [input, setInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedAgentIdRef = useRef<string>('');

  useEffect(() => {
    selectedAgentIdRef.current = selectedAgentId;
  }, [selectedAgentId]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `${API_BASE_URL}/api/agents/execute`,
        credentials: 'include',
        prepareSendMessagesRequest: (options) => {
          const agentId = selectedAgentIdRef.current;
          if (!agentId) {
            throw new Error('Please select an agent before sending a message.');
          }

          return {
            api: `${API_BASE_URL}/api/agents/${agentId}/execute`,
            body: options.body ?? {},
          };
        },
      }),
    []
  );

  const { messages, status, sendMessage, stop, error: chatError } = useChat({
    transport,
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const isStreaming = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (!currentWorkspace || !userId) {
      setEnabled(false);
      setIsOpen(false);
      return;
    }

    const load = async () => {
      try {
        const [availabilityResult, settingsResult, agentsResult] = await Promise.all([
          agentApi.availability(currentWorkspace.id),
          workspaceAiSettingsApi.get(currentWorkspace.id),
          agentApi.list(currentWorkspace.id, true),
        ]);

        setEnabled(availabilityResult.data.enabled);
        setDefaultAgentId(settingsResult.data.defaultAgentId);
        setAgents(agentsResult.data);
      } catch {
        setEnabled(false);
      }
    };

    load();
  }, [currentWorkspace, userId]);

  useEffect(() => {
    if (!currentWorkspace || !userId || agents.length === 0) return;

    const rememberedAgentId = localStorage.getItem(storageKey(userId, currentWorkspace.id));
    const nextAgentId =
      (rememberedAgentId && agents.some((agent) => agent.id === rememberedAgentId) && rememberedAgentId) ||
      (defaultAgentId && agents.some((agent) => agent.id === defaultAgentId) && defaultAgentId) ||
      agents[0]?.id ||
      '';

    setSelectedAgentId(nextAgentId);
  }, [agents, defaultAgentId, currentWorkspace, userId]);

  useEffect(() => {
    if (!currentWorkspace || !userId || !selectedAgentId) return;
    localStorage.setItem(storageKey(userId, currentWorkspace.id), selectedAgentId);
  }, [selectedAgentId, currentWorkspace, userId]);

  const canSend = useMemo(() => {
    return enabled && !!selectedAgentId && input.trim().length > 0 && !isStreaming;
  }, [enabled, selectedAgentId, input, isStreaming]);

  const lastAssistantMessage = [...messages].reverse().find((message) => message.role === 'assistant');
  const lastAssistantHasVisibleOutput = !!lastAssistantMessage?.parts.some(
    (part) =>
      (part.type === 'text' && part.text.trim().length > 0) ||
      isToolPart(part as UIMessagePart<Record<string, never>, Record<string, { input: unknown; output: unknown }>>)
  );
  const showThinking = isStreaming && !lastAssistantHasVisibleOutput;
  const currentError = errorMessage || chatError?.message || null;

  const handleSend = async () => {
    if (!canSend) return;

    const text = input.trim();
    if (!text) return;

    setInput('');
    setErrorMessage(null);

    try {
      await sendMessage({ text });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Agent execution failed');
    }
  };

  if (!enabled || !currentWorkspace || !userId) {
    return null;
  }

  return (
    <>
      <button
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-neutral-800"
        onClick={() => setIsOpen(true)}
      >
        <MessageSquare className="h-4 w-4" />
        Chat
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-end p-4">
          <div className="absolute inset-0 bg-black/40" onClick={() => setIsOpen(false)} />
          <div className="relative h-[70vh] w-full max-w-md rounded-2xl border border-gray-200 bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-gray-200 px-4 py-3">
              <div className="flex items-center gap-2">
                <Bot className="h-4 w-4 text-primary-600" />
                <span className="text-sm font-semibold text-gray-900">Workspace Chat</span>
              </div>
              <button className="rounded-md p-1 hover:bg-gray-100" onClick={() => setIsOpen(false)}>
                <X className="h-4 w-4 text-gray-600" />
              </button>
            </div>

            <div className="border-b border-gray-200 px-4 py-3">
              <select
                className="input"
                value={selectedAgentId}
                onChange={(event) => {
                  if (isStreaming) {
                    void stop();
                  }
                  setSelectedAgentId(event.target.value);
                }}
              >
                {agents.map((agent) => (
                  <option key={agent.id} value={agent.id}>
                    {agent.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="h-[calc(70vh-180px)] space-y-3 overflow-y-auto px-4 py-3">
              {messages.length === 0 && (
                <div className="text-sm text-gray-500">Ask anything about your workspace, tasks, and projects.</div>
              )}
              {messages.map((message) => {
                if (message.role === 'system') {
                  return null;
                }

                if (message.role === 'user') {
                  return (
                    <div key={message.id} className="ml-8 rounded-xl bg-neutral-900 px-3 py-2 text-sm text-white">
                      <div className="whitespace-pre-wrap">{getUserMessageText(message)}</div>
                    </div>
                  );
                }

                const assistantParts = message.parts;
                const hasText = assistantParts.some((part) => part.type === 'text' && part.text.trim().length > 0);
                const hasToolOutput = assistantParts.some((part) =>
                  isToolPart(part as UIMessagePart<Record<string, never>, Record<string, { input: unknown; output: unknown }>>)
                );

                return (
                  <div key={message.id} className="mr-8 rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-800">
                    <div className="space-y-2 overflow-x-auto">
                      {assistantParts.map((part, index) => {
                        if (part.type === 'text') {
                          if (part.text.length === 0) {
                            return null;
                          }

                          return (
                            <ReactMarkdown
                              key={`${message.id}-text-${index}`}
                              remarkPlugins={[remarkGfm]}
                              rehypePlugins={[rehypeSanitize]}
                              components={{
                                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                                strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                                em: ({ children }) => <em className="italic">{children}</em>,
                                ul: ({ children }) => <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>,
                                ol: ({ children }) => <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">{children}</ol>,
                                a: ({ href, children }) => (
                                  <a href={href} className="text-primary-600 underline" target="_blank" rel="noopener noreferrer">
                                    {children}
                                  </a>
                                ),
                                code: ({ children }) => (
                                  <code className="rounded bg-gray-200 px-1 py-0.5 text-xs text-gray-900">{children}</code>
                                ),
                                table: ({ children }) => (
                                  <table className="my-2 w-full border-collapse overflow-hidden rounded border border-gray-300 text-left text-xs">
                                    {children}
                                  </table>
                                ),
                                thead: ({ children }) => <thead className="bg-gray-200">{children}</thead>,
                                tbody: ({ children }) => <tbody>{children}</tbody>,
                                tr: ({ children }) => <tr className="border-b border-gray-300 last:border-b-0">{children}</tr>,
                                th: ({ children }) => <th className="px-2 py-1 font-semibold text-gray-900">{children}</th>,
                                td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,
                              }}
                            >
                              {part.text}
                            </ReactMarkdown>
                          );
                        }

                        if (part.type === 'step-start') {
                          return <div key={`${message.id}-step-${index}`} className="border-t border-dashed border-gray-300 pt-2 text-xs text-gray-500">Next step</div>;
                        }

                        if (
                          part.type === 'dynamic-tool' ||
                          part.type.startsWith('tool-')
                        ) {
                          const toolPart = part as UIMessagePart<Record<string, never>, Record<string, { input: unknown; output: unknown }>>;
                          const hasInput = 'input' in toolPart && toolPart.input !== undefined;
                          const hasOutput = 'output' in toolPart && toolPart.output !== undefined;
                          const hasErrorText = 'errorText' in toolPart && typeof toolPart.errorText === 'string' && toolPart.errorText.length > 0;

                          return (
                            <div key={`${message.id}-tool-${index}`} className="rounded-lg border border-gray-300 bg-white p-2 text-xs text-gray-700">
                              <div className="flex items-center justify-between gap-2">
                                <div className="inline-flex items-center gap-1.5 font-medium text-gray-900">
                                  <Wrench className="h-3.5 w-3.5" />
                                  {getToolName(toolPart)}
                                </div>
                                <span className="rounded bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">
                                  {'state' in toolPart ? getToolStatusLabel(toolPart.state) : 'Running'}
                                </span>
                              </div>

                              {hasInput && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-gray-600">Input</summary>
                                  <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-[11px] text-gray-800">
                                    {stringifyJson(toolPart.input)}
                                  </pre>
                                </details>
                              )}

                              {hasOutput && (
                                <details className="mt-2">
                                  <summary className="cursor-pointer text-gray-600">Output</summary>
                                  <pre className="mt-1 overflow-x-auto rounded bg-gray-100 p-2 text-[11px] text-gray-800">
                                    {stringifyJson(toolPart.output)}
                                  </pre>
                                </details>
                              )}

                              {hasErrorText && (
                                <div className="mt-2 rounded bg-red-50 px-2 py-1 text-red-700">{toolPart.errorText}</div>
                              )}
                            </div>
                          );
                        }

                        return null;
                      })}

                      {!hasText && hasToolOutput && !isStreaming && (
                        <div>{TOOL_ONLY_FALLBACK_MESSAGE}</div>
                      )}
                    </div>
                  </div>
                );
              })}

              {showThinking && (
                <div className="mr-8 rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-700">
                  <div className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Thinking...
                  </div>
                </div>
              )}
            </div>

            <div className="border-t border-gray-200 p-3">
              {currentError && <div className="mb-2 text-xs text-red-600">{currentError}</div>}
              <div className="flex items-center gap-2">
                <input
                  className="input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void handleSend();
                    }
                  }}
                  placeholder="Ask the assistant..."
                />
                <button className="btn btn-primary" onClick={() => void handleSend()} disabled={!canSend}>
                  <Send className="h-4 w-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
