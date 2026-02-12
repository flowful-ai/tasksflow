import { useEffect, useMemo, useState } from 'react';
import { MessageSquare, X, Send, Bot } from 'lucide-react';
import { agentApi, workspaceAiSettingsApi, type AgentSummary } from '../../api/client';
import { useWorkspaceStore } from '../../stores/workspace';
import { useAuthStore } from '../../stores/auth';

const API_BASE_URL = import.meta.env.VITE_API_URL || '';

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

function storageKey(userId: string, workspaceId: string, key: 'agent' | 'model'): string {
  return `flowtask:chat:${key}:${workspaceId}:${userId}`;
}

export function GlobalAgentChat() {
  const { currentWorkspace } = useWorkspaceStore();
  const userId = useAuthStore((state) => state.user?.id ?? null);

  const [isOpen, setIsOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [agents, setAgents] = useState<AgentSummary[]>([]);
  const [defaultAgentId, setDefaultAgentId] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string>('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    const rememberedAgentId = localStorage.getItem(storageKey(userId, currentWorkspace.id, 'agent'));
    const nextAgentId =
      (rememberedAgentId && agents.some((agent) => agent.id === rememberedAgentId) && rememberedAgentId) ||
      (defaultAgentId && agents.some((agent) => agent.id === defaultAgentId) && defaultAgentId) ||
      agents[0]?.id ||
      '';

    setSelectedAgentId(nextAgentId);
  }, [agents, defaultAgentId, currentWorkspace, userId]);

  useEffect(() => {
    if (!currentWorkspace || !userId || !selectedAgentId) return;
    localStorage.setItem(storageKey(userId, currentWorkspace.id, 'agent'), selectedAgentId);
  }, [selectedAgentId, currentWorkspace, userId]);

  const canSend = useMemo(() => {
    return enabled && !!selectedAgentId && input.trim().length > 0 && !isSending;
  }, [enabled, selectedAgentId, input, isSending]);

  const removeTrailingEmptyAssistantMessage = () => {
    setMessages((previous) => {
      const copy = [...previous];
      const last = copy[copy.length - 1];
      if (!last || last.role !== 'assistant' || last.content.trim().length > 0) {
        return previous;
      }
      copy.pop();
      return copy;
    });
  };

  const handleSend = async () => {
    if (!canSend) return;

    const userMessage: ChatMessage = { role: 'user', content: input.trim() };
    const nextMessages = [...messages.filter((message) => message.content.trim().length > 0), userMessage];

    setMessages([...nextMessages, { role: 'assistant', content: '' }]);
    setInput('');
    setError(null);
    setIsSending(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/agents/${selectedAgentId}/execute`, {
        method: 'POST',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messages: nextMessages,
        }),
      });

      if (!response.ok || !response.body) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error?.message || 'Failed to execute agent');
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let hasAssistantText = false;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        if (!chunk) {
          continue;
        }
        if (!hasAssistantText && chunk.trim().length > 0) {
          hasAssistantText = true;
        }
        setMessages((previous) => {
          const copy = [...previous];
          const last = copy[copy.length - 1];
          if (!last || last.role !== 'assistant') return previous;
          copy[copy.length - 1] = { ...last, content: `${last.content}${chunk}` };
          return copy;
        });
      }

      const trailingChunk = decoder.decode();
      if (trailingChunk) {
        if (!hasAssistantText && trailingChunk.trim().length > 0) {
          hasAssistantText = true;
        }
        setMessages((previous) => {
          const copy = [...previous];
          const last = copy[copy.length - 1];
          if (!last || last.role !== 'assistant') return previous;
          copy[copy.length - 1] = { ...last, content: `${last.content}${trailingChunk}` };
          return copy;
        });
      }

      if (!hasAssistantText) {
        removeTrailingEmptyAssistantMessage();
        setError('Assistant returned an empty response. Please try again.');
      }
    } catch (err) {
      removeTrailingEmptyAssistantMessage();
      setError(err instanceof Error ? err.message : 'Agent execution failed');
    } finally {
      setIsSending(false);
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
              <select className="input" value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)}>
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
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={message.role === 'user' ? 'ml-8 rounded-xl bg-neutral-900 px-3 py-2 text-sm text-white' : 'mr-8 rounded-xl bg-gray-100 px-3 py-2 text-sm text-gray-800'}
                >
                  {message.content}
                </div>
              ))}
            </div>

            <div className="border-t border-gray-200 p-3">
              {error && <div className="mb-2 text-xs text-red-600">{error}</div>}
              <div className="flex items-center gap-2">
                <input
                  className="input"
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask the assistant..."
                />
                <button className="btn btn-primary" onClick={handleSend} disabled={!canSend}>
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
