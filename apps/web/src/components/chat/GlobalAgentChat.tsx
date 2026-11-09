import { useEffect, useMemo, useRef, useState } from 'react';
import { Send, Bot, Wrench, Loader2, ShieldAlert, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { useChat } from '@ai-sdk/react';
import {
  DefaultChatTransport,
  getToolName,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type DynamicToolUIPart,
  type ToolUIPart,
  type UIMessage,
} from 'ai';
import type { Components } from 'react-markdown';
import { agentApi } from '../../api/agents';
import { workspaceAiSettingsApi } from '../../api/workspaces';
import { API_BASE_URL } from '../../api/http';
import { queryKeys } from '../../api/queryKeys';
import { useAuthStore } from '../../stores/auth';
import { Dialog } from '../ui/Dialog';
import { IconButton } from '../ui/IconButton';
const TOOL_ONLY_FALLBACK_MESSAGE = 'Done. I completed the requested actions.';
const AUTO_SCROLL_THRESHOLD_PX = 64;

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

type AnyToolPart = ToolUIPart | DynamicToolUIPart;

function getToolStatusLabel(part: AnyToolPart): string {
  switch (part.state) {
    case 'input-streaming':
      return 'Preparing...';
    case 'input-available':
      return 'Running';
    case 'approval-requested':
      return 'Needs approval';
    case 'approval-responded':
      return part.approval.approved ? 'Approved' : 'Denied';
    case 'output-available':
      return 'Completed';
    case 'output-error':
      return 'Failed';
    case 'output-denied':
      return 'Denied';
  }
}

/**
 * Remote images are never loaded: an image URL chosen by the model (or by
 * injected task text) could carry workspace data to a third party.
 */
const MarkdownImage: Components['img'] = ({ src, alt }) => {
  const label = alt?.trim() ? alt : 'image';
  if (typeof src !== 'string' || !src) {
    return <span className="italic text-neutral-500">[{label}]</span>;
  }
  return (
    <a
      href={src}
      className="text-primary-600 underline"
      target="_blank"
      rel="noopener noreferrer nofollow"
    >
      [image: {label}]
    </a>
  );
};

function getUserMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
}

