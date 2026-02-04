import { useEffect, useRef, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspaceStore } from '../stores/workspace';
import { REALTIME_EVENTS } from '@flowtask/shared';

// Event data types
interface TaskEventData {
  id: string;
  projectId: string;
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

  // Handle incoming events by invalidating relevant queries
  const handleEvent = useCallback(
    (event: string, data: EventData) => {
      switch (event) {
        case REALTIME_EVENTS.TASK_CREATED:
        case REALTIME_EVENTS.TASK_DELETED: {
          const taskData = data as TaskEventData;
          queryClient.invalidateQueries({ queryKey: ['tasks', taskData.projectId] });
          queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
          break;
        }

        case REALTIME_EVENTS.TASK_UPDATED:
        case REALTIME_EVENTS.TASK_MOVED: {
          const taskData = data as TaskEventData;
          queryClient.invalidateQueries({ queryKey: ['task', taskData.id] });
          queryClient.invalidateQueries({ queryKey: ['tasks', taskData.projectId] });
          queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
          break;
        }

        case REALTIME_EVENTS.COMMENT_CREATED:
        case REALTIME_EVENTS.COMMENT_UPDATED:
        case REALTIME_EVENTS.COMMENT_DELETED: {
          const commentData = data as CommentEventData;
          queryClient.invalidateQueries({ queryKey: ['task', commentData.taskId] });
          queryClient.invalidateQueries({ queryKey: ['comments', commentData.taskId] });
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

    const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:3001';
    const url = `${apiUrl}/api/events/stream?workspaceId=${currentWorkspace.id}`;

    const eventSource = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = eventSource;

    eventSource.onopen = () => {
      console.log('SSE connected to workspace:', currentWorkspace.id);
    };

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      eventSource.close();

      // Reconnect after delay
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(() => {
        console.log('SSE reconnecting...');
        connect();
      }, 5000);
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

    // Handle connected event
    eventSource.addEventListener('connected', (e: MessageEvent) => {
      console.log('SSE connection confirmed:', e.data);
    });
  }, [currentWorkspace?.id, handleEvent]);

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
        console.log('SSE reconnecting after focus...');
        connect();
      }
    };

    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [connect]);
}
