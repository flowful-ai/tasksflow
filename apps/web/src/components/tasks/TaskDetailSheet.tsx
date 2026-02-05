import { useState, useEffect, useRef } from 'react';
import { X, Pencil, Check, Clock, MessageSquare, Send } from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import { api } from '../../api/client';
import clsx from 'clsx';
import { AssigneePicker } from './AssigneePicker';
import { LabelPicker } from './LabelPicker';
import { DueDatePicker } from './DueDatePicker';
import { GitHubLinkSection } from './GitHubLinkSection';

interface TaskState {
  id: string;
  name: string;
  color: string | null;
  category: string;
}

interface TaskDetailSheetProps {
  taskId: string;
  projectId: string;
  states: TaskState[];
  onClose: () => void;
  onUpdated?: () => void;
}

interface TaskDetail {
  id: string;
  title: string;
  description: string | null;
  priority: string | null;
  stateId: string | null;
  state: { id: string; name: string; color: string | null; category: string } | null;
  project: { id: string; identifier: string; name: string };
  assignees: { id: string; name: string | null; email: string }[];
  labels: { id: string; name: string; color: string | null }[];
  externalLinks: {
    id: string;
    externalType: 'github_issue' | 'github_pr';
    externalId: string;
    externalUrl: string;
  }[];
  sequenceNumber: number;
  dueDate: string | null;
  startDate: string | null;
  createdAt: string;
  updatedAt: string | null;
}

interface ProjectDetail {
  id: string;
  workspaceId: string;
  name: string;
  labels: { id: string; name: string; color: string | null }[];
}

interface WorkspaceDetail {
  id: string;
  name: string;
  members: {
    userId: string;
    role: string;
    user: {
      id: string;
      name: string | null;
      email: string;
    };
  }[];
}

interface Comment {
  id: string;
  taskId: string;
  userId: string | null;
  agentId: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  user: {
    id: string;
    name: string | null;
    email: string;
  } | null;
  agent: {
    id: string;
    name: string;
  } | null;
}

