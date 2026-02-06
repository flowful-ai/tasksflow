import { useState, useRef, useEffect } from 'react';
import { User, X, Check, Plus } from 'lucide-react';
import clsx from 'clsx';

interface Assignee {
  id: string;
  name: string | null;
  email: string;
  avatarUrl?: string | null;
}

interface WorkspaceMember {
  userId: string;
  user: {
    id: string;
    name: string | null;
    email: string;
    avatarUrl?: string | null;
  };
}

interface AssigneePickerProps {
  currentAssignees: Assignee[];
  workspaceMembers: WorkspaceMember[];
  currentUserId?: string;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
  isLoading?: boolean;
}

export function AssigneePicker({
  currentAssignees,
  workspaceMembers,
  currentUserId,
  onAdd,
  onRemove,
  isLoading,
}: AssigneePickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setSearch('');
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  // Focus input when dropdown opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  const assigneeIds = new Set(currentAssignees.map((a) => a.id));
  const isCurrentUserAssigned = currentUserId ? assigneeIds.has(currentUserId) : false;

  const filteredMembers = workspaceMembers.filter((member) => {
    const name = member.user.name?.toLowerCase() || '';
    const email = member.user.email.toLowerCase();
    const query = search.toLowerCase();
    return name.includes(query) || email.includes(query);
  });

  const handleToggle = (userId: string) => {
    if (assigneeIds.has(userId)) {
      onRemove(userId);
    } else {
      onAdd(userId);
    }
    setIsOpen(false);
    setSearch('');
  };

  const handleRemove = (e: React.MouseEvent, userId: string) => {
    e.stopPropagation();
    onRemove(userId);
  };

  const handleAssignToMe = () => {
    if (!currentUserId || isCurrentUserAssigned) {
      return;
    }
    onAdd(currentUserId);
    setIsOpen(false);
    setSearch('');
  };

  const getInitial = (name: string | null, email: string) => {
    return (name?.[0] || email[0] || '?').toUpperCase();
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center space-x-2 text-sm font-medium text-gray-500 mb-2">
        <User className="w-4 h-4" />
        <span>Assignees</span>
      </div>

      {/* Current assignees display */}
      {currentAssignees.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {currentAssignees.map((assignee) => (
            <div
              key={assignee.id}
              className="flex items-center space-x-2 px-2.5 py-1.5 bg-gray-100 rounded-full group"
            >
              {assignee.avatarUrl ? (
                <img src={assignee.avatarUrl} alt={assignee.name || assignee.email} className="w-5 h-5 rounded-full object-cover" />
              ) : (
                <div className="w-5 h-5 rounded-full bg-primary-100 flex items-center justify-center">
                  <span className="text-xs font-medium text-primary-600">
                    {getInitial(assignee.name, assignee.email)}
                  </span>
                </div>
              )}
              <span className="text-sm text-gray-700">{assignee.name || assignee.email}</span>
              <button
                type="button"
                onClick={(e) => handleRemove(e, assignee.id)}
                disabled={isLoading}
                className="p-0.5 hover:bg-gray-200 rounded-full transition-colors opacity-0 group-hover:opacity-100"
              >
                <X className="w-3 h-3 text-gray-400 hover:text-gray-600" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add button / dropdown trigger */}
      <div className="flex items-center gap-2">
        {currentUserId && (
          <button
            type="button"
            onClick={handleAssignToMe}
            disabled={isLoading || isCurrentUserAssigned}
            className={clsx(
              'flex items-center space-x-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors',
              'border-primary-200 text-primary-700 hover:border-primary-300 hover:text-primary-800 hover:bg-primary-50',
              (isLoading || isCurrentUserAssigned) && 'opacity-50 cursor-not-allowed'
            )}
          >
            <Check className="w-3.5 h-3.5" />
            <span>Assign to me</span>
          </button>
        )}
        <button
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          disabled={isLoading}
          className={clsx(
            'flex items-center space-x-1.5 px-3 py-1.5 text-sm rounded-lg border border-dashed transition-colors',
            'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-600',
            isLoading && 'opacity-50 cursor-not-allowed'
          )}
        >
          <Plus className="w-3.5 h-3.5" />
          <span>Add assignee</span>
        </button>
      </div>

      {/* Dropdown */}
      {isOpen && (
        <div className="absolute z-10 mt-1 w-64 bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          {/* Search input */}
          <div className="p-2 border-b border-gray-100">
            <input
              ref={inputRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members..."
              className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
            />
          </div>

          {/* Members list */}
          <div className="max-h-48 overflow-y-auto">
            {filteredMembers.length === 0 ? (
              <div className="px-3 py-4 text-sm text-gray-400 text-center">
                {search ? 'No members found' : 'No members available'}
              </div>
            ) : (
              filteredMembers.map((member) => {
                const isAssigned = assigneeIds.has(member.user.id);
                return (
                  <button
                    key={member.userId}
                    type="button"
                    onClick={() => handleToggle(member.user.id)}
                    disabled={isLoading}
                    className={clsx(
                      'w-full flex items-center space-x-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors',
                      isAssigned && 'bg-primary-50'
                    )}
                  >
                    {member.user.avatarUrl ? (
                      <img src={member.user.avatarUrl} alt={member.user.name || member.user.email} className="w-7 h-7 rounded-full object-cover flex-shrink-0" />
                    ) : (
                      <div className="w-7 h-7 rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0">
                        <span className="text-sm font-medium text-primary-600">
                          {getInitial(member.user.name, member.user.email)}
                        </span>
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">
                        {member.user.name || member.user.email}
                      </p>
                      {member.user.name && (
                        <p className="text-xs text-gray-500 truncate">{member.user.email}</p>
                      )}
                    </div>
                    {isAssigned && <Check className="w-4 h-4 text-primary-600 flex-shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
