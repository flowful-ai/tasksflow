import { useState, useEffect, useRef } from 'react';
import { X, Pencil, Check, Clock, MessageSquare, Send, Maximize2, Minimize2, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import clsx from 'clsx';
import { AssigneePicker } from './AssigneePicker';
import { LabelPicker } from './LabelPicker';
import { DueDatePicker } from './DueDatePicker';
import { GitHubLinkSection } from './GitHubLinkSection';
import { isTaskPriority } from './TaskModal';
import { useAuthStore } from '../../stores/auth';
import type { TaskExternalLinkDto, UpdateTaskInput } from '../../api/types';
import {
  useAddComment,
  useDeleteTask,
  useProject,
  useTask,
  useTaskComments,
  useTaskRelationsMutations,
  useUpdateTask,
  useWorkspace,
} from '../../hooks/queries';
import { ColorDot, Dialog, IconButton, PageSpinner, Spinner } from '../ui';

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
  readOnly?: boolean;
  /** Pre-loaded task data (for public share pages that already have the task) */
  initialTask?: TaskDetail;
}

/**
 * The fields the sheet displays. Both TaskDetailDto (authenticated) and the
 * public share task satisfy it.
 */
export interface TaskDetail {
  id: string;
  title: string;
  description: string | null;
  priority: string | null;
  stateId: string | null;
  state: { id: string; name: string; color: string | null; category?: string } | null;
  project: { id: string; identifier: string; name: string };
  assignees: { id: string; name: string | null; email: string; avatarUrl?: string | null }[];
  labels: { id: string; name: string; color: string | null }[];
  externalLinks?: TaskExternalLinkDto[];
  sequenceNumber: number;
  dueDate: string | null;
  startDate?: string | null;
  createdAt: string;
  updatedAt?: string | null;
}

