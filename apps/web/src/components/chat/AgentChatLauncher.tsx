import { lazy, Suspense, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MessageSquare } from 'lucide-react';
import { agentApi } from '../../api/agents';
import { queryKeys } from '../../api/queryKeys';

/** The chat panel pulls in the AI SDK and the markdown stack: load it on first open only. */
const GlobalAgentChat = lazy(() => import('./GlobalAgentChat'));

/**
 * Floating "Chat" button. Shown only when the workspace has an active agent
 * and a provider key; the panel is code-split and mounted after the first
 * click, then kept mounted so the conversation survives closing it.
 */
export function AgentChatLauncher({ workspaceId }: { workspaceId: string | null }) {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  const { data: availability } = useQuery({
    queryKey: queryKeys.workspaces.agentAvailability(workspaceId ?? ''),
    queryFn: () => agentApi.availability(workspaceId ?? ''),
    enabled: Boolean(workspaceId),
    staleTime: 5 * 60_000,
    retry: false,
  });

  if (!workspaceId || !availability?.enabled) return null;

  return (
    <>
      <button
        type="button"
        className="fixed bottom-6 right-6 z-40 inline-flex items-center gap-2 rounded-full bg-neutral-900 px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-neutral-800"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
      >
        <MessageSquare className="h-4 w-4" aria-hidden />
        Chat
      </button>
      {mounted && (
        <Suspense fallback={null}>
          <GlobalAgentChat key={workspaceId} workspaceId={workspaceId} open={open} onOpenChange={setOpen} />
        </Suspense>
      )}
    </>
  );
}
