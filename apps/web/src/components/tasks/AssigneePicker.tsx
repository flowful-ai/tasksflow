import { useState } from 'react';
import { User, X, Check, Plus } from 'lucide-react';
import clsx from 'clsx';
import { IconButton, Popover, PopoverContent, PopoverTrigger } from '../ui';

export interface Assignee {
  id: string;
  name: string | null;
  email: string;
  avatarUrl?: string | null;
}

/** Subset of WorkspaceMemberDto the picker needs. */
export interface PickerMember {
  userId: string;
  user: Assignee;
}

interface AssigneePickerProps {
  currentAssignees: Assignee[];
  workspaceMembers: PickerMember[];
  currentUserId?: string;
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
  isLoading?: boolean;
}

const getInitial = (name: string | null, email: string) => (name?.[0] || email[0] || '?').toUpperCase();

export function Avatar({ person, size }: { person: Assignee; size: 'sm' | 'md' }) {
  const box = size === 'sm' ? 'w-5 h-5 text-xs' : 'w-7 h-7 text-sm';
  return person.avatarUrl ? (
    <img src={person.avatarUrl} alt="" className={clsx(box, 'rounded-full object-cover flex-shrink-0')} />
  ) : (
    <span aria-hidden className={clsx(box, 'rounded-full bg-primary-100 flex items-center justify-center flex-shrink-0 font-medium text-primary-700')}>
      {getInitial(person.name, person.email)}
    </span>
  );
}

export interface AssigneeOptionsProps {
  currentAssignees: Assignee[];
  workspaceMembers: PickerMember[];
  /** Called with the member's user id; the caller adds or removes. */
  onToggle: (userId: string) => void;
  isLoading?: boolean;
}

/** Searchable member list (the body of the assignee popover); reusable in other popovers. */
export function AssigneeOptions({ currentAssignees, workspaceMembers, onToggle, isLoading }: AssigneeOptionsProps) {
  const [search, setSearch] = useState('');
  const assigneeIds = new Set(currentAssignees.map((a) => a.id));
  const query = search.toLowerCase();
  const filteredMembers = workspaceMembers.filter((member) => {
    const name = member.user.name?.toLowerCase() || '';
    return name.includes(query) || member.user.email.toLowerCase().includes(query);
  });

  return (
    <>
      <div className="p-2 border-b border-gray-100">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search members..."
          aria-label="Search members"
          autoFocus
          className="w-full px-3 py-1.5 text-base md:text-sm border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500"
        />
      </div>
      <div className="max-h-48 overflow-y-auto" role="listbox" aria-label="Members">
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
                role="option"
                aria-selected={isAssigned}
                onClick={() => onToggle(member.user.id)}
                disabled={isLoading}
                className={clsx(
                  'w-full flex items-center space-x-3 px-3 py-2 text-left hover:bg-gray-50 transition-colors',
                  isAssigned && 'bg-primary-50'
                )}
              >
                <Avatar person={member.user} size="md" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{member.user.name || member.user.email}</p>
                  {member.user.name && <p className="text-xs text-gray-500 truncate">{member.user.email}</p>}
                </div>
                {isAssigned && <Check className="w-4 h-4 text-primary-600 flex-shrink-0" aria-hidden />}
              </button>
            );
          })
        )}
      </div>
    </>
  );
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

  const assigneeIds = new Set(currentAssignees.map((a) => a.id));
  const isCurrentUserAssigned = currentUserId ? assigneeIds.has(currentUserId) : false;

  const close = () => setIsOpen(false);

  const handleToggle = (userId: string) => {
    if (assigneeIds.has(userId)) onRemove(userId);
    else onAdd(userId);
    close();
  };

  return (
    <div>
      <div className="flex items-center space-x-2 text-sm font-medium text-gray-500 mb-2">
        <User className="w-4 h-4" aria-hidden />
        <span>Assignees</span>
      </div>

      {currentAssignees.length > 0 && (
        <ul className="flex flex-wrap gap-2 mb-2" aria-label="Current assignees">
          {currentAssignees.map((assignee) => (
            <li key={assignee.id} className="flex items-center gap-2 py-1 pl-2.5 pr-1 bg-gray-100 rounded-full">
              <Avatar person={assignee} size="sm" />
              <span className="text-sm text-gray-700">{assignee.name || assignee.email}</span>
              <IconButton
                label={`Unassign ${assignee.name || assignee.email}`}
                size="xs"
                icon={<X />}
                onClick={() => onRemove(assignee.id)}
                disabled={isLoading}
                className="rounded-full"
              />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center gap-2">
        {currentUserId && (
          <button
            type="button"
            onClick={() => {
              if (!isCurrentUserAssigned) onAdd(currentUserId);
            }}
            disabled={isLoading || isCurrentUserAssigned}
            className={clsx(
              'flex items-center space-x-1.5 px-3 py-1.5 text-sm rounded-lg border transition-colors',
              'border-primary-200 text-primary-700 hover:border-primary-300 hover:text-primary-800 hover:bg-primary-50',
              (isLoading || isCurrentUserAssigned) && 'opacity-50 cursor-not-allowed'
            )}
          >
            <Check className="w-3.5 h-3.5" aria-hidden />
            <span>Assign to me</span>
          </button>
        )}
        <Popover open={isOpen} onOpenChange={(open) => (open ? setIsOpen(true) : close())}>
          <PopoverTrigger asChild>
            <button
              type="button"
              disabled={isLoading}
              className={clsx(
                'flex items-center space-x-1.5 px-3 py-1.5 text-sm rounded-lg border border-dashed transition-colors',
                'border-gray-300 text-gray-500 hover:border-gray-400 hover:text-gray-600',
                isLoading && 'opacity-50 cursor-not-allowed'
              )}
            >
              <Plus className="w-3.5 h-3.5" aria-hidden />
              <span>Add assignee</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-0 overflow-hidden" aria-label="Pick an assignee">
            <AssigneeOptions
              currentAssignees={currentAssignees}
              workspaceMembers={workspaceMembers}
              onToggle={handleToggle}
              isLoading={isLoading}
            />
          </PopoverContent>
        </Popover>
      </div>
    </div>
  );
}
