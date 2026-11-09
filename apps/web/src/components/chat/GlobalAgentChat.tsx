import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Bot, Loader2, Square, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithApprovalResponses } from 'ai';
import { agentApi } from '../../api/agents';
import { workspaceAiSettingsApi } from '../../api/workspaces';
import { API_BASE_URL } from '../../api/http';
import { queryKeys } from '../../api/queryKeys';
import { useAuthStore } from '../../stores/auth';
import { Dialog, IconButton, Input, Select } from '../ui';
import { ChatMessage } from './ChatMessage';
import { hasVisibleOutput } from './message-state';

const AUTO_SCROLL_THRESHOLD_PX = 64;
/** Re-render the streaming reply at most this often (ms). */
const STREAM_THROTTLE_MS = 50;

function storageKey(userId: string, workspaceId: string): string {
  return `flowtask:chat:agent:${workspaceId}:${userId}`;
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
    // Batch streamed tokens: re-render at most every 50 ms instead of per chunk.
    experimental_throttle: STREAM_THROTTLE_MS,
    // After the user approves or denies every pending tool call, send the
    // decisions back so the server can run (or skip) the approved calls.
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const isStreaming = status === 'submitted' || status === 'streaming';

  const handleToolApproval = useCallback(
    (approvalId: string, approved: boolean) => {
      void addToolApprovalResponse(
        approved
          ? { id: approvalId, approved: true }
          : { id: approvalId, approved: false, reason: 'The user denied this action.' }
      );
    },
    [addToolApprovalResponse]
  );

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

  const canSend = !!selectedAgentId && input.trim().length > 0 && !isStreaming;
  const lastMessage = messages.at(-1);
  // From submit until the reply shows text, a tool call or reasoning.
  const showThinking = isStreaming && !hasVisibleOutput(lastMessage);
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
    shouldAutoScrollRef.current = true;

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
        <Select
          aria-label="Agent"
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
        </Select>
      </div>

      <div
        ref={messagesContainerRef}
        onScroll={handleMessagesScroll}
        aria-busy={isStreaming}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3"
      >
        {messages.length === 0 && (
          <div className="text-sm text-neutral-500">
            Ask anything about your workspace, tasks, and projects.
          </div>
        )}
        {messages.map((message, index) => (
          <ChatMessage
            key={message.id}
            message={message}
            streaming={isStreaming && index === messages.length - 1}
            onToolApproval={handleToolApproval}
          />
        ))}

        {showThinking && (
          <div
            role="status"
            className="mr-8 inline-flex items-center gap-2 rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-600"
          >
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Thinking…
          </div>
        )}
      </div>

      <form
        className="border-t border-neutral-200 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSend();
        }}
      >
        {currentError && <div className="mb-2 text-xs text-red-600">{currentError}</div>}
        <div className="flex items-center gap-2">
          <Input
            aria-label="Message"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Ask the assistant..."
          />
          {isStreaming ? (
            <IconButton
              label="Stop generating"
              variant="solid"
              size="md"
              className="!rounded-full"
              icon={<Square className="!h-3.5 !w-3.5 fill-current" />}
              onClick={() => void stop()}
            />
          ) : (
            <IconButton
              type="submit"
              label="Send message"
              variant="solid"
              size="md"
              className="!rounded-full"
              icon={<ArrowUp />}
              disabled={!canSend}
            />
          )}
        </div>
      </form>
    </Dialog>
  );
}