export function TaskDetailSheet({
  taskId,
  projectId,
  states,
  onClose,
  onUpdated,
}: TaskDetailSheetProps) {
  const queryClient = useQueryClient();

  // Edit states
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [newComment, setNewComment] = useState('');

  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch task details
  const { data: task, isLoading } = useQuery({
    queryKey: ['task', taskId],
    queryFn: async () => {
      const response = await api.get<{ data: TaskDetail }>(`/api/tasks/${taskId}`);
      return response.data;
    },
  });

  // Fetch project details (includes labels and workspaceId)
  const { data: projectDetail } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const response = await api.get<{ data: ProjectDetail }>(`/api/projects/${projectId}`);
      return response.data;
    },
    enabled: !!projectId,
  });

  // Fetch workspace members
  const { data: workspaceDetail } = useQuery({
    queryKey: ['workspace', projectDetail?.workspaceId],
    queryFn: async () => {
      const response = await api.get<{ data: WorkspaceDetail }>(
        `/api/workspaces/${projectDetail!.workspaceId}`
      );
      return response.data;
    },
    enabled: !!projectDetail?.workspaceId,
  });

  // Fetch comments for the task
  const { data: comments = [], isLoading: isLoadingComments } = useQuery({
    queryKey: ['comments', taskId],
    queryFn: async () => {
      const response = await api.get<{ success: boolean; data: Comment[] }>(
        `/api/tasks/${taskId}/comments`
      );
      return response.data;
    },
    enabled: !!taskId,
  });

  // Initialize edit values when task loads
  useEffect(() => {
    if (task) {
      setEditTitle(task.title);
      setEditDescription(task.description || '');
    }
  }, [task]);

  // Focus input when entering edit mode
  useEffect(() => {
    if (isEditingTitle && titleInputRef.current) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, [isEditingTitle]);

  useEffect(() => {
    if (isEditingDescription && descriptionInputRef.current) {
      descriptionInputRef.current.focus();
    }
  }, [isEditingDescription]);

  // Helper to invalidate all task-related queries including smart views
  const invalidateTaskQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['task', taskId] });
    queryClient.invalidateQueries({ queryKey: ['tasks', projectId] });
    // Invalidate all smart view execute queries since task changes may affect filter results
    queryClient.invalidateQueries({ queryKey: ['smart-view-execute'] });
  };

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (data: {
      title?: string;
      description?: string;
      stateId?: string;
      priority?: string;
      dueDate?: string | null;
    }) => {
      return api.patch(`/api/tasks/${taskId}`, data);
    },
    onSuccess: () => {
      invalidateTaskQueries();
      onUpdated?.();
    },
  });

  // Add assignee mutation
  const addAssigneeMutation = useMutation({
    mutationFn: async (userId: string) => {
      return api.post(`/api/tasks/${taskId}/assignees`, { userId });
    },
    onSuccess: () => {
      invalidateTaskQueries();
      onUpdated?.();
    },
  });

  // Remove assignee mutation
  const removeAssigneeMutation = useMutation({
    mutationFn: async (userId: string) => {
      return api.delete(`/api/tasks/${taskId}/assignees/${userId}`);
    },
    onSuccess: () => {
      invalidateTaskQueries();
      onUpdated?.();
    },
  });

  // Add label mutation
  const addLabelMutation = useMutation({
    mutationFn: async (labelId: string) => {
      return api.post(`/api/tasks/${taskId}/labels`, { labelId });
    },
    onSuccess: () => {
      invalidateTaskQueries();
      onUpdated?.();
    },
  });

  // Remove label mutation
  const removeLabelMutation = useMutation({
    mutationFn: async (labelId: string) => {
      return api.delete(`/api/tasks/${taskId}/labels/${labelId}`);
    },
    onSuccess: () => {
      invalidateTaskQueries();
      onUpdated?.();
    },
  });

  // Create comment mutation
  const createCommentMutation = useMutation({
    mutationFn: async (content: string) => {
      return api.post(`/api/tasks/${taskId}/comments`, { content });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['comments', taskId] });
      setNewComment('');
    },
  });

  const handleSaveTitle = async () => {
    if (editTitle.trim() && editTitle !== task?.title) {
      await updateMutation.mutateAsync({ title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleSaveDescription = async () => {
    const newDesc = editDescription.trim();
    if (newDesc !== (task?.description || '')) {
      await updateMutation.mutateAsync({ description: newDesc || undefined });
    }
    setIsEditingDescription(false);
  };

  const handleStatusChange = async (newStateId: string) => {
    if (newStateId && newStateId !== task?.stateId) {
      await updateMutation.mutateAsync({ stateId: newStateId });
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    if (newPriority !== task?.priority) {
      await updateMutation.mutateAsync({ priority: newPriority || undefined });
    }
  };

  const handleDueDateChange = async (date: string | null) => {
    await updateMutation.mutateAsync({ dueDate: date });
  };

  const handleSubmitComment = async () => {
    if (newComment.trim()) {
      await createCommentMutation.mutateAsync(newComment.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent, onSave: () => void, onCancel: () => void) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      onSave();
    } else if (e.key === 'Escape') {
      onCancel();
    }
  };

  const priorityOptions = [
    { value: '', label: 'No priority', className: 'text-gray-500' },
    { value: 'urgent', label: 'Urgent', className: 'text-red-600' },
    { value: 'high', label: 'High', className: 'text-orange-600' },
    { value: 'medium', label: 'Medium', className: 'text-yellow-600' },
    { value: 'low', label: 'Low', className: 'text-green-600' },
  ];

  if (isLoading) {
    return (
      <div className="fixed inset-0 z-50 flex">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />
        <div className="relative z-10 ml-auto w-full max-w-xl bg-white shadow-xl animate-slide-in-right">
          <div className="flex items-center justify-center h-64">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="fixed inset-0 z-50 flex">
        <div className="absolute inset-0 bg-black/30" onClick={onClose} />
        <div className="relative z-10 ml-auto w-full max-w-xl bg-white shadow-xl">
          <div className="p-6 text-center">
            <p className="text-gray-500">Task not found</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Sheet */}
      <div className="relative z-10 ml-auto w-full max-w-xl bg-white shadow-xl flex flex-col animate-slide-in-right">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center space-x-2 text-sm text-gray-500">
            <span className="font-medium text-gray-700">
              {task.project.identifier}-{task.sequenceNumber}
            </span>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500 hover:text-gray-700 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Title */}
            <div className="group">
              {isEditingTitle ? (
                <div className="flex items-center space-x-2">
                  <input
                    ref={titleInputRef}
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onBlur={handleSaveTitle}
                    onKeyDown={(e) =>
                      handleKeyDown(e, handleSaveTitle, () => {
                        setEditTitle(task.title);
                        setIsEditingTitle(false);
                      })
                    }
                    className="flex-1 text-xl font-semibold text-gray-900 px-2 py-1 border border-primary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
                    disabled={updateMutation.isPending}
                  />
                  <button
                    onClick={handleSaveTitle}
                    disabled={updateMutation.isPending}
                    className="p-1.5 rounded-lg bg-primary-600 text-white hover:bg-primary-700 disabled:opacity-50"
                  >
                    <Check className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="flex items-start space-x-2">
                  <h1 className="flex-1 text-xl font-semibold text-gray-900">{task.title}</h1>
                  <button
                    onClick={() => setIsEditingTitle(true)}
                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Edit title"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                </div>
              )}
            </div>

            {/* Status & Priority Row */}
            <div className="grid grid-cols-2 gap-4">
              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1.5">Status</label>
                <select
                  value={task.stateId || ''}
                  onChange={(e) => handleStatusChange(e.target.value)}
                  disabled={updateMutation.isPending}
                  className="w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:opacity-50"
                  style={{
                    borderLeftColor: task.state?.color || undefined,
                    borderLeftWidth: task.state?.color ? '4px' : undefined,
                  }}
                >
                  {states.map((state) => (
                    <option key={state.id} value={state.id}>
                      {state.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Priority */}
              <div>
                <label className="block text-sm font-medium text-gray-500 mb-1.5">Priority</label>
                <select
                  value={task.priority || ''}
                  onChange={(e) => handlePriorityChange(e.target.value)}
                  disabled={updateMutation.isPending}
                  className={clsx(
                    'w-full px-3 py-2 text-sm bg-white border border-gray-200 rounded-lg hover:border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:opacity-50',
                    task.priority && 'font-medium'
                  )}
                >
                  {priorityOptions.map((option) => (
                    <option key={option.value} value={option.value} className={option.className}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Description */}
            <div className="group">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-sm font-medium text-gray-500">Description</label>
                {!isEditingDescription && (
                  <button
                    onClick={() => setIsEditingDescription(true)}
                    className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="Edit description"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {isEditingDescription ? (
                <div className="space-y-2">
                  <textarea
                    ref={descriptionInputRef}
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditDescription(task.description || '');
                        setIsEditingDescription(false);
                      }
                    }}
                    className="w-full min-h-[120px] px-3 py-2 text-sm border border-primary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-y"
                    placeholder="Add a description..."
                    disabled={updateMutation.isPending}
                  />
                  <div className="flex justify-end space-x-2">
                    <button
                      onClick={() => {
                        setEditDescription(task.description || '');
                        setIsEditingDescription(false);
                      }}
                      className="px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-100 rounded-lg"
                      disabled={updateMutation.isPending}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveDescription}
                      disabled={updateMutation.isPending}
                      className="px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50"
                    >
                      {updateMutation.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => setIsEditingDescription(true)}
                  className="min-h-[60px] px-3 py-2 bg-gray-50 rounded-lg cursor-pointer hover:bg-gray-100 transition-colors"
                >
                  {task.description ? (
                    <ReactMarkdown
                      components={{
                        h1: ({ children }) => (
                          <h1 className="text-xl font-semibold text-gray-900 mb-2">{children}</h1>
                        ),
                        h2: ({ children }) => (
                          <h2 className="text-lg font-semibold text-gray-900 mb-2">{children}</h2>
                        ),
                        h3: ({ children }) => (
                          <h3 className="text-base font-semibold text-gray-900 mb-1">{children}</h3>
                        ),
                        p: ({ children }) => (
                          <p className="text-sm text-gray-600 mb-2 last:mb-0">{children}</p>
                        ),
                        strong: ({ children }) => (
                          <strong className="font-semibold text-gray-900">{children}</strong>
                        ),
                        em: ({ children }) => <em className="italic">{children}</em>,
                        ul: ({ children }) => (
                          <ul className="list-disc list-inside text-sm text-gray-600 mb-2 space-y-1">
                            {children}
                          </ul>
                        ),
                        ol: ({ children }) => (
                          <ol className="list-decimal list-inside text-sm text-gray-600 mb-2 space-y-1">
                            {children}
                          </ol>
                        ),
                        li: ({ children }) => <li>{children}</li>,
                        a: ({ href, children }) => (
                          <a href={href} className="text-primary-600 hover:underline">
                            {children}
                          </a>
                        ),
                        code: ({ children }) => (
                          <code className="text-xs bg-gray-200 text-gray-800 px-1 py-0.5 rounded">
                            {children}
                          </code>
                        ),
                        pre: ({ children }) => (
                          <pre className="bg-gray-800 text-gray-100 p-3 rounded-lg text-xs overflow-x-auto mb-2">
                            {children}
                          </pre>
                        ),
                        blockquote: ({ children }) => (
                          <blockquote className="border-l-4 border-gray-300 pl-3 italic text-gray-500 text-sm mb-2">
                            {children}
                          </blockquote>
                        ),
                      }}
                    >
                      {task.description}
                    </ReactMarkdown>
                  ) : (
                    <span className="text-sm text-gray-400 italic">Click to add a description...</span>
                  )}
                </div>
              )}
            </div>

            {/* Divider */}
            <hr className="border-gray-200" />

            {/* Metadata */}
            <div className="space-y-4">
              {/* Assignees */}
              <AssigneePicker
                currentAssignees={task.assignees}
                workspaceMembers={workspaceDetail?.members || []}
                onAdd={(userId) => addAssigneeMutation.mutate(userId)}
                onRemove={(userId) => removeAssigneeMutation.mutate(userId)}
                isLoading={addAssigneeMutation.isPending || removeAssigneeMutation.isPending}
              />

              {/* Labels */}
              <LabelPicker
                currentLabels={task.labels}
                projectLabels={projectDetail?.labels || []}
                onAdd={(labelId) => addLabelMutation.mutate(labelId)}
                onRemove={(labelId) => removeLabelMutation.mutate(labelId)}
                isLoading={addLabelMutation.isPending || removeLabelMutation.isPending}
              />

              {/* Due Date */}
              <DueDatePicker
                value={task.dueDate}
                onChange={handleDueDateChange}
                isLoading={updateMutation.isPending}
              />

              {/* GitHub Links */}
              <GitHubLinkSection
                taskId={taskId}
                projectId={projectId}
                externalLinks={task.externalLinks || []}
                onUpdated={() => queryClient.invalidateQueries({ queryKey: ['task', taskId] })}
              />

              {/* Created */}
              <div>
                <div className="flex items-center space-x-2 text-sm font-medium text-gray-500 mb-2">
                  <Clock className="w-4 h-4" />
                  <span>Created</span>
                </div>
                <p className="text-sm text-gray-700">
                  {new Date(task.createdAt).toLocaleDateString(undefined, {
                    weekday: 'short',
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  })}
                </p>
              </div>
            </div>

            {/* Divider */}
            <hr className="border-gray-200" />

            {/* Comments */}
            <div>
              <div className="flex items-center space-x-2 text-sm font-medium text-gray-500 mb-4">
                <MessageSquare className="w-4 h-4" />
                <span>Comments</span>
                {comments.length > 0 && (
                  <span className="text-xs bg-gray-100 px-1.5 py-0.5 rounded-full">
                    {comments.length}
                  </span>
                )}
              </div>

              {/* Comment input */}
              <div className="mb-4">
                <div className="flex space-x-2">
                  <textarea
                    ref={commentInputRef}
                    value={newComment}
                    onChange={(e) => setNewComment(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                        e.preventDefault();
                        handleSubmitComment();
                      }
                    }}
                    placeholder="Add a comment..."
                    rows={2}
                    className="flex-1 px-3 py-2 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                    disabled={createCommentMutation.isPending}
                  />
                  <button
                    onClick={handleSubmitComment}
                    disabled={!newComment.trim() || createCommentMutation.isPending}
                    className="self-end px-3 py-2 bg-primary-600 text-white rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    title="Submit comment (Cmd+Enter)"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <p className="mt-1 text-xs text-gray-400">Press Cmd+Enter to submit</p>
              </div>

              {/* Comments list */}
              <div className="space-y-4">
                {isLoadingComments ? (
                  <div className="flex items-center justify-center py-4">
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-primary-600" />
                  </div>
                ) : comments.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No comments yet</p>
                ) : (
                  comments.map((comment) => (
                    <div key={comment.id} className="bg-gray-50 rounded-lg p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-gray-700">
                            {comment.agent?.name || comment.user?.name || comment.user?.email || 'Unknown user'}
                          </span>
                          {comment.agent && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                              Agent
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-400">
                          {new Date(comment.createdAt).toLocaleDateString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                      <div className="prose prose-sm max-w-none">
                        <ReactMarkdown
                          components={{
                            p: ({ children }) => (
                              <p className="text-sm text-gray-600 mb-1 last:mb-0">{children}</p>
                            ),
                            strong: ({ children }) => (
                              <strong className="font-semibold text-gray-700">{children}</strong>
                            ),
                            em: ({ children }) => <em className="italic">{children}</em>,
                            ul: ({ children }) => (
                              <ul className="list-disc list-inside text-sm text-gray-600 mb-1 space-y-0.5">
                                {children}
                              </ul>
                            ),
                            ol: ({ children }) => (
                              <ol className="list-decimal list-inside text-sm text-gray-600 mb-1 space-y-0.5">
                                {children}
                              </ol>
                            ),
                            li: ({ children }) => <li>{children}</li>,
                            a: ({ href, children }) => (
                              <a
                                href={href}
                                className="text-primary-600 hover:underline"
                                target="_blank"
                                rel="noopener noreferrer"
                              >
                                {children}
                              </a>
                            ),
                            code: ({ children }) => (
                              <code className="text-xs bg-gray-200 text-gray-800 px-1 py-0.5 rounded">
                                {children}
                              </code>
                            ),
                          }}
                        >
                          {comment.content}
                        </ReactMarkdown>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
