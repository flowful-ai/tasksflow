import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceStore } from '../stores/workspace';
import { REALTIME_EVENTS } from '@flowtask/shared';

// Event data types
interface TaskEventData {
  id: string;
  projectId?: string;
  timestamp: string;
}

interface CommentEventData {
  taskId: string;
  commentId?: string;
  timestamp: string;
}

interface ProjectEventData {
  id: string;
  timestamp: string;
}

interface MemberEventData {
  workspaceId: string;
  userId: string;
  timestamp: string;
}

type EventData = TaskEventData | CommentEventData | ProjectEventData | MemberEventData;

/**
 * Hook to connect to the real-time SSE stream and invalidate queries on events.
 * Should be used at the app layout level to maintain a single connection.
 */
export function useRealtimeEvents() {
  const queryClient = useQueryClient();
  const { currentWorkspace } = useWorkspaceStore();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const hadErrorRef = useRef(false);

  // Handle incoming events by invalidating relevant queries
  const handleEvent = useCallback(
    (event: string, data: EventData) => {
      switch (event) {
        case REALTIME_EVENTS.TASK_CREATED: {
          const taskData = data as TaskEventData;
          if (taskData.projectId) {
            queryClient.invalidateQueries({ queryKey: ['tasks', taskData.projectId] });
          }
          queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
          queryClient.invalidateQueries({ queryKey: ['workspace-activity'] });
          break;
        }

        case REALTIME_EVENTS.TASK_DELETED: {
          const taskData = data as TaskEventData;
          if (taskData.id) {
            queryClient.invalidateQueries({ queryKey: ['task', taskData.id] });
          }
          if (taskData.projectId) {
            queryClient.invalidateQueries({ queryKey: ['tasks', taskData.projectId] });
          } else {
            queryClient.invalidateQueries({ queryKey: ['tasks'] });
          }
          queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
          queryClient.invalidateQueries({ queryKey: ['workspace-activity'] });
          break;
        }

        case REALTIME_EVENTS.TASK_UPDATED:
        case REALTIME_EVENTS.TASK_MOVED: {
          const taskData = data as TaskEventData;
          queryClient.invalidateQueries({ queryKey: ['task', taskData.id] });
          queryClient.invalidateQueries({ queryKey: ['tasks', taskData.projectId] });
          queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
          queryClient.invalidateQueries({ queryKey: ['workspace-activity'] });
          break;
        }

        case REALTIME_EVENTS.TASKS_REKEYED: {
          // Positions in a column were rewritten: refetch that project's tasks.
          const rekeyed = data as TaskEventData;
          queryClient.invalidateQueries({ queryKey: rekeyed.projectId ? ['tasks', rekeyed.projectId] : ['tasks'] });
          break;
        }

        case REALTIME_EVENTS.NOTIFICATION_CREATED: {
          queryClient.invalidateQueries({ queryKey: ['notifications'] });
          break;
        }

        case REALTIME_EVENTS.COMMENT_CREATED:
        case REALTIME_EVENTS.COMMENT_UPDATED:
        case REALTIME_EVENTS.COMMENT_DELETED: {
          const commentData = data as CommentEventData;
          queryClient.invalidateQueries({ queryKey: ['task', commentData.taskId] });
          queryClient.invalidateQueries({ queryKey: ['comments', commentData.taskId] });
          queryClient.invalidateQueries({ queryKey: ['workspace-activity'] });
          break;
        }

        case REALTIME_EVENTS.PROJECT_UPDATED: {
          const projectData = data as ProjectEventData;
          queryClient.invalidateQueries({ queryKey: ['project', projectData.id] });
          queryClient.invalidateQueries({ queryKey: ['projects'] });
          break;
        }

        case REALTIME_EVENTS.MEMBER_JOINED:
        case REALTIME_EVENTS.MEMBER_LEFT: {
          const memberData = data as MemberEventData;
          queryClient.invalidateQueries({ queryKey: ['workspace', memberData.workspaceId] });
          queryClient.invalidateQueries({ queryKey: ['workspace-members', memberData.workspaceId] });
          break;
        }
      }
    },
    [queryClient]
  );

  // Connect to SSE stream
  const connect = useCallback(() => {
    if (!currentWorkspace?.id) return;

    // Close existing connection
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    // Same origin by default: in production the API serves the SPA.
    const apiUrl = import.meta.env.VITE_API_URL || '';
    const url = `${apiUrl}/api/events/stream?workspaceId=${currentWorkspace.id}`;

    const eventSource = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      reconnectAttemptRef.current = 0;
      // Events published while we were disconnected are gone: resync everything.
      if (hadErrorRef.current) {
        hadErrorRef.current = false;
        queryClient.invalidateQueries();
      }
    };

    eventSource.onerror = () => {
      hadErrorRef.current = true;
      // While CONNECTING the browser retries on its own (honouring the server's
      // `retry:` hint). Only a CLOSED stream (e.g. auth failure) needs us to
      // reconnect, with exponential backoff and jitter.
      if (eventSource.readyState !== EventSource.CLOSED) return;
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      const attempt = reconnectAttemptRef.current++;
      const delay = Math.min(30_000, 1000 * 2 ** attempt) * (0.5 + Math.random() / 2);
      reconnectTimeoutRef.current = setTimeout(connect, delay);
    };

    // Listen for specific event types
    const events = Object.values(REALTIME_EVENTS) as string[];
    for (const event of events) {
      eventSource.addEventListener(event, (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as EventData;
          handleEvent(event, data);
        } catch (error) {
          console.error('Failed to parse SSE event data:', error);
        }
      });
    }

  }, [currentWorkspace?.id, handleEvent, queryClient]);

  // Connect on mount and workspace change
  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
        reconnectTimeoutRef.current = null;
      }
    };
  }, [connect]);

  // Reconnect when window regains focus
  useEffect(() => {
    const handleFocus = () => {
      if (eventSourceRef.current?.readyState === EventSource.CLOSED) {
        connect();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [connect]);
}