export function TaskDetailSheet({
  taskId,
  projectId,
  states,
  onClose,
  onUpdated,
  readOnly = false,
  initialTask,
}: TaskDetailSheetProps) {
  const currentUserId = useAuthStore((state) => state.user?.id);

  // Edit states
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isEditingDescription, setIsEditingDescription] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [newComment, setNewComment] = useState('');

  const titleInputRef = useRef<HTMLInputElement>(null);
  const descriptionInputRef = useRef<HTMLTextAreaElement>(null);
  const commentInputRef = useRef<HTMLTextAreaElement>(null);

  // Fetch task details (skip if initialTask is provided or in readOnly mode)
  const { data: fetchedTask, isLoading, error: taskError, refetch } = useTask(taskId, {
    enabled: !initialTask && !readOnly,
  });

  // Use initialTask if provided, otherwise use fetched data
  const task: TaskDetail | undefined = initialTask || fetchedTask;

  // Project (labels, workspaceId), members and comments: skipped in readOnly mode
  const { data: projectDetail } = useProject(readOnly ? null : projectId);
  const { data: workspaceDetail } = useWorkspace(readOnly ? null : projectDetail?.workspaceId);
  const { data: comments = [], isLoading: isLoadingComments } = useTaskComments(readOnly ? null : taskId);

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

  const updateMutation = useUpdateTask();
  const relations = useTaskRelationsMutations(taskId, projectId);
  const createCommentMutation = useAddComment(taskId);
  const deleteMutation = useDeleteTask();

  /** Update the task; failures are toasted globally and leave the field as it was. */
  const update = async (input: Omit<UpdateTaskInput, 'assigneeIds' | 'labelIds'>) => {
    try {
      await updateMutation.mutateAsync({ taskId, ...input });
      onUpdated?.();
    } catch {
      // toasted by the MutationCache handler
    }
  };

  const withUpdated = { onSuccess: () => onUpdated?.() };

  // Check if current user can delete (owner or admin role)
  const currentMember = workspaceDetail?.members.find((m) => m.userId === currentUserId);
  const canDelete = !readOnly && (currentMember?.role === 'owner' || currentMember?.role === 'admin');

  /** Soft delete with an undo toast (no confirm); the sheet closes immediately. */
  const handleDelete = () => {
    if (!task) return;
    const label = `${task.project.identifier}-${task.sequenceNumber}`;
    deleteMutation.mutate({ taskId, projectId, label }, withUpdated);
    onClose();
  };

  const handleSaveTitle = async () => {
    if (editTitle.trim() && editTitle !== task?.title) {
      await update({ title: editTitle.trim() });
    }
    setIsEditingTitle(false);
  };

  const handleSaveDescription = async () => {
    const newDesc = editDescription.trim();
    if (newDesc !== (task?.description || '')) {
      await update({ description: newDesc });
    }
    setIsEditingDescription(false);
  };

  const handleStatusChange = async (newStateId: string) => {
    if (newStateId && newStateId !== task?.stateId) {
      await update({ stateId: newStateId });
    }
  };

  const handlePriorityChange = async (newPriority: string) => {
    if (newPriority !== (task?.priority ?? '')) {
      await update({ priority: isTaskPriority(newPriority) ? newPriority : null });
    }
  };

  const handleDueDateChange = async (date: string | null) => {
    await update({ dueDate: date });
  };

  const handleSubmitComment = async () => {
    if (!newComment.trim()) return;
    try {
      await createCommentMutation.mutateAsync(newComment.trim());
      setNewComment('');
    } catch {
      // toasted globally; keep the draft
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

  const taskKey = task ? `${task.project.identifier}-${task.sequenceNumber}` : 'Task';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      variant="sheet"
      size={isFullscreen ? 'full' : 'lg'}
      title={task ? `${taskKey}: ${task.title}` : 'Task'}
      bare
      className="animate-slide-in-right"
    >
      {isLoading && !task ? (
        <PageSpinner label="Loading task" />
      ) : !task ? (
        <div className="p-6 text-center">
          <p className="text-gray-500">{taskError ? "Couldn't load this task." : 'Task not found'}</p>
          {taskError && (
            <button type="button" className="btn btn-secondary mt-3" onClick={() => void refetch()}>
              Retry
            </button>
          )}
          <button type="button" className="btn btn-ghost mt-3 ml-2" onClick={onClose}>
            Close
          </button>
        </div>
      ) : (
        <>
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center space-x-2 text-sm text-gray-500">
            <span className="font-medium text-gray-700">{taskKey}</span>
          </div>
          <div className="flex items-center space-x-1">
            <IconButton
              label={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
              size="md"
              icon={isFullscreen ? <Minimize2 /> : <Maximize2 />}
              onClick={() => setIsFullscreen(!isFullscreen)}
            />
            {canDelete && (
              <IconButton
                label="Delete task"
                variant="danger"
                size="md"
                icon={<Trash2 />}
                onClick={handleDelete}
                disabled={deleteMutation.isPending}
              />
            )}
            <IconButton label="Close" size="md" icon={<X />} onClick={onClose} />
          </div>
        </header>

        {/* Content */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-6">
            {/* Title */}
            <div className="group">
              {isEditingTitle && !readOnly ? (
                <div className="flex items-center space-x-2">
                  <input
                    ref={titleInputRef}
                    type="text"
                    aria-label="Task title"
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
                  <IconButton
                    label="Save title"
                    variant="solid"
                    icon={<Check />}
                    onClick={handleSaveTitle}
                    disabled={updateMutation.isPending}
                  />
                </div>
              ) : (
                <div className="flex items-start space-x-2">
                  <h2 className="flex-1 text-xl font-semibold text-gray-900">{task.title}</h2>
                  {!readOnly && (
                    <IconButton
                      label="Edit title"
                      icon={<Pencil />}
                      onClick={() => setIsEditingTitle(true)}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                    />
                  )}
                </div>
              )}
            </div>

            {/* Status & Priority Row */}
            <div className="grid grid-cols-2 gap-4">
              {/* Status */}
              <div>
                <label htmlFor="sheet-status" className="block text-sm font-medium text-gray-500 mb-1.5">Status</label>
                {readOnly ? (
                  <div className="flex w-full items-center gap-2 px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg">
                    {task.state && <ColorDot color={task.state.color} />}
                    {task.state?.name || 'No status'}
                  </div>
                ) : (
                  <select
                    id="sheet-status"
                    value={task.stateId || ''}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    disabled={updateMutation.isPending}
                    className="w-full px-3 py-2 text-base md:text-sm bg-white border border-gray-200 rounded-lg hover:border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:opacity-50"
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
                )}
              </div>

              {/* Priority */}
              <div>
                <label htmlFor="sheet-priority" className="block text-sm font-medium text-gray-500 mb-1.5">Priority</label>
                {readOnly ? (
                  <div
                    className={clsx(
                      'w-full px-3 py-2 text-sm bg-gray-50 border border-gray-200 rounded-lg',
                      task.priority && 'font-medium'
                    )}
                  >
                    {priorityOptions.find((o) => o.value === (task.priority || ''))?.label || 'No priority'}
                  </div>
                ) : (
                  <select
                    id="sheet-priority"
                    value={task.priority || ''}
                    onChange={(e) => handlePriorityChange(e.target.value)}
                    disabled={updateMutation.isPending}
                    className={clsx(
                      'w-full px-3 py-2 text-base md:text-sm bg-white border border-gray-200 rounded-lg hover:border-gray-300 focus:ring-2 focus:ring-primary-500 focus:border-primary-500 transition-colors disabled:opacity-50',
                      task.priority && 'font-medium'
                    )}
                  >
                    {priorityOptions.map((option) => (
                      <option key={option.value} value={option.value} className={option.className}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>

            {/* Description */}
            <div className="group">
              <div className="flex items-center justify-between mb-1.5">
                <span id="sheet-description-label" className="text-sm font-medium text-gray-500">Description</span>
                {!isEditingDescription && !readOnly && (
                  <IconButton
                    label="Edit description"
                    size="xs"
                    icon={<Pencil />}
                    onClick={() => setIsEditingDescription(true)}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 transition-opacity"
                  />
                )}
              </div>
              {isEditingDescription && !readOnly ? (
                <div className="space-y-2">
                  <textarea
                    ref={descriptionInputRef}
                    aria-labelledby="sheet-description-label"
                    value={editDescription}
                    onChange={(e) => setEditDescription(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setEditDescription(task.description || '');
                        setIsEditingDescription(false);
                      }
                    }}
                    className="w-full min-h-[120px] px-3 py-2 text-base md:text-sm border border-primary-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-y"
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
                  onClick={readOnly ? undefined : () => setIsEditingDescription(true)}
                  className={clsx(
                    "min-h-[60px] px-3 py-2 bg-gray-50 rounded-lg transition-colors",
                    !readOnly && "cursor-pointer hover:bg-gray-100"
                  )}
                >
                  {task.description ? (
                    <ReactMarkdown
                      rehypePlugins={[rehypeSanitize]}
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
                    <span className="text-sm text-gray-400 italic">
                      {readOnly ? 'No description' : 'Click to add a description...'}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* Divider */}
            <hr className="border-gray-200" />

            {/* Metadata */}
            <div className="space-y-4">
              {/* Assignees */}
              {readOnly ? (
                <div>
                  <div className="flex items-center space-x-2 text-sm font-medium text-gray-500 mb-2">
                    <span className="w-4 h-4 flex items-center justify-center">👤</span>
                    <span>Assignees</span>
                  </div>
                  {task.assignees.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {task.assignees.map((assignee) => (
                        <div
                          key={assignee.id}
                          className="flex items-center space-x-2 px-2.5 py-1.5 bg-gray-100 rounded-full"
                        >
                          {assignee.avatarUrl ? (
                            <img src={assignee.avatarUrl} alt={assignee.name || assignee.email} className="w-5 h-5 rounded-full object-cover" />
                          ) : (
                            <div className="w-5 h-5 rounded-full bg-primary-100 flex items-center justify-center">
                              <span className="text-xs font-medium text-primary-600">
                                {(assignee.name || assignee.email).charAt(0).toUpperCase()}
                              </span>
                            </div>
                          )}
                          <span className="text-sm text-gray-700">{assignee.name || assignee.email}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">No assignees</p>
                  )}
                </div>
              ) : (
                <AssigneePicker
                  currentAssignees={task.assignees}
                  workspaceMembers={workspaceDetail?.members || []}
                  currentUserId={currentUserId}
                  onAdd={(userId) => relations.addAssignee.mutate(userId, withUpdated)}
                  onRemove={(userId) => relations.removeAssignee.mutate(userId, withUpdated)}
                  isLoading={relations.addAssignee.isPending || relations.removeAssignee.isPending}
                />
              )}

              {/* Labels */}
              {readOnly ? (
                <div>
                  <div className="flex items-center space-x-2 text-sm font-medium text-gray-500 mb-2">
                    <span className="w-4 h-4 flex items-center justify-center">🏷️</span>
                    <span>Labels</span>
                  </div>
                  {task.labels.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {task.labels.map((label) => (
                        <span
                          key={label.id}
                          className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700"
                        >
                          <ColorDot color={label.color} />
                          {label.name}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400 italic">No labels</p>
                  )}
                </div>
              ) : (
                <LabelPicker
                  currentLabels={task.labels}
                  projectLabels={projectDetail?.labels || []}
                  onAdd={(labelId) => relations.addLabel.mutate(labelId, withUpdated)}
                  onRemove={(labelId) => relations.removeLabel.mutate(labelId, withUpdated)}
                  isLoading={relations.addLabel.isPending || relations.removeLabel.isPending}
                />
              )}

              {/* Due Date */}
              {readOnly ? (
                <div>
                  <div className="flex items-center space-x-2 text-sm font-medium text-gray-500 mb-2">
                    <span className="w-4 h-4 flex items-center justify-center">📅</span>
                    <span>Due date</span>
                  </div>
                  {task.dueDate ? (
                    <p className="text-sm text-gray-700">
                      {new Date(task.dueDate).toLocaleDateString(undefined, {
                        weekday: 'short',
                        year: 'numeric',
                        month: 'short',
                        day: 'numeric',
                      })}
                    </p>
                  ) : (
                    <p className="text-sm text-gray-400 italic">No due date</p>
                  )}
                </div>
              ) : (
                <DueDatePicker
                  value={task.dueDate}
                  onChange={handleDueDateChange}
                  isLoading={updateMutation.isPending}
                />
              )}

              {/* GitHub Links - only show in edit mode */}
              {!readOnly && (
                <GitHubLinkSection
                  taskId={taskId}
                  projectId={projectId}
                  externalLinks={task.externalLinks || []}
                  onUpdated={onUpdated}
                />
              )}

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

            {/* Divider - hide comments section in read-only mode */}
            {!readOnly && (
              <>
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
                        aria-label="New comment"
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
                        className="flex-1 px-3 py-2 text-base md:text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 resize-none"
                        disabled={createCommentMutation.isPending}
                      />
                      <IconButton
                        label="Post comment"
                        shortcut="⌘↵"
                        variant="solid"
                        size="md"
                        icon={<Send />}
                        onClick={() => void handleSubmitComment()}
                        disabled={!newComment.trim() || createCommentMutation.isPending}
                        className="self-end"
                      />
                    </div>
                    <p className="mt-1 text-xs text-gray-400">Press Cmd+Enter to submit</p>
                  </div>

              {/* Comments list */}
              <div className="space-y-4">
                {isLoadingComments ? (
                  <div className="flex items-center justify-center py-4">
                    <Spinner size="sm" label="Loading comments" />
                  </div>
                ) : comments.length === 0 ? (
                  <p className="text-sm text-gray-400 italic">No comments yet</p>
                ) : (
                  comments.map((comment) => {
                    const authorName =
                      comment.agent?.name || comment.user?.name || comment.user?.email || 'Unknown user';
                    const avatarUrl = comment.user?.avatarUrl;

                    return (
                      <div key={comment.id} className="bg-gray-50 rounded-lg p-3">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-2 min-w-0">
                            {avatarUrl ? (
                              <img
                                src={avatarUrl}
                                alt=""
                                className="w-6 h-6 rounded-full object-cover flex-shrink-0"
                              />
                            ) : (
                              <div
                                className={clsx(
                                  'w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0',
                                  comment.agent ? 'bg-purple-100' : 'bg-primary-100'
                                )}
                              >
                                <span
                                  className={clsx(
                                    'text-xs font-medium',
                                    comment.agent ? 'text-purple-700' : 'text-primary-600'
                                  )}
                                >
                                  {authorName.charAt(0).toUpperCase()}
                                </span>
                              </div>
                            )}
                            <span className="text-sm font-medium text-gray-700 truncate">{authorName}</span>
                            {comment.agent && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-purple-100 text-purple-700">
                                Agent
                              </span>
                            )}
                          </div>
                          <span className="text-xs text-gray-400 whitespace-nowrap">
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
                            rehypePlugins={[rehypeSanitize]}
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
                    );
                  })
                )}
              </div>
            </div>
              </>
            )}
          </div>
        </div>
        </>
      )}
    </Dialog>
  );
}