export interface GlobalAgentChatProps {
  workspaceId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * Workspace chat panel. Lazy-loaded (it pulls in the AI SDK and markdown) by
 * AgentChatLauncher on first open, then kept mounted so the conversation
 * survives closing the panel.
 */
export default function GlobalAgentChat({
  workspaceId,
  open: isOpen,
  onOpenChange: setIsOpen,
}: GlobalAgentChatProps) {
  const userId = useAuthStore((state) => state.user?.id ?? null);

  const { data: agents = [] } = useQuery({
    queryKey: queryKeys.workspaces.agents(workspaceId, true),
    queryFn: () => agentApi.list(workspaceId, true),
  });
  const { data: defaultAgentId = null } = useQuery({
    queryKey: queryKeys.workspaces.aiSettings(workspaceId),
    queryFn: () => workspaceAiSettingsApi.get(workspaceId),
    select: (settings) => settings.defaultAgentId,
  });
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [input, setInput] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const selectedAgentIdRef = useRef<string>('');
  const messagesContainerRef = useRef<HTMLDivElement | null>(null);
  const shouldAutoScrollRef = useRef(true);

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
            body: {
              id: options.id,
              messages: options.messages,
              trigger: options.trigger,
              messageId: options.messageId,
              ...(options.body ?? {}),
            },
          };
        },
      }),
    []
  );

  const {
    messages,
    status,
    sendMessage,
    stop,
    addToolApprovalResponse,
    error: chatError,
  } = useChat({
    transport,
    // After the user approves or denies every pending tool call, send the
    // decisions back so the server can run (or skip) the approved calls.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const isStreaming = status === 'submitted' || status === 'streaming';

  useEffect(() => {
    if (!userId || agents.length === 0) return;

    let rememberedAgentId: string | null = null;
    try {
      rememberedAgentId = localStorage.getItem(storageKey(userId, workspaceId));
    } catch {
      // storage unavailable (private mode)
    }
    const nextAgentId =
      (rememberedAgentId &&
        agents.some((agent) => agent.id === rememberedAgentId) &&
        rememberedAgentId) ||
      (defaultAgentId && agents.some((agent) => agent.id === defaultAgentId) && defaultAgentId) ||
      agents[0]?.id ||
      '';

    setSelectedAgentId(nextAgentId);
  }, [agents, defaultAgentId, workspaceId, userId]);

  useEffect(() => {
    if (!userId || !selectedAgentId) return;
    try {
      localStorage.setItem(storageKey(userId, workspaceId), selectedAgentId);
    } catch {
      // storage unavailable (private mode)
    }
  }, [selectedAgentId, workspaceId, userId]);

  const canSend = useMemo(() => {
    return !!selectedAgentId && input.trim().length > 0 && !isStreaming;
  }, [selectedAgentId, input, isStreaming]);

  const lastAssistantMessage = [...messages]
    .reverse()
    .find((message) => message.role === 'assistant');
  const lastAssistantHasVisibleOutput = !!lastAssistantMessage?.parts.some(
    (part) => (part.type === 'text' && part.text.trim().length > 0) || isToolUIPart(part)
  );
  const showThinking = isStreaming && !lastAssistantHasVisibleOutput;
  const currentError = errorMessage || chatError?.message || null;

  const handleMessagesScroll = () => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    shouldAutoScrollRef.current = distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX;
  };

  useEffect(() => {
    if (!isOpen) return;
    const container = messagesContainerRef.current;
    if (!container || !shouldAutoScrollRef.current) return;

    const frame = requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });

    return () => cancelAnimationFrame(frame);
  }, [messages, showThinking, isOpen]);

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

  if (!userId) {
    return null;
  }

  return (
    <Dialog
      open={isOpen}
      onOpenChange={setIsOpen}
      title="Workspace chat"
      bare
      className="!left-auto !top-auto !bottom-4 !right-4 !m-0 !h-[70vh] !max-w-md overflow-hidden border border-neutral-200"
    >
      <div className="flex items-center justify-between border-b border-neutral-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-primary-600" aria-hidden />
          <h2 className="text-sm font-semibold text-neutral-900">Workspace Chat</h2>
        </div>
        <IconButton label="Close chat" icon={<X />} onClick={() => setIsOpen(false)} />
      </div>

      <div className="border-b border-neutral-200 px-4 py-3">
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

      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        className="h-[calc(70vh-180px)] space-y-3 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 && (
          <div className="text-sm text-neutral-500">
            Ask anything about your workspace, tasks, and projects.
          </div>
        )}
        {messages.map((message) => {
          if (message.role === 'system') {
            return null;
          }

          if (message.role === 'user') {
            return (
              <div
                key={message.id}
                className="ml-8 rounded-xl bg-neutral-900 px-3 py-2 text-sm text-white"
              >
                <div className="whitespace-pre-wrap">{getUserMessageText(message)}</div>
              </div>
            );
          }

          const assistantParts = message.parts;
          const hasText = assistantParts.some(
            (part) => part.type === 'text' && part.text.trim().length > 0
          );
          const hasToolOutput = assistantParts.some((part) => isToolUIPart(part));

          return (
            <div
              key={message.id}
              className="mr-8 rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-800"
            >
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
                          strong: ({ children }) => (
                            <strong className="font-semibold text-neutral-900">{children}</strong>
                          ),
                          em: ({ children }) => <em className="italic">{children}</em>,
                          ul: ({ children }) => (
                            <ul className="mb-2 list-disc space-y-1 pl-5 last:mb-0">{children}</ul>
                          ),
                          ol: ({ children }) => (
                            <ol className="mb-2 list-decimal space-y-1 pl-5 last:mb-0">
                              {children}
                            </ol>
                          ),
                          a: ({ href, children }) => (
                            <a
                              href={href}
                              className="text-primary-600 underline"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {children}
                            </a>
                          ),
                          code: ({ children }) => (
                            <code className="rounded bg-neutral-200 px-1 py-0.5 text-xs text-neutral-900">
                              {children}
                            </code>
                          ),
                          table: ({ children }) => (
                            <table className="my-2 w-full border-collapse overflow-hidden rounded border border-neutral-300 text-left text-xs">
                              {children}
                            </table>
                          ),
                          thead: ({ children }) => (
                            <thead className="bg-neutral-200">{children}</thead>
                          ),
                          tbody: ({ children }) => <tbody>{children}</tbody>,
                          tr: ({ children }) => (
                            <tr className="border-b border-neutral-300 last:border-b-0">{children}</tr>
                          ),
                          th: ({ children }) => (
                            <th className="px-2 py-1 font-semibold text-neutral-900">{children}</th>
                          ),
                          td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,
                          img: MarkdownImage,
                        }}
                      >
                        {part.text}
                      </ReactMarkdown>
                    );
                  }

                  if (isToolUIPart(part)) {
                    const hasInput = part.input !== undefined;
                    const hasOutput = part.state === 'output-available';
                    const hasErrorText = part.state === 'output-error' && part.errorText.length > 0;

                    return (
                      <div
                        key={`${message.id}-tool-${index}`}
                        className="rounded-lg border border-neutral-300 bg-white p-2 text-xs text-neutral-700"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="inline-flex items-center gap-1.5 font-medium text-neutral-900">
                            <Wrench className="h-3.5 w-3.5" />
                            {getToolName(part)}
                          </div>
                          <span className="rounded bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-600">
                            {getToolStatusLabel(part)}
                          </span>
                        </div>

                        {hasInput && (
                          <details className="mt-2" open={part.state === 'approval-requested'}>
                            <summary className="cursor-pointer text-neutral-600">Input</summary>
                            <pre className="mt-1 overflow-x-auto rounded bg-neutral-100 p-2 text-[11px] text-neutral-800">
                              {stringifyJson(part.input)}
                            </pre>
                          </details>
                        )}

                        {part.state === 'approval-requested' && (
                          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-900">
                            <div className="mb-2 inline-flex items-center gap-1.5 font-medium">
                              <ShieldAlert className="h-3.5 w-3.5" />
                              This action changes workspace data. Allow it?
                            </div>
                            <div className="flex gap-2">
                              <button
                                type="button"
                                className="rounded bg-neutral-900 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-neutral-800"
                                onClick={() =>
                                  void addToolApprovalResponse({
                                    id: part.approval.id,
                                    approved: true,
                                  })
                                }
                              >
                                Approve
                              </button>
                              <button
                                type="button"
                                className="rounded border border-neutral-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-neutral-800 hover:bg-neutral-100"
                                onClick={() =>
                                  void addToolApprovalResponse({
                                    id: part.approval.id,
                                    approved: false,
                                    reason: 'The user denied this action.',
                                  })
                                }
                              >
                                Deny
                              </button>
                            </div>
                          </div>
                        )}

                        {hasOutput && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-neutral-600">Output</summary>
                            <pre className="mt-1 overflow-x-auto rounded bg-neutral-100 p-2 text-[11px] text-neutral-800">
                              {stringifyJson(part.output)}
                            </pre>
                          </details>
                        )}

                        {hasErrorText && (
                          <div className="mt-2 rounded bg-red-50 px-2 py-1 text-red-700">
                            {part.errorText}
                          </div>
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
          <div className="mr-8 rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-700">
            <div className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              Thinking...
            </div>
          </div>
        )}
      </div>

      <div className="border-t border-neutral-200 p-3">
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
          <IconButton
            label="Send message"
            variant="solid"
            size="md"
            icon={<Send />}
            onClick={() => void handleSend()}
            disabled={!canSend}
          />
        </div>
      </div>
    </Dialog>
  );
}
